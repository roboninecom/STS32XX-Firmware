#include "arm_extension.h"

#include "app_runtime.h"

#include <limits.h>

enum { EXT_OK, EXT_INVALID, EXT_STATE, EXT_SESSION, EXT_RESERVED, EXT_UNSUPPORTED };

/* Extension v4.0 wire constants stay at the protocol boundary.
 * Retired selectors B0/E0/F0 and opcodes 92/96 stay reserved; never reuse them. */
enum {
    ARM_ADDRESS_CAPABILITIES = 0x90,
    ARM_ADDRESS_CONFIGURATION = 0xA0,
    ARM_ADDRESS_PROFILES = 0xA1,
    ARM_ADDRESS_VELOCITY_FF = 0xA3,
    ARM_ADDRESS_SELECT = 0xB8,
    ARM_ADDRESS_ARM = 0xBA,
    ARM_ADDRESS_FEEDBACK = 0xC1,
    ARM_ADDRESS_TUNING = 0xC2,
};
enum {
    ARM_BYTES_CAPABILITIES = 16,
    ARM_BYTES_CONFIGURATION = 26,
    ARM_BYTES_PROFILES = 32,
    ARM_BYTES_VELOCITY_FF = 6,
    ARM_BYTES_SELECT = 1,
    ARM_BYTES_ARM = 2,
    ARM_TARGET_ENTRY_BYTES = 11,
    ARM_MAX_TARGETS = 6,
};
enum {
    ARM_COMMAND_READ = 0x90,
    ARM_COMMAND_WRITE = 0x91,
    ARM_COMMAND_DISARM = 0x93,
    ARM_COMMAND_HEARTBEAT = 0x94,
    ARM_COMMAND_STOP = 0x95,
    ARM_COMMAND_STAGE_PROFILE = 0x97,
    ARM_COMMAND_COMMIT_PROFILE = 0x98,
    ARM_COMMAND_GRAVITY = 0x99,
    ARM_COMMAND_TARGETS = 0x9A,
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

void arm_extension_publish_sample(app_state_t *state)
{
    const arm_control_t *arm = &state->arm;
    const arm_result_t *sample = &state->arm_result;
    const sensor_service_t *sensor = &state->sensor_service;
    /* Same-tick calls reuse output without computing new P/D/I. Retain the
     * last complete sample; the read gate invalidates it if output is revoked. */
    if (state->arm_selected && arm->armed && !sample->advanced) return;
    bool computed = state->arm_selected && sample->advanced;
    uint8_t *out = state->arm_feedback;
    for (unsigned i = 0; i < ARM_TUNING_BYTES; ++i) out[i] = 0;
    uint16_t flags = (uint16_t)((sensor->temperature_valid << 10) |
        ((sensor->temperature_candidate_count != 0u) << 11) |
        (state->arm_selected << 14));
    if (computed) flags |= (uint16_t)(sample->fresh | (sample->active << 1) |
        (sample->holding << 2) | (sample->saturated << 3) |
        (state->arm_drive_enabled << 4) | (arm->armed << 5) |
        (arm->expired << 6) | ((state->output.phase == OUTPUT_READY) << 7) |
        (arm->gravity_received << 8) | (arm->gravity_stale << 9) |
        (arm->target_active << 12));
    /* Capture and reads share the foreground owner. Sensor-only samples keep
     * torque-off/legacy health checks available without claiming usable control.
     * A computed fault sample retains its terms despite subsequent disarming. */
    put_u32(out, computed ? state->arm_sample_tick : state->last_good_tick);
    put_u16(out + 4, ++state->arm_feedback_sequence);
    put_u16(out + 12, flags);
    put_u32(out + 14, (uint32_t)sensor->measurement.arm_position * 256u);
    put_u16(out + 24, (uint16_t)sensor->measurement.current);
    out[26] = sensor->measurement.voltage;
    out[27] = sensor->temperature_validated;
    out[28] = state->device.registers.byte[REG_SERVO_STATUS];
    if (!computed) return;
    put_u16(out + 6, sample->session);
    put_u16(out + 8, sample->accepted_sequence);
    put_u16(out + 10, sample->gravity_sequence);
    put_u32(out + 18, (uint32_t)sample->measured_velocity_q8_s);
    put_u16(out + 22, (uint16_t)state->arm_applied_effort);
    out[29] = arm->active_profile;
    put_u32(out + 32, (uint32_t)sample->reference_position_q8);
    put_u32(out + 36, (uint32_t)sample->reference_velocity_q8_s);
    put_u16(out + 40, (uint16_t)sample->requested_effort);
    put_u16(out + 42, (uint16_t)sample->p_term);
    put_u16(out + 44, (uint16_t)sample->d_term);
    put_u16(out + 46, (uint16_t)sample->i_term);
    put_u16(out + 48, (uint16_t)sample->gravity_feedforward);
    put_u16(out + 50, (uint16_t)sample->velocity_feedforward);
    put_u16(out + 52, (uint16_t)sample->transition_bias);
    put_u16(out + 54, arm->overrun_count);
}

static uint8_t read_extension(app_state_t *state, uint8_t address,
                              uint8_t count, uint8_t *out)
{
    const arm_control_t *arm = &state->arm;
    if (address == ARM_ADDRESS_CAPABILITIES && count == ARM_BYTES_CAPABILITIES) {
        /* Byte 6 and selector slots 12/15 are reserved after queue/B0/F0 removal. */
        const uint8_t caps[16] = {'A','R','M','C', 4, 0, 0, 1,
                                  0x90, 0xA0, 0xA1, 0xA3, 0x00, 0xC1, 0xC2, 0x00};
        for (unsigned i = 0; i < 16u; ++i) out[i] = caps[i];
        return EXT_OK;
    }
    if (address == ARM_ADDRESS_VELOCITY_FF && count == ARM_BYTES_VELOCITY_FF) {
        put_u16(out, arm->velocity_ff.positive_gain_q8);
        put_u16(out + 2, arm->velocity_ff.negative_gain_q8);
        put_u16(out + 4, arm->velocity_ff.effort_limit);
        return EXT_OK;
    }
    if ((address == ARM_ADDRESS_FEEDBACK && count == ARM_FEEDBACK_BYTES) ||
        (address == ARM_ADDRESS_TUNING && count == ARM_TUNING_BYTES)) {
        for (unsigned i = 0; i < count; ++i) out[i] = state->arm_feedback[i];
        uint32_t tick = (uint32_t)get_i32(out);
        uint32_t age = sensor_driver_ticks(&state->sensors) - tick;
        put_u16(out + 30, age > UINT16_MAX ? UINT16_MAX : (uint16_t)age);
        /* State changes can invalidate an otherwise recent captured sample.
         * Keep historical fields intact, but clear its usable/fresh bit. */
        if (age > 2u || !state->arm_selected || !arm->armed ||
            !state->arm_drive_enabled || state->output.phase != OUTPUT_READY ||
            get_u16(out + 6) != arm->session ||
            get_u16(out + 8) != arm->accepted_sequence ||
            get_u16(out + 10) != arm->gravity_sequence)
            out[12] &= (uint8_t)~1u;
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
        out[17] = arm->config.ramp_time_ms;
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



    return EXT_INVALID;
}

static uint8_t write_extension(app_state_t *state, register_table_t *registers,
                               uint8_t address, const uint8_t *data,
                               uint8_t count, uint32_t now_ms)
{
    if (address == ARM_ADDRESS_VELOCITY_FF && count == ARM_BYTES_VELOCITY_FF) {
        if (registers->byte[REG_TORQUE_ENABLE] != 0u || state->arm.armed)
            return EXT_STATE;
        arm_velocity_ff_t config = {
            .positive_gain_q8 = get_u16(data),
            .negative_gain_q8 = get_u16(data + 2),
            .effort_limit = get_u16(data + 4),
        };
        return arm_control_configure_velocity_ff(&state->arm, config) ?
            EXT_OK : EXT_INVALID;
    }
    if (address == ARM_ADDRESS_CONFIGURATION && count == ARM_BYTES_CONFIGURATION) {
        if (registers->byte[REG_TORQUE_ENABLE] != 0u) return EXT_STATE;
        if (data[17] == 0u) return EXT_INVALID;
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
            .ramp_time_ms = data[17],
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
        if (!arm_control_arm(&state->arm, get_u16(data),
            state->sensor_service.measurement.arm_position, now_ms)) return EXT_SESSION;
        /* A disarmed restart may reuse a session number within the same tick.
         * No old sample becomes usable until the new controller has stepped. */
        state->arm_feedback[12] &= (uint8_t)~1u;
        return EXT_OK;
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

/* One complete packet replaces staging and START. Validate every entry before
 * touching this servo, even when a malformed entry belongs to another axis.
 * Acceptance is per servo: hosts verify each sampled accepted_sequence. */
static uint8_t apply_targets(app_state_t *state, const register_table_t *registers,
                             const uint8_t *data, uint8_t count, uint32_t now_ms)
{
    if (count < 2u + ARM_TARGET_ENTRY_BYTES ||
        count > 2u + ARM_MAX_TARGETS * ARM_TARGET_ENTRY_BYTES ||
        (count - 2u) % ARM_TARGET_ENTRY_BYTES != 0u || get_u16(data) == 0u)
        return EXT_INVALID;
    const uint8_t *local = 0;
    for (unsigned offset = 2; offset < count; offset += ARM_TARGET_ENTRY_BYTES) {
        const uint8_t *entry = data + offset;
        uint16_t acceleration = get_u16(entry + 9);
        if (entry[0] == 0u || entry[0] >= PROTOCOL_BROADCAST ||
            get_u16(entry + 1) == 0u || get_u16(entry + 7) == 0u ||
            acceleration == 0u) return EXT_INVALID;
        for (unsigned previous = 2; previous < offset; previous += ARM_TARGET_ENTRY_BYTES)
            if (data[previous] == entry[0]) return EXT_INVALID;
        if (entry[0] == registers->byte[REG_ID]) local = entry;
    }
    if (!local) return EXT_OK; /* Unlisted servos do not renew their lease. */
    if (!powered_command_ready(state, registers, now_ms)) return EXT_STATE;
    arm_target_t target = {
        .sequence = get_u16(local + 1),
        .position_q8 = get_i32(local + 3),
        .speed_limit = get_u16(local + 7),
        .acceleration = get_u16(local + 9),
    };
#ifdef FW_ARM_TIMING_PROBE
    uint32_t started = arm_motion_clock();
#endif
    bool accepted = arm_control_target(&state->arm, get_u16(data), target, now_ms);
#ifdef FW_ARM_TIMING_PROBE
    arm_motion_record(ARM_TIMING_TARGET, started);
#endif
    return accepted ? EXT_OK : EXT_STATE;
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
    case ARM_COMMAND_TARGETS:
        status = apply_targets(state, registers, packet->params, packet->param_count, now_ms);
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
    case ARM_COMMAND_GRAVITY: /* Host gravity only; motion compensation is local. */
        if (packet->id == PROTOCOL_BROADCAST || packet->param_count != 10u)
            status = EXT_INVALID;
        else if (!powered_command_ready(state, registers, now_ms))
            status = EXT_STATE;
        else {
            const uint8_t *payload = packet->params;
            status = arm_control_gravity(&state->arm, get_u16(payload), get_u16(payload + 2),
                (int16_t)get_u16(payload + 4), get_u16(payload + 6),
                get_u16(payload + 8), now_ms) ? EXT_OK : EXT_STATE;
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
        if (packet->id == PROTOCOL_BROADCAST ||
            packet->param_count != 2u) {
            status = EXT_INVALID;
        } else if (!powered_command_ready(state, registers, now_ms)) {
            status = EXT_STATE;
        } else {
#ifdef FW_ARM_TIMING_PROBE
            uint32_t started = arm_motion_clock();
#endif
            status = arm_control_stop(&state->arm, get_u16(packet->params), now_ms)
                ? EXT_OK : EXT_SESSION;
#ifdef FW_ARM_TIMING_PROBE
            arm_motion_record(ARM_TIMING_STOP, started);
#endif
        }
        break;
    }
    response[0] = status;
    protocol_extension_response(packet, registers, result,
                                (uint8_t)(1u + data_count));
}
