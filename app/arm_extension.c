#include "arm_extension.h"

#include "app_runtime.h"

#include <limits.h>

enum { EXT_OK, EXT_INVALID, EXT_STATE, EXT_SESSION, EXT_FULL, EXT_UNSUPPORTED };

/* Extension v1 wire constants stay at the protocol boundary. */
enum {
    ARM_ADDRESS_CAPABILITIES = 0x90,
    ARM_ADDRESS_CONFIGURATION = 0xA0,
    ARM_ADDRESS_PROFILES = 0xA1,
    ARM_ADDRESS_FEEDFORWARD = 0xA2,
    ARM_ADDRESS_STATE = 0xB0,
    ARM_ADDRESS_SELECT = 0xB8,
    ARM_ADDRESS_ARM = 0xBA,
    ARM_ADDRESS_COMPACT = 0xC0,
    ARM_ADDRESS_SENSOR_QUALITY = 0xD0,
    ARM_ADDRESS_DIAGNOSTIC = 0xDC,
    ARM_ADDRESS_SEGMENT = 0xE0,
    ARM_ADDRESS_TARGET = 0xF0,
};
enum {
    ARM_BYTES_CAPABILITIES = 16,
    ARM_BYTES_CONFIGURATION = 26,
    ARM_BYTES_PROFILES = 32,
    ARM_BYTES_FEEDFORWARD = 20,
    ARM_BYTES_STATE = 8,
    ARM_BYTES_SELECT = 1,
    ARM_BYTES_ARM = 2,
    ARM_BYTES_COMPACT = 30,
    ARM_BYTES_SENSOR_QUALITY = 6,
    ARM_BYTES_DIAGNOSTIC = 18,
    ARM_BYTES_SEGMENT = 20,
    ARM_BYTES_TARGET = 16,
};
enum {
    ARM_COMMAND_READ = 0x90,
    ARM_COMMAND_WRITE = 0x91,
    ARM_COMMAND_START = 0x92,
    ARM_COMMAND_DISARM = 0x93,
    ARM_COMMAND_HEARTBEAT = 0x94,
    ARM_COMMAND_STOP = 0x95,
    ARM_COMMAND_TAKEOVER = 0x96,
    ARM_COMMAND_STAGE_PROFILE = 0x97,
    ARM_COMMAND_COMMIT_PROFILE = 0x98,
    ARM_COMMAND_FEEDFORWARD = 0x99,
};


static uint16_t get_u16(const uint8_t *p)
{
    return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
}

