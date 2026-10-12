#include "storage_adapter.h"
#include "command_service.h"
#include "app_runtime.h"
#include "board.h"
#if defined(FW_TIMING_PROBE) || defined(FW_FLASH_DUMP)
#include "diagnostic_service.h"
#endif

#include <stdbool.h>
#include <stdint.h>

static void calibrate_position(app_state_t *state, int16_t target)
{
    register_table_t *registers = &state->device.registers;
    registers->byte[REG_TORQUE_ENABLE] = 0u;
    app_runtime_revoke_output(state);
#ifdef FW_MOTOR_TEST
    state->drive_lease_valid = false;
#endif
    if (!state->control_initialized ||
        (uint32_t)(sensor_driver_ticks(&state->sensors) - state->last_good_tick) > 2u ||
        !sensor_service_calibrate(&state->sensor_service, registers, target)) return;
    app_runtime_reanchor(state, state->sensor_service.encoder.position);
    if (state->storage_source != STORAGE_SOURCE_NONE &&
        storage_update_mirror_range(&state->storage_mirror, registers, 31u, 2u))
        (void)app_runtime_commit_storage(state);
}

#ifndef FW_MOTOR_TEST
static bool continuous_goal_write(const protocol_result_t *result)
{
    const register_write_result_t *write = &result->write;
    return result->effect == PROTOCOL_EFFECT_WRITE &&
           write->accepted_count != 0u && write->start >= 41u &&
           (unsigned)write->start + write->accepted_count <= 48u;
}
#endif

void command_service_apply(const protocol_result_t *result, void *context)
{
    app_state_t *state = context;
    register_table_t *registers = &state->device.registers;
#ifdef FW_MOTOR_TEST
    bool lease_heartbeat = result->effect == PROTOCOL_EFFECT_WRITE &&
        result->write.start == 40u && result->write.accepted_count == 1u &&
        !result->write.any_changed && registers->byte[REG_TORQUE_ENABLE] == 1u &&
        state->drive_lease_valid;
    if (result->effect != PROTOCOL_EFFECT_NONE && !lease_heartbeat) {
        app_runtime_revoke_output(state);
        state->drive_lease_valid = false;
    }
#else
    /* Motion requests can include acceleration at 41. Requalifying the
     * bridge for each such packet interrupts a continuous goal stream.
     * Torque, mode and configuration writes still revoke output. */
    if (result->effect != PROTOCOL_EFFECT_NONE &&
        !continuous_goal_write(result)) {
        app_runtime_revoke_output(state);
    }
#endif
    switch (result->effect) {
    case PROTOCOL_EFFECT_WRITE:
        if (state->arm_selected &&
            (registers_write_touches(&result->write, 33u, 33u) ||
             registers_write_touches(&result->write, 41u, 47u))) {
            arm_control_disarm(&state->arm);
            state->arm_selected = false;
            registers->byte[REG_TORQUE_ENABLE] = 0;
            app_runtime_revoke_output(state);
        }
        if (state->arm_selected && registers->byte[REG_TORQUE_ENABLE] != 1u)
            arm_control_disarm(&state->arm);
#ifdef FW_MOTOR_TEST
        if (lease_heartbeat) {
            state->drive_lease_deadline = sensor_driver_ticks(&state->sensors) + 200u;
            break;
        }
#endif
#if defined(FW_TIMING_PROBE) || defined(FW_FLASH_DUMP)
        diagnostic_service_write(state, &result->write);
#endif
        if (registers->byte[REG_LOCK] == 0u &&
            state->storage_source != STORAGE_SOURCE_NONE &&
            storage_update_mirror_range(&state->storage_mirror, registers,
                                        result->write.start,
                                        result->write.accepted_count)) {
            (void)app_runtime_commit_storage(state);
        }
        if (registers_write_touches(&result->write, 6u, 6u)) {
            if (registers->byte[REG_BAUD_RATE] > 7u) registers->byte[REG_BAUD_RATE] = 0;
            bus_service_request_baud(&state->bus);
        }
        if (registers_write_touches(&result->write, 33u, 33u)) {
            registers->byte[REG_TORQUE_ENABLE] = 0;
            registers->byte[REG_ACCELERATION] = 0;
            registers_set_u16(registers, REG_GOAL_VELOCITY, 0);
        }
        if (registers_write_touches(&result->write, 31u, 32u)) {
            /* The corrected encoder position anchors a new active profile.
             * The commanded goal register remains untouched. */
            sensor_service_offset_written(&state->sensor_service, registers);
            state->control_initialized = false;
            app_runtime_queue_motion(state, false, false);
        }
        if (registers_write_touches(&result->write, 40u, 40u) &&
            registers->byte[REG_TORQUE_ENABLE] == 128u) {
            calibrate_position(state, 2048);
            break;
        }
        bool position_goal = registers_write_touches(&result->write, 42u, 43u);
        bool auto_torque =
            (position_goal && (registers->byte[REG_OPERATION_MODE] == MOTION_MODE_POSITION ||
                               registers->byte[REG_OPERATION_MODE] == MOTION_MODE_RELATIVE)) ||
            (registers_write_touches(&result->write, 44u, 45u) &&
             registers->byte[REG_OPERATION_MODE] == MOTION_MODE_PWM) ||
            (registers_write_touches(&result->write, 46u, 47u) &&
             registers->byte[REG_OPERATION_MODE] == MOTION_MODE_VELOCITY);
        if (registers_write_touches(&result->write, 33u, 33u) ||
            registers_write_touches(&result->write, 40u, 49u)) {
            app_runtime_queue_motion(state, position_goal, auto_torque);
#ifdef FW_TIMING_PROBE
            if (position_goal) diagnostic_service_goal_queued(state);
#endif
        }
#ifdef FW_MOTOR_TEST
        if (state->motion.auto_torque ||
            (registers_write_touches(&result->write, 40u, 40u) &&
             (registers->byte[REG_TORQUE_ENABLE] == 1u || registers->byte[REG_TORQUE_ENABLE] == 2u))) {
            state->drive_lease_deadline = sensor_driver_ticks(&state->sensors) + 200u;
            state->drive_lease_valid = true;
        }
#endif
        break;
    case PROTOCOL_EFFECT_SYSTEM_RESET:
        board_system_reset();
        break;
    case PROTOCOL_EFFECT_FACTORY_RESET: {
        if (state->storage_source != STORAGE_SOURCE_NONE &&
            storage_copy_mirror_to_registers(
                &state->storage_mirror, registers, true)) {
            storage_copy_registers_to_mirror(
                &state->storage_mirror, registers, false);
            (void)app_runtime_commit_storage(state);
            registers->byte[REG_TORQUE_ENABLE] = 0;
            bus_service_request_baud(&state->bus);
            app_runtime_queue_motion(state, false, false);
        }
        break;
    }
    case PROTOCOL_EFFECT_SAVE_TEMPLATE:
        if (state->storage_source != STORAGE_SOURCE_NONE) {
            storage_copy_registers_to_mirror(
                &state->storage_mirror, registers, true);
            (void)app_runtime_commit_storage(state);
        }
        break;
    case PROTOCOL_EFFECT_ENCODER_HOME:
        registers->byte[REG_TORQUE_ENABLE] = 0;
        app_runtime_queue_motion(state, false, false);
        break;
    case PROTOCOL_EFFECT_CALIBRATE:
        calibrate_position(state, result->calibration_target);
        break;
    default:
        break;
    }
}
