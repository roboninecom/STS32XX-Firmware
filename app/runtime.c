#include "app_runtime.h"
#include "storage_service.h"
#include "board.h"
#ifdef FW_TIMING_PROBE
#include "diagnostic_service.h"
#include "diagnostics.h"
#endif
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
    arm_control_disarm(&state->arm);
    state->arm_selected = false;
    if (state->storage_source == STORAGE_SOURCE_NONE) return false;
    output_safety_begin_maintenance(&state->output);
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
    arm_control_disarm(&state->arm);
    state->arm_selected = false;
    state->motion = (pending_motion_t){0};
#if defined(FW_TIMING_PROBE) && !defined(FW_ARM_TIMING_PROBE)
    state->goal_timing_pending = false;
#endif
}

static control_result_t run_control_step(app_state_t *state,
                                         control_sample_t sample,
                                         bool permit)
{
    register_table_t *registers = &state->device.registers;
    protection_config_t protection;
    protection_settings_decode(registers, &protection);
    control_result_t result;
    if (state->arm_selected) {
        uint32_t tick = sensor_driver_ticks(&state->sensors);
        state->arm_result = arm_control_step(&state->arm,
            state->sensor_service.measurement.arm_position,
            tick, sample.fresh, false);
        if (!state->arm_result.fresh && state->arm.armed) {
#ifdef FW_ARM_TIMING_PROBE
            state->timing_arm_revocation = 1; /* Controller freshness / elapsed dt. */
#endif
            arm_control_disarm(&state->arm);
        }
        protection_result_t protected = protection_step(&state->control.protection,
            &protection, (protection_input_t){
                .position = sample.position, .current = sample.current,
                .requested_output = arm_control_flip_effort_polarity(
                    state->arm_result.requested_effort),
                .voltage = sample.voltage, .temperature = sample.temperature,
                .fresh_sensors = sample.fresh});
        if ((protected.torque != 1u && registers->byte[REG_TORQUE_ENABLE] == 1u) ||
            (protected.errors & protection.shutdown_mask) != 0u) {
#ifdef FW_ARM_TIMING_PROBE
            if (state->arm.armed) state->timing_arm_revocation = 2;
#endif
            arm_control_disarm(&state->arm);
        }
        result = (control_result_t){
            .requested_output = arm_control_flip_effort_polarity(
                state->arm_result.requested_effort),
            .protected_output = protected.output,
            .target_position = state->arm_result.reference_position_q8 / 256,
            .target_speed = state->arm_result.reference_velocity_q8_s / 256,
            .errors = protected.errors, .torque = protected.torque,
        };
        result.bridge = bridge_policy_apply(&state->control.bridge,
            protected.output, protected.torque,
            permit && sample.fresh && state->arm_result.active,
            (registers->byte[REG_CONFIGURATION_FLAGS] & 0x20u) != 0u);
        state->arm_sample_tick = tick;
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

void app_runtime_service_control_pair(app_state_t *state)
{
    register_table_t *registers = &state->device.registers;
    const sensor_measurement_t *measurement = &state->sensor_service.measurement;
    int32_t position = measurement->position;
#if defined(FW_TIMING_PROBE) && !defined(FW_ARM_TIMING_PROBE)
    bool timed_goal = state->motion.pending && state->goal_timing_pending;
    uint32_t goal_control_started = timed_goal ?
        diagnostic_service_goal_started(state) : 0u;
#endif
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
#ifdef FW_MOTOR_TEST
    if (state->drive_lease_valid &&
        (int32_t)(sensor_driver_ticks(&state->sensors) - state->drive_lease_deadline) >= 0) {
        state->drive_lease_valid = false;
        registers->byte[REG_TORQUE_ENABLE] = 0u;
        app_runtime_revoke_output(state);
    }
#endif
    bool permit = output_safety_permit(
        &state->output, !state->motion_rejected,
        (registers->byte[REG_CONFIGURATION_FLAGS] & 0x20u) == (state->bridge_config & 0x20u),
        (registers->byte[REG_SERVO_STATUS] & 0x02u) == 0u,
#ifdef FW_MOTOR_TEST
        state->drive_lease_valid);
#else
        true);
#endif
#ifdef FW_ARM_TIMING_PROBE
    uint32_t control_started = diagnostics_probe_cycles();
#endif
    control_result_t result = run_control_step(state, sample, permit);
#ifdef FW_ARM_TIMING_PROBE
    state->timing_control_last_cycles = diagnostics_probe_cycles() - control_started;
    if (state->timing_control_last_cycles > state->timing_control_max_cycles)
        state->timing_control_max_cycles = state->timing_control_last_cycles;
    if (state->timing_control_samples != UINT16_MAX) ++state->timing_control_samples;
#endif
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
        arm_control_disarm(&state->arm);
    }
#if defined(FW_TIMING_PROBE) && !defined(FW_ARM_TIMING_PROBE)
    if (timed_goal) diagnostic_service_goal_applied(state, goal_control_started);
#endif
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
    state->last_good_tick = sensor_driver_ticks(&state->sensors);
    state->stale_reported = false;
    arm_extension_publish_sample(state);
}