static int32_t get_i32(const uint8_t *p)
{
    uint32_t value = (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
        ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
    if (value <= INT32_MAX) return (int32_t)value;
    return (int32_t)((int64_t)value - 4294967296LL);
}

static void put_u16(uint8_t *p, uint16_t v)
{
    p[0] = (uint8_t)v;
    p[1] = (uint8_t)(v >> 8);
}

static void put_u32(uint8_t *p, uint32_t v)
{
    p[0] = (uint8_t)v;
    p[1] = (uint8_t)(v >> 8);
    p[2] = (uint8_t)(v >> 16);
    p[3] = (uint8_t)(v >> 24);
}

static uint8_t read_extension(app_state_t *state, uint8_t address,
                              uint8_t count, uint8_t *out)
{
    const arm_control_t *arm = &state->arm;
    const arm_result_t *sample = &state->arm_result;
    if (address == ARM_ADDRESS_CAPABILITIES && count == ARM_BYTES_CAPABILITIES) {
        const uint8_t caps[16] = {'A','R','M','C', 1, 7, 2, 1,
                                  0x90, 0xA0, 0xB0, 0xC0, 0xD0, 0xDC, 0xE0, 0xF0};
        for (unsigned i = 0; i < 16u; ++i) out[i] = caps[i];
        return EXT_OK;
    }
    if (address == ARM_ADDRESS_CONFIGURATION && count == ARM_BYTES_CONFIGURATION) {
        put_u16(out, arm->config.kp_q8);
        put_u16(out + 2, arm->config.kd_q8);
        put_u16(out + 4, arm->config.ki_q8);
        put_u16(out + 6, arm->config.integral_limit);
        put_u16(out + 8, arm->config.effort_limit);
        put_u16(out + 10, arm->config.velocity_limit);
        put_u16(out + 12, arm->config.acceleration_limit);
        put_u16(out + 14, arm->config.timeout_ms);
        out[16] = arm->config.velocity_filter_q8;
        out[17] = 0;
        put_u32(out + 18, (uint32_t)arm->config.position_min_q8);
        put_u32(out + 22, (uint32_t)arm->config.position_max_q8);
        return EXT_OK;
    }
    if (address == ARM_ADDRESS_PROFILES && count == ARM_BYTES_PROFILES) {
        for (unsigned slot = 0; slot < 2; ++slot) {
            uint8_t *payload = out + 16 * slot;
            const arm_profile_t *profile = &arm->profiles[slot];
            put_u16(payload, arm->profile_generation[slot]);
            put_u16(payload + 2, profile->kp_q8);
            put_u16(payload + 4, profile->kd_q8);
            put_u16(payload + 6, profile->ki_q8);
            put_u16(payload + 8, profile->integral_limit);
            put_u16(payload + 10, profile->effort_limit);
            payload[12] = profile->velocity_filter_q8;
            payload[13] = 0;
            payload[14] = (uint8_t)(arm->active_profile == slot);
            payload[15] = (uint8_t)(arm->transition_bias != 0);
        }
        return EXT_OK;
    }
    if (address == ARM_ADDRESS_FEEDFORWARD && count == ARM_BYTES_FEEDFORWARD) {
        put_u32(out, arm->last_tick);
        put_u16(out + 4, arm->feedforward_sequence);
        put_u16(out + 6, (uint16_t)(arm->gravity_effort_q16 / 65536));
        put_u16(out + 8, (uint16_t)(arm->dynamic_effort_q16 / 65536));
        put_u16(out + 10, (uint16_t)arm->gravity_target);
        put_u16(out + 12, (uint16_t)arm->dynamic_target);
        put_u16(out + 14, arm->feedforward_slew);
        put_u16(out + 16, arm->feedforward_ttl_ms);
        out[18] = (uint8_t)(arm->feedforward_enabled | (arm->feedforward_stale << 1));
        out[19] = 0;
        return EXT_OK;
    }
    if (address == ARM_ADDRESS_STATE && count == ARM_BYTES_STATE) {
        out[0] = state->arm_selected;
        out[1] = arm->armed;
        out[2] = (uint8_t)(arm->running || arm->target_active);
        out[3] = arm->holding;
        out[4] = (uint8_t)(arm->queue_count + arm->target_pending);
        out[5] = (uint8_t)(arm->expired |
            ((state->output.phase == OUTPUT_READY) ? 2u : 0u));
        put_u16(out + 6, arm->session);
        return EXT_OK;
    }
    if (address == ARM_ADDRESS_COMPACT && count == ARM_BYTES_COMPACT) {
        put_u32(out, state->arm_sample_tick);
        put_u32(out + 4, (uint32_t)arm->measured_position_q8);
        put_u32(out + 8, (uint32_t)sample->reference_position_q8);
        put_u32(out + 12, (uint32_t)sample->measured_velocity_q8_s);
        put_u32(out + 16, (uint32_t)sample->reference_velocity_q8_s);
        put_u16(out + 20, (uint16_t)sample->requested_effort);
        put_u16(out + 22, (uint16_t)state->arm_applied_effort);
        put_u16(out + 24, arm->accepted_sequence);
        out[26] = (uint8_t)(sample->fresh | (sample->active << 1) |
            (sample->holding << 2) | (sample->saturated << 3) |
            (state->arm_drive_enabled << 4));
        out[27] = state->device.registers.byte[REG_SERVO_STATUS];
        put_u16(out + 28, state->arm_sample_sequence);
        return EXT_OK;
    }
    if (address == ARM_ADDRESS_SENSOR_QUALITY && count == ARM_BYTES_SENSOR_QUALITY) {
        const sensor_service_t *sensor = &state->sensor_service;
        out[0] = sensor->measurement.temperature; /* Raw converted ADC. */
        out[1] = sensor->temperature_validated;
        put_u16(out + 2, sensor->temperature_spikes);
        out[4] = (uint8_t)(sensor->temperature_valid |
            ((sensor->temperature_candidate_count != 0u) << 1));
        out[5] = sensor->temperature_candidate_count;
        return EXT_OK;
    }
    if (address == ARM_ADDRESS_DIAGNOSTIC && count == ARM_BYTES_DIAGNOSTIC) {
        put_u16(out, (uint16_t)sample->p_term);
        put_u16(out + 2, (uint16_t)sample->d_term);
        put_u16(out + 4, (uint16_t)sample->i_term);
        put_u16(out + 6, (uint16_t)sample->feedforward);
        put_u16(out + 8, (uint16_t)state->sensor_service.measurement.current);
        out[10] = state->sensor_service.measurement.voltage;
        out[11] = state->sensor_service.measurement.temperature;
        out[12] = (uint8_t)(arm->queue_count + arm->target_pending);
        out[13] = (uint8_t)(arm->running || arm->target_active);
        put_u16(out + 14, arm->elapsed_ms);
        put_u16(out + 16, arm->overrun_count);
        return EXT_OK;
    }
    return EXT_INVALID;
}

static uint8_t write_extension(app_state_t *state, register_table_t *registers,
                               uint8_t address, const uint8_t *data,
                               uint8_t count, uint32_t now_ms)
{
    if (address == ARM_ADDRESS_CONFIGURATION && count == ARM_BYTES_CONFIGURATION) {
        if (registers->byte[REG_TORQUE_ENABLE] != 0u) return EXT_STATE;
        if (data[17] != 0u) return EXT_INVALID;
        arm_config_t config = {
            .kp_q8 = get_u16(data),
            .kd_q8 = get_u16(data + 2),
            .ki_q8 = get_u16(data + 4),
            .integral_limit = get_u16(data + 6),
            .effort_limit = get_u16(data + 8),
            .velocity_limit = get_u16(data + 10),
            .acceleration_limit = get_u16(data + 12),
            .timeout_ms = get_u16(data + 14),
            .velocity_filter_q8 = data[16],
            .position_min_q8 = get_i32(data + 18),
            .position_max_q8 = get_i32(data + 22),
        };
        return arm_control_configure(&state->arm, config) ? EXT_OK : EXT_INVALID;
    }
    if (address == ARM_ADDRESS_SELECT && count == ARM_BYTES_SELECT) {
        if (registers->byte[REG_TORQUE_ENABLE] != 0u) return EXT_STATE;
        if (data[0] > 1u) return EXT_INVALID;
        if (data[0] && (!state->control_initialized ||
            now_ms - state->last_good_tick > 2u || state->arm.config.effort_limit == 0u))
            return EXT_STATE;
        if (data[0] &&
            (registers->byte[REG_SERVO_STATUS] & registers->byte[REG_PROTECTION_SHUTDOWN_MASK]) != 0u)
            return EXT_STATE;
        app_runtime_revoke_output(state);
        arm_control_disarm(&state->arm);
        state->arm_selected = data[0] != 0u;
        if (state->arm_selected) state->motion_rejected = false;
        return EXT_OK;
    }
    if (address == ARM_ADDRESS_ARM && count == ARM_BYTES_ARM) {
        if (!state->arm_selected || registers->byte[REG_TORQUE_ENABLE] != 0u ||
            (registers->byte[REG_SERVO_STATUS] & registers->byte[REG_PROTECTION_SHUTDOWN_MASK]) != 0u ||
            now_ms - state->last_good_tick > 2u) return EXT_STATE;
        return arm_control_arm(&state->arm, get_u16(data),
            state->sensor_service.measurement.arm_position, now_ms) ? EXT_OK : EXT_SESSION;
    }
    if (address == ARM_ADDRESS_SEGMENT && count == ARM_BYTES_SEGMENT) {
        arm_segment_t segment = {
            .sequence = get_u16(data + 2),
            .duration_ms = get_u16(data + 4),
            .position_q8 = get_i32(data + 6),
            .velocity_q8_s = get_i32(data + 10),
            .acceleration_q8_s2 = get_i32(data + 14),
            .feedforward = (int16_t)get_u16(data + 18),
        };
        if (!state->arm_selected || !state->arm.armed) return EXT_STATE;
        return arm_control_submit(&state->arm, get_u16(data), segment, now_ms) ?
            EXT_OK : EXT_FULL;
    }
    if (address == ARM_ADDRESS_TARGET && count == ARM_BYTES_TARGET) {
        arm_target_t target = {
            .sequence = get_u16(data + 2),
            .position_q8 = get_i32(data + 4),
            .speed_limit = get_u16(data + 8),
            .acceleration = get_u16(data + 10),
            .braking = get_u16(data + 12),
            .feedforward = (int16_t)get_u16(data + 14),
        };
        if (!state->arm_selected || !state->arm.armed) return EXT_STATE;
        return arm_control_target(&state->arm, get_u16(data), target, now_ms) ?
            EXT_OK : EXT_FULL;
    }
    return EXT_INVALID;
}

/* This only validates the common powered-command gate. Each command still
 * owns its session, sequence and lifecycle checks in the portable controller. */
static bool powered_command_ready(const app_state_t *state,
                                   const register_table_t *registers,
                                   uint32_t now_ms)
{
    return state->arm_selected && registers->byte[REG_TORQUE_ENABLE] == 1u &&
        registers->byte[REG_SERVO_STATUS] == 0u && state->arm_drive_enabled &&
        state->output.phase == OUTPUT_READY && now_ms - state->last_good_tick <= 2u;
}

void arm_extension_process(const protocol_packet_t *packet,
                           register_table_t *registers,
                           protocol_result_t *result, void *context)
{
    app_state_t *state = context;
    uint8_t status = EXT_UNSUPPORTED;
    uint8_t data_count = 0;
    uint8_t *response = result->response + 5u;
    uint32_t now_ms = sensor_driver_ticks(&state->sensors);
    switch (packet->instruction) {
    case ARM_COMMAND_READ:
        if (packet->param_count == 2u && packet->params[1] <= 80u) {
            status = read_extension(state, packet->params[0],
                                    packet->params[1], response + 1u);
            if (status == EXT_OK) data_count = packet->params[1];
        } else status = EXT_INVALID;
        break;
    case ARM_COMMAND_WRITE:
        if (packet->param_count >= 2u && packet->id != PROTOCOL_BROADCAST)
            status = write_extension(state, registers, packet->params[0],
                packet->params + 1u, (uint8_t)(packet->param_count - 1u), now_ms);
        else status = EXT_INVALID;
        break;
    case ARM_COMMAND_START:
        if (packet->param_count == 2u && state->arm_selected &&
            registers->byte[REG_TORQUE_ENABLE] == 1u)
            status = arm_control_start(&state->arm, get_u16(packet->params), now_ms)
                ? EXT_OK : EXT_SESSION;
        else status = EXT_STATE;
        break;
    case ARM_COMMAND_DISARM:
        if (packet->param_count == 2u && state->arm_selected &&
            state->arm.session == get_u16(packet->params)) {
            arm_control_disarm(&state->arm);
            registers->byte[REG_TORQUE_ENABLE] = 0u;
            app_runtime_revoke_output(state);
            status = EXT_OK;
        } else status = EXT_SESSION;
        break;
    case ARM_COMMAND_HEARTBEAT:
        if (packet->param_count == 2u && state->arm_selected &&
            state->arm.armed && !state->arm.expired &&
            state->arm.session == get_u16(packet->params)) {
            state->arm.last_command_tick = now_ms;
            status = EXT_OK;
        } else status = EXT_SESSION;
        break;
    case ARM_COMMAND_FEEDFORWARD: /* independent bounded gravity/dynamic bias update */
        if (packet->id == PROTOCOL_BROADCAST || packet->param_count != 12u)
            status = EXT_INVALID;
        else if (!powered_command_ready(state, registers, now_ms))
            status = EXT_STATE;
        else {
            const uint8_t *payload = packet->params;
            status = arm_control_feedforward(&state->arm, get_u16(payload), get_u16(payload + 2),
                (int16_t)get_u16(payload + 4), (int16_t)get_u16(payload + 6), get_u16(payload + 8),
                get_u16(payload + 10), now_ms) ? EXT_OK : EXT_STATE;
        }
        break;
    case ARM_COMMAND_STAGE_PROFILE: /* stage candidate; all bytes validate before changing state */
    case ARM_COMMAND_COMMIT_PROFILE: /* commit recovery/candidate at stopped reference */
        if (packet->id == PROTOCOL_BROADCAST || packet->param_count !=
            (packet->instruction == ARM_COMMAND_STAGE_PROFILE ? 17u : 7u)) status = EXT_INVALID;
        else if (!powered_command_ready(state, registers, now_ms))
            status = EXT_STATE;
        else if (packet->instruction == ARM_COMMAND_STAGE_PROFILE) {
            const uint8_t *payload = packet->params;
            arm_profile_t profile = {
                .kp_q8 = get_u16(payload + 5),
                .kd_q8 = get_u16(payload + 7),
                .ki_q8 = get_u16(payload + 9),
                .integral_limit = get_u16(payload + 11),
                .effort_limit = get_u16(payload + 13),
                .velocity_filter_q8 = payload[15],
            };
            status = payload[16] ? EXT_INVALID :
                arm_control_stage_profile(&state->arm, get_u16(payload), payload[2], get_u16(payload + 3), profile)
                ? EXT_OK : EXT_STATE;
        } else {
            const uint8_t *payload = packet->params;
            status = arm_control_commit_profile(&state->arm, get_u16(payload), get_u16(payload + 2),
                payload[4], get_u16(payload + 5), now_ms) ? EXT_OK : EXT_STATE;
        }
        break;
    case ARM_COMMAND_STOP: /* controlled stop: preserve torque and load bias */
    case ARM_COMMAND_TAKEOVER: /* explicit powered takeover: old session/sequence, new session */
        if (packet->id == PROTOCOL_BROADCAST ||
            packet->param_count != (packet->instruction == ARM_COMMAND_STOP ? 2u : 6u)) {
            status = EXT_INVALID;
        } else if (!powered_command_ready(state, registers, now_ms)) {
            status = EXT_STATE;
        } else if (packet->instruction == ARM_COMMAND_STOP) {
            status = arm_control_stop(&state->arm, get_u16(packet->params), now_ms)
                ? EXT_OK : EXT_SESSION;
        } else {
            status = arm_control_takeover(&state->arm, get_u16(packet->params),
                get_u16(packet->params + 2), get_u16(packet->params + 4), now_ms)
                ? EXT_OK : EXT_STATE;
        }
        break;
    }
    response[0] = status;
    protocol_extension_response(packet, registers, result,
                                (uint8_t)(1u + data_count));
}
