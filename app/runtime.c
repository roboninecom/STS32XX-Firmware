#include "app_runtime.h"
#include "storage_service.h"
#include "board.h"
#include "bridge_driver.h"
#include "control_adapter.h"
#include "status_led_driver.h"

#include <stdbool.h>
#include <stdint.h>

void app_runtime_revoke_output(app_state_t *state)
{
    bridge_driver_disarm();
    output_safety_revoke(&state->output);
}

bool app_runtime_commit_storage(app_state_t *state)
{
    app_runtime_revoke_output(state);
    arm_extension_end_session(state);
    state->arm_selected = false;
    if (state->storage_source == STORAGE_SOURCE_NONE) return false;
    output_safety_begin_maintenance(&state->output);
    sensor_driver_stop(&state->sensors);
    bool success = storage_service_commit(&state->storage_mirror);
    if (!success) board_system_reset();
    /* Flash stalls the foreground long enough to strand an in-flight I2C
     * transaction. Restart acquisition before permitting another control
     * step, even when the persistent write itself succeeded. */
    state->sensor_active = sensor_driver_restart(
        &state->sensors,
        (state->device.registers.byte[REG_CONFIGURATION_FLAGS] & 0x20u) != 0u);
    sensor_service_restart(&state->sensor_service);
    state->control_initialized = false;
    state->last_good_tick = sensor_driver_ticks(&state->sensors);
    state->stale_reported = false;
    if (!state->sensor_active) state->device.registers.byte[REG_SERVO_STATUS] |= 0x02u;
    output_safety_end_maintenance(&state->output, state->sensor_active);
    return success;
}

void app_runtime_queue_motion(app_state_t *state, bool position_goal, bool auto_torque)
{
    state->motion.pending = true;
    state->motion.position_goal |= position_goal;
    state->motion.auto_torque |= auto_torque;
}

void app_runtime_reanchor(app_state_t *state, int32_t position)
{
    control_pipeline_reanchor(&state->control, position);
    arm_extension_end_session(state);
    state->arm_selected = false;
    state->motion = (pending_motion_t){0};
}

static control_result_t run_control_step(app_state_t *state,
                                         control_sample_t sample,
                                         bool permit, uint32_t sample_tick)
{
    register_table_t *registers = &state->device.registers;
    protection_config_t protection;
    protection_settings_decode(registers, &protection);
    control_result_t result;
    if (state->arm_selected) {
        /* Step using current time so delayed acquisition cannot hide a missed
         * controller deadline. Sensor freshness is checked separately. */
        uint32_t tick = sensor_driver_ticks(&state->sensors);
        state->arm_result = arm_control_step(&state->arm,
            state->sensor_service.measurement.arm_position,
            tick, sample.fresh, false);
        if (!state->arm_result.fresh && state->arm.armed) {
            arm_extension_end_session(state);
        }
        result = (control_result_t){
            .requested_output = arm_control_flip_effort_polarity(
                state->arm_result.requested_effort),
            .target_position = state->arm_result.reference_position_q8 / 256,
            .target_speed = state->arm_result.reference_velocity_q8_s / 256,
        };
        control_pipeline_output(&state->control, &protection, &sample, &result,
            permit && state->arm_result.active, false,
            (registers->byte[REG_CONFIGURATION_FLAGS] & 0x20u) != 0u);
        if ((result.torque != 1u && registers->byte[REG_TORQUE_ENABLE] == 1u) ||
            (result.errors & protection.shutdown_mask) != 0u) {
            arm_extension_end_session(state);
        }
        if (!state->arm.armed) result.torque = 0;
        state->arm_sample_tick = sample_tick;
    } else {
        controller_settings_t controllers;
        controller_settings_decode(registers, &controllers);
        result = control_pipeline_step(
            &state->control, &controllers, &protection, registers->byte[REG_OPERATION_MODE],
            (registers->byte[REG_CONFIGURATION_FLAGS] & 0x20u) != 0u, sample, permit);
    }
    protection_result_publish(registers, (protection_result_t){
        .torque = result.torque,
        .errors = result.errors,
        .output = result.protected_output,
    });
    status_led_update_t led = status_led_step(
        &state->status_led, registers->byte[REG_LED_ALARM_MASK], result.errors);
    if (led.write_output) status_led_driver_set(led.output_on);
    return result;
}