/* Do not keep acquisition/control scratch live while dispatching a planner. */
__attribute__((noinline)) void app_runtime_service_sensors(app_state_t *state)
{
    if (!state->sensor_active) return;
    uint8_t previous_errors = state->device.registers.byte[REG_SERVO_STATUS];
    bool state_changed = false;
    bool period_elapsed = sensor_driver_timer_tick(&state->sensors);
    /* Complete the previous pair before scheduling another. A foreground
     * planning pause may cross one tick without exceeding the sensor deadline;
     * replacing that still-valid transaction causes unnecessary I2C recovery. */
    sensor_driver_poll(&state->sensors);
    uint32_t generation;
    bool valid;
    uint16_t raw_angle;
    if (sensor_driver_take_encoder(&state->sensors, &generation, &valid,
                                   &raw_angle)) {
        if (!valid) app_runtime_revoke_output(state);
        sensor_service_encoder_done(&state->sensor_service,
                                    &state->device.registers,
                                    generation, valid, raw_angle);
    }
    uint16_t samples[3];
    if (sensor_driver_take_adc(&state->sensors, &generation, &valid, samples)) {
        if (!valid) app_runtime_revoke_output(state);
        sensor_service_adc_done(&state->sensor_service,
                                generation, valid, valid ? samples : 0);
    }
    uint32_t pairs_before = state->sensor_service.acquisition.completed_pairs;
    bool published = sensor_service_publish(&state->sensor_service,
                                            &state->device.registers,
                                            state->device.cached_motion_limits.rate);
    if (!published &&
        state->sensor_service.acquisition.completed_pairs != pairs_before) {
        state_changed = true;
#ifdef FW_ARM_TIMING_PROBE
        if (state->arm.armed) state->timing_arm_revocation = 3; /* Rejected sensor pair. */
#endif
        app_runtime_revoke_output(state);
        arm_control_disarm(&state->arm);
    }
#ifdef FW_TIMING_PROBE
    if (!published && state->sensor_service.acquisition.completed_pairs != pairs_before)
        diagnostic_service_pair_rejected(state);
#endif
    if (published) {
        state_changed = true;
        app_runtime_service_control_pair(state);
#ifdef FW_TIMING_PROBE
        diagnostic_service_pair_complete(state);
#endif
    }
    else if (state->control_initialized && !state->stale_reported &&
             (uint32_t)(sensor_driver_ticks(&state->sensors) - state->last_good_tick) > 2u) {
        state_changed = true;
#ifdef FW_ARM_TIMING_PROBE
        if (state->arm.armed) state->timing_arm_revocation = 4; /* Sensor age. */
#endif
        app_runtime_revoke_output(state);
        arm_control_disarm(&state->arm);
        control_sample_t stale = {
            .position = state->sensor_service.measurement.position,
            .voltage = state->sensor_service.measurement.voltage,
            .temperature = state->sensor_service.measurement.temperature};
        (void)run_control_step(state, stale, false);
        state->stale_reported = true;
    }
    if (period_elapsed && sensor_driver_can_begin(&state->sensors)) {
#ifdef FW_TIMING_PROBE
        diagnostic_service_period_started(state);
#endif
        uint32_t next_generation = sensor_service_begin(
            &state->sensor_service, &state->device.registers);
        sensor_driver_begin(&state->sensors, next_generation);
    }
    /* IRQ readers retain the previous complete snapshot until all sample,
     * fault and optional diagnostic fields have been updated. Command-side
     * mutations are published separately before releasing their mailbox. */
    if (state_changed || state->device.registers.byte[REG_SERVO_STATUS] != previous_errors)
        protocol_service_publish(&state->bus.protocol);
}

void app_runtime_poll(app_state_t *state)
{
    app_runtime_service_sensors(state);
    /* The polled I2C transaction needs short foreground visits between bytes.
     * Finish it before a synchronous planner command. IRQs still serve reads;
     * a fault opens dispatch for recovery and torque-off commands. */
    const acquisition_t *acquisition = &state->sensor_service.acquisition;
    if (!state->sensor_active || !acquisition->pending || acquisition->fault)
        bus_service_poll(&state->bus, sensor_driver_ticks(&state->sensors));
}
