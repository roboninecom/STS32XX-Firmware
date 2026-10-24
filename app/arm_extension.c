#include "arm_extension.h"

#include "app_runtime.h"

#include <limits.h>

enum { EXT_OK, EXT_INVALID, EXT_STATE, EXT_UNSUPPORTED = 5 };

/* Extension v9.0. Removed selectors A1/A3/B0/BA/E0/F0 and instructions
 * 92/93/94/95/96/97/98 remain reserved; old commands must never acquire new meanings. */
enum {
    ARM_ADDRESS_CAPABILITIES = 0x90,
    ARM_ADDRESS_CONFIGURATION = 0xA0,
    ARM_ADDRESS_SELECT = 0xB8,
    ARM_ADDRESS_FEEDBACK = 0xC1,
    ARM_ADDRESS_TUNING = 0xC2,
};
enum {
    ARM_BYTES_CAPABILITIES = 8,
    ARM_BYTES_CONFIGURATION = 24,
    ARM_BYTES_SELECT = 3,
    ARM_TARGET_ENTRY_BYTES = 9,
    ARM_MAX_TARGETS = 6,
};
enum {
    ARM_COMMAND_READ = 0x90,
    ARM_COMMAND_WRITE = 0x91,
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

static void encode_sample(app_state_t *state)
{
    const arm_control_t *arm = &state->arm;
    const arm_result_t *sample = &state->arm_result;
    const sensor_service_t *sensor = &state->sensor_service;
    bool computed = state->arm_selected && sample->advanced;
    uint8_t *out = state->arm_feedback;
    for (unsigned i = 0; i < ARM_TUNING_BYTES; ++i) out[i] = 0;
    uint16_t flags = (uint16_t)((sensor->temperature_valid << 10) |
        (state->arm_selected << 14));
    if (computed) flags |= (uint16_t)(sample->fresh | (sample->active << 1) |
        (sample->saturated << 3) |
        (state->arm_drive_enabled << 4) | (arm->armed << 5) |
        ((state->output.phase == OUTPUT_READY) << 7) |
        (arm->gravity_received << 8) |
        (arm->target_active << 12));
    /* Capture and reads share the foreground owner. Sensor-only samples keep
     * torque-off/legacy health checks available without claiming usable control.
     * A computed fault sample retains its terms despite subsequent disarming. */
    put_u32(out, computed ? state->arm_sample_tick : state->last_good_tick);
    put_u16(out + 4, state->arm_feedback_sequence);
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
    put_u32(out + 32, (uint32_t)sample->reference_position_q8);
    put_u32(out + 36, (uint32_t)sample->reference_velocity_q8_s);
    put_u16(out + 40, (uint16_t)sample->requested_effort);
    put_u16(out + 42, (uint16_t)sample->p_term);
    put_u16(out + 44, (uint16_t)sample->d_term);
    put_u16(out + 46, (uint16_t)sample->i_term);
    put_u16(out + 48, (uint16_t)sample->gravity_feedforward);
    put_u16(out + 50, (uint16_t)sample->velocity_feedforward);
    put_u16(out + 52, arm->overrun_count);
}

void arm_extension_publish_sample(app_state_t *state)
{
    /* Keep sequence tied to acquisition, including legacy health samples. */
    if (state->arm_selected && state->arm.armed && !state->arm_result.advanced) return;
    ++state->arm_feedback_sequence;
    /* Preserve computed terms at their control boundary. Legacy health has no
     * arm terms and can be encoded from the same foreground-owned sample on read. */
    if (state->arm_selected) encode_sample(state);
}

static uint8_t read_extension(app_state_t *state, uint8_t address,
                              uint8_t count, uint8_t *out)
{
    const arm_control_t *arm = &state->arm;
    if (address == ARM_ADDRESS_CAPABILITIES && count == ARM_BYTES_CAPABILITIES) {
        const uint8_t caps[ARM_BYTES_CAPABILITIES] = {'A','R','M','C', 9, 0, 0, 1};
        for (unsigned i = 0; i < ARM_BYTES_CAPABILITIES; ++i) out[i] = caps[i];
        return EXT_OK;
    }
    if ((address == ARM_ADDRESS_FEEDBACK && count == ARM_FEEDBACK_BYTES) ||
        (address == ARM_ADDRESS_TUNING && count == ARM_TUNING_BYTES)) {
        if (!state->arm_selected) encode_sample(state);
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
        out[14] = arm->config.velocity_filter_q8;
        out[15] = arm->config.ramp_time_ms;
        put_u16(out + 16, arm->config.velocity_ff.positive_gain_q8);
        put_u16(out + 18, arm->config.velocity_ff.negative_gain_q8);
        put_u16(out + 20, arm->config.velocity_ff.effort_limit);
        put_u16(out + 22, arm->config.gravity_slew);
        return EXT_OK;
    }
    return EXT_INVALID;
}

static uint8_t write_extension(app_state_t *state, register_table_t *registers,
                               uint8_t address, const uint8_t *data,
                               uint8_t count)
{
    if (address == ARM_ADDRESS_CONFIGURATION && count == ARM_BYTES_CONFIGURATION) {
        if (registers->byte[REG_TORQUE_ENABLE] != 0u) return EXT_STATE;
        arm_config_t config = {
            .kp_q8 = get_u16(data),
            .kd_q8 = get_u16(data + 2),
            .ki_q8 = get_u16(data + 4),
            .integral_limit = get_u16(data + 6),
            .effort_limit = get_u16(data + 8),
            .velocity_limit = get_u16(data + 10),
            .acceleration_limit = get_u16(data + 12),
            .velocity_filter_q8 = data[14],
            .ramp_time_ms = data[15],
            .velocity_ff = {get_u16(data + 16), get_u16(data + 18), get_u16(data + 20)},
            .gravity_slew = get_u16(data + 22),
        };
        return arm_control_configure(&state->arm, config) ? EXT_OK : EXT_INVALID;
    }
    if (address == ARM_ADDRESS_SELECT && count == ARM_BYTES_SELECT) {
        if (registers->byte[REG_TORQUE_ENABLE] != 0u) return EXT_STATE;
        uint16_t session = get_u16(data + 1);
        if (data[0] > 1u || (data[0] == 0u ? session != 0u : session == 0u))
            return EXT_INVALID;
        app_runtime_revoke_output(state);
        arm_extension_end_session(state);
        state->arm_selected = data[0] != 0u;
        state->arm_pending_session = session;
        if (state->arm_selected) state->motion_rejected = false;
        return EXT_OK;
    }

    return EXT_INVALID;
}

void arm_extension_end_session(app_state_t *state)
{
    arm_control_disarm(&state->arm);
    state->arm_pending_session = 0;
    if (state->arm_selected)
        state->device.registers.byte[REG_TORQUE_ENABLE] = 0;
}

void arm_extension_torque_written(app_state_t *state)
{
    if (!state->arm_selected) return;
    register_table_t *registers = &state->device.registers;
    if (registers->byte[REG_TORQUE_ENABLE] != 1u) {
        arm_extension_end_session(state);
        return;
    }
    if (state->arm.armed) return; /* Repeated enable is not a new session. */
    uint16_t session = state->arm_pending_session;
    state->arm_pending_session = 0; /* Failed attempts also require new setup. */
    uint32_t now_ms = sensor_driver_ticks(&state->sensors);
    bool ready = state->control_initialized && now_ms - state->last_good_tick <= 2u &&
        (state->output.phase == OUTPUT_READY || state->output.phase == OUTPUT_REQUALIFYING) &&
        (registers->byte[REG_SERVO_STATUS] & registers->byte[REG_PROTECTION_SHUTDOWN_MASK]) == 0u;
    if (!ready || !arm_control_arm(&state->arm, session,
            state->sensor_service.measurement.arm_position, now_ms,
            registers_u16(registers, REG_MIN_ANGLE_LIMIT),
            registers_u16(registers, REG_MAX_ANGLE_LIMIT))) {
        arm_extension_end_session(state);
        return;
    }
    /* Feedback cannot become usable until the new controller has stepped. */
    state->arm_feedback[12] &= (uint8_t)~1u;
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
        if (entry[0] == 0u || entry[0] >= PROTOCOL_BROADCAST ||
            get_u16(entry + 7) == 0u) return EXT_INVALID;
        for (unsigned previous = 2; previous < offset; previous += ARM_TARGET_ENTRY_BYTES)
            if (data[previous] == entry[0]) return EXT_INVALID;
        if (entry[0] == registers->byte[REG_ID]) local = entry;
    }
    if (!local) return EXT_OK; /* Unlisted servos keep their current target. */
    if (!powered_command_ready(state, registers, now_ms)) return EXT_STATE;
    arm_target_t target = {
        .sequence = get_u16(local + 1),
        .position_q8 = get_i32(local + 3),
        .speed_limit = get_u16(local + 7),
    };
    bool accepted = arm_control_target(&state->arm, get_u16(data), target);
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
                packet->params + 1u, (uint8_t)(packet->param_count - 1u));
        else status = EXT_INVALID;
        break;
    case ARM_COMMAND_TARGETS:
        status = apply_targets(state, registers, packet->params, packet->param_count, now_ms);
        break;
    case ARM_COMMAND_GRAVITY: /* Host gravity only; motion compensation is local. */
        if (packet->id == PROTOCOL_BROADCAST || packet->param_count != 6u)
            status = EXT_INVALID;
        else if (!powered_command_ready(state, registers, now_ms))
            status = EXT_STATE;
        else {
            const uint8_t *payload = packet->params;
            status = arm_control_gravity(&state->arm, get_u16(payload), get_u16(payload + 2),
                (int16_t)get_u16(payload + 4), now_ms) ? EXT_OK : EXT_STATE;
        }
        break;
    }
    response[0] = status;
    protocol_extension_response(packet, registers, result,
                                (uint8_t)(1u + data_count));
}