__attribute__((noinline)) void app_runtime_service_control_pair(app_state_t *state, uint32_t sample_tick)
{
    register_table_t *registers = &state->device.registers;
    const sensor_measurement_t *measurement = &state->sensor_service.measurement;
    int32_t position = measurement->position;
    if (!state->control_initialized) {
        control_pipeline_reanchor(&state->control, position);
        state->control_initialized = true;
        state->motion.pending = true;
    }
    if (state->motion.pending && !state->arm_selected) {
        if (state->motion.auto_torque) registers->byte[REG_TORQUE_ENABLE] = 1;
        motion_request_t request;
        bool decoded = motion_request_decode_cached(
            registers, state->control.relative_origin,
            &state->device.cached_motion_limits, &request);
        state->motion_rejected = !decoded || !control_pipeline_accept(
            &state->control, &request, &state->device.cached_motion_limits,
            state->motion.position_goal);
        if (state->motion_rejected) app_runtime_revoke_output(state);
        state->motion = (pending_motion_t){0};
    }
    if (state->arm_selected) state->motion = (pending_motion_t){0};
    control_sample_t sample = {
        .position = position,
        .speed = measurement->speed,
        .current = measurement->current,
        .voltage = measurement->voltage,
        .temperature = measurement->temperature,
        .fresh = true,
        /* Factory controller freezes its integral using the legacy moving
         * flag. This is not an independent measured-current limiter. */
        .current_limit_active = measurement->moving,
    };
    output_safety_pair_accepted(&state->output);
    bool permit = output_safety_permit(
        &state->output, !state->motion_rejected,
        (registers->byte[REG_CONFIGURATION_FLAGS] & 0x20u) == (state->bridge_config & 0x20u),
        (registers->byte[REG_SERVO_STATUS] & 0x02u) == 0u);
    control_result_t result = run_control_step(state, sample, permit, sample_tick);
    int16_t applied_effort;
    bool bridge_ok = bridge_driver_apply(result.bridge,
                             (registers->byte[REG_CONFIGURATION_FLAGS] & 0x01u) != 0u,
                             &applied_effort);
    if (state->arm_selected) {
        state->arm_drive_enabled = bridge_ok &&
            result.bridge.action == BRIDGE_DRIVE;
        state->arm_applied_effort = state->arm_drive_enabled ?
            arm_control_flip_effort_polarity(applied_effort) : 0;
        /* Keep the compact saturation flag consistent with protection and
         * target clipping as well as the controller's own configured cap. */
        if (state->arm_drive_enabled && state->arm_applied_effort !=
            state->arm_result.requested_effort)
            state->arm_result.saturated = true;
        arm_control_applied(&state->arm, state->arm_applied_effort,
                            state->arm_drive_enabled);
    }
    if (!bridge_ok) {
        bridge_driver_disarm();
        output_safety_fail(&state->output);
        arm_extension_end_session(state);
    }
    telemetry_input_t telemetry = {
        .position = position,
        .speed = sample.speed,
        .current = sample.current,
        .pwm = result.protected_output,
        .active_position = result.target_position,
        .active_speed = result.target_speed,
        .relative_origin = state->control.relative_origin,
        .profile_active = state->control.trajectory.active,
        .measured_moving = measurement->moving,
    };
    registers->byte[REG_PRESENT_VOLTAGE] = measurement->voltage;
    registers->byte[REG_PRESENT_TEMPERATURE] = measurement->temperature;
    telemetry_publish_control(registers, telemetry);
    state->last_good_tick = sample_tick;
    state->stale_reported = false;
    arm_extension_publish_sample(state);
}

/* Sensor IRQs own acquisition. Foreground consumes a single immutable pair,
 * validates it and runs control before accepting another command. */
__attribute__((noinline)) void app_runtime_service_sensors(app_state_t *state)
{
    if (!state->sensor_active) return;
    uint8_t previous_errors = state->device.registers.byte[REG_SERVO_STATUS];
    bool state_changed = false;
    sensor_pair_t pair;
    if (sensor_driver_take_pair(&state->sensors, &pair)) {
        uint32_t age = sensor_driver_ticks(&state->sensors) - pair.tick_ms;
        /* A delayed foreground must never restamp an old DMA result as fresh. */
        bool published = age <= 2u && sensor_service_accept_pair(
            &state->sensor_service, &state->device.registers, &pair,
            state->device.cached_motion_limits.rate);
        state_changed = true;
        if (published) {
            app_runtime_service_control_pair(state, pair.tick_ms);
        } else {
            app_runtime_revoke_output(state);
            arm_extension_end_session(state);
            state->device.registers.byte[REG_SERVO_STATUS] |= 0x02u;
        }
    }
    if (state->control_initialized && !state->stale_reported &&
        (uint32_t)(sensor_driver_ticks(&state->sensors) - state->last_good_tick) > 2u) {
        state_changed = true;
        app_runtime_revoke_output(state);
        arm_extension_end_session(state);
        control_sample_t stale = {
            .position = state->sensor_service.measurement.position,
            .voltage = state->sensor_service.measurement.voltage,
            .temperature = state->sensor_service.measurement.temperature};
        (void)run_control_step(state, stale, false, sensor_driver_ticks(&state->sensors));
        state->stale_reported = true;
    }
    if (state_changed || state->device.registers.byte[REG_SERVO_STATUS] != previous_errors)
        protocol_service_publish(&state->bus.protocol);
    /* Recovery can toggle a stuck bus, but only after output revocation. */
    sensor_driver_service(&state->sensors);
}

void app_runtime_poll(app_state_t *state)
{
    app_runtime_service_sensors(state);
    /* I2C/DMA progress independently. Short legacy writes no longer wait for
     * the current encoder transaction; long commands still need timing checks. */
    bus_service_poll(&state->bus, sensor_driver_ticks(&state->sensors));
}
