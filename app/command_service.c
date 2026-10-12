#include "storage_adapter.h"
#include "command_service.h"
#include "app_runtime.h"
#include "board.h"
#ifdef FW_TIMING_PROBE
#include "diagnostic_service.h"
#endif

#include <stdbool.h>
#include <stdint.h>

static void calibrate_position(app_state_t *state, int16_t target)
{
    register_table_t *registers = &state->device.registers;
    arm_extension_end_session(state);
    registers->byte[REG_TORQUE_ENABLE] = 0u;
    app_runtime_revoke_output(state);
    if (!state->control_initialized ||
        (uint32_t)(sensor_driver_ticks(&state->sensors) - state->last_good_tick) > 2u ||
        !sensor_service_calibrate(&state->sensor_service, registers, target)) return;
    app_runtime_reanchor(state, state->sensor_service.encoder.position);
    if (state->storage_source != STORAGE_SOURCE_NONE &&
        storage_update_mirror_range(&state->storage_mirror, registers, 31u, 2u))
        (void)app_runtime_commit_storage(state);
}

static bool continuous_goal_write(const protocol_result_t *result)
{
    const register_write_result_t *write = &result->write;
    return result->effect == PROTOCOL_EFFECT_WRITE &&
           write->accepted_count != 0u && write->start >= 41u &&
           (unsigned)write->start + write->accepted_count <= 48u;
}

void command_service_apply(const protocol_result_t *result, void *context)
{
    app_state_t *state = context;
    register_table_t *registers = &state->device.registers;
    /* An idempotent enable must not interrupt an active extension move. Mixed
     * register writes still take the normal output-requalification path. */
    if (state->arm_selected && state->arm.armed &&
        registers->byte[REG_TORQUE_ENABLE] == 1u &&
        result->effect == PROTOCOL_EFFECT_WRITE &&
        result->write.start == REG_TORQUE_ENABLE && result->write.accepted_count == 1u)
        return;
    /* Motion requests can include acceleration at 41. Requalifying the
     * bridge for each such packet interrupts a continuous goal stream.
     * Torque, mode and configuration writes still revoke output. */
    if (result->effect != PROTOCOL_EFFECT_NONE &&
        !continuous_goal_write(result)) {
        app_runtime_revoke_output(state);
    }
    switch (result->effect) {
    case PROTOCOL_EFFECT_WRITE:
        /* Starting control caches legacy travel limits. End the session before changing
         * that envelope, even if storage is unavailable and the write is RAM-only. */
        if (state->arm_selected && registers_write_touches(&result->write,
                REG_MIN_ANGLE_LIMIT, REG_MAX_ANGLE_LIMIT + 1u))
            arm_extension_end_session(state);
        if (state->arm_selected &&
            (registers_write_touches(&result->write, 33u, 33u) ||
             registers_write_touches(&result->write, 41u, 47u))) {
            arm_extension_end_session(state);
            state->arm_selected = false;
            registers->byte[REG_TORQUE_ENABLE] = 0;
            app_runtime_revoke_output(state);
        }
#ifdef FW_TIMING_PROBE
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
            arm_extension_end_session(state);
            sensor_service_offset_written(&state->sensor_service, registers);
            state->control_initialized = false;
            app_runtime_queue_motion(state, false, false);
        }
        if (registers_write_touches(&result->write, 40u, 40u) &&
            registers->byte[REG_TORQUE_ENABLE] == 128u) {
            calibrate_position(state, 2048);
            break;
        }
        if (registers_write_touches(&result->write, REG_TORQUE_ENABLE, REG_TORQUE_ENABLE))
            arm_extension_torque_written(state);
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
        arm_extension_end_session(state);
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
