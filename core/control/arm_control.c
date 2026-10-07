#include "arm_control.h"

#include <limits.h>

static int32_t clamp_i32(int64_t value)
{
    if (value > INT32_MAX) return INT32_MAX;
    if (value < INT32_MIN) return INT32_MIN;
    return (int32_t)value;
}

static int16_t clamp_effort(int64_t value, uint16_t limit)
{
    if (value > limit) return (int16_t)limit;
    if (value < -(int64_t)limit) return (int16_t)-(int32_t)limit;
    return (int16_t)value;
}

static int32_t effort_magnitude(int32_t value)
{
    /* Inputs are configured effort values, never INT32_MIN. */
    return value < 0 ? -value : value;
}

void arm_control_init(arm_control_t *state, int32_t position_counts,
                      uint32_t now_ms)
{
    *state = (arm_control_t){0};
    state->measured_position_q8 = position_counts * 256;
    arm_motion_init(&state->motion, state->measured_position_q8);
    state->last_reference_position_q8 = state->measured_position_q8;
    state->last_tick = now_ms;
    state->last_command_tick = now_ms;
    state->initialized = true;
}

bool arm_control_configure(arm_control_t *state, arm_config_t config)
{
    if (state == 0 || state->armed || config.effort_limit == 0u ||
        config.effort_limit > 1000u || config.integral_limit > config.effort_limit ||
        config.velocity_limit == 0u || config.acceleration_limit == 0u ||
        config.acceleration_limit > ARM_MAX_ACCELERATION_COUNTS_S2 ||
        config.timeout_ms < 20u || config.timeout_ms > 2000u ||
        config.velocity_filter_q8 == 0u || config.ramp_time_ms == 0u ||
        config.position_min_q8 < -32767 * 256 ||
        config.position_max_q8 > 32767 * 256 ||
        config.position_min_q8 >= config.position_max_q8) return false;
    state->config = config;
    /* A new base configuration requires deliberate local FF reconfiguration. */
    state->velocity_ff = (arm_velocity_ff_t){0};
    state->profiles[0] = (arm_profile_t){
        .kp_q8 = config.kp_q8,
        .kd_q8 = config.kd_q8,
        .ki_q8 = config.ki_q8,
        .integral_limit = config.integral_limit,
        .effort_limit = config.effort_limit,
        .velocity_filter_q8 = config.velocity_filter_q8,
    };
    state->profile_generation[0] = 1;
    state->profile_generation[1] = 0;
    state->active_profile = 0;
    state->transition_bias = 0;
    return true;
}

bool arm_control_configure_velocity_ff(arm_control_t *state,
                                        arm_velocity_ff_t config)
{
    if (state == 0 || !state->initialized || state->armed ||
        state->config.effort_limit == 0u ||
        config.effort_limit > state->config.effort_limit ||
        (config.effort_limit == 0u &&
         (config.positive_gain_q8 != 0u || config.negative_gain_q8 != 0u)))
        return false;
    state->velocity_ff = config;
    return true;
}

bool arm_control_arm(arm_control_t *state, uint16_t session,
                     int32_t position_counts, uint32_t now_ms)
{
    if (state == 0 || !state->initialized || state->config.effort_limit == 0u ||
        session == 0u || state->armed ||
        position_counts < -32767 || position_counts > 32767) return false;
    if ((int64_t)position_counts * 256 < state->config.position_min_q8 ||
        (int64_t)position_counts * 256 > state->config.position_max_q8)
        return false;
    state->gravity_received = state->gravity_stale = false;
    state->gravity_sequence = 0;
    state->gravity_effort_q16 = 0;
    state->gravity_target = 0;
    state->session = session;
    state->armed = true;
    state->expired = false;
    state->holding = true;
    state->target_active = false;
    state->accepted_sequence = 0;
    state->measured_position_q8 = position_counts * 256;
    arm_motion_init(&state->motion, state->measured_position_q8);
    state->last_reference_position_q8 = state->measured_position_q8;
    state->last_reference_velocity_q8_s = 0;
    state->filtered_velocity_q8_s = 0;
    for (unsigned i = 0; i < ARM_VELOCITY_WINDOW; ++i) {
        state->velocity_positions_q8[i] = state->measured_position_q8;
        state->velocity_intervals_ms[i] = 1;
    }
    state->velocity_cursor = 0;
    state->stationary_ms = 0;
    state->velocity_window_ms = ARM_VELOCITY_WINDOW;
    state->transition_bias = 0;
    state->last_feedforward = 0;
    state->last_requested_effort = 0;
    state->integral_pending = false;
    state->integral_effort_q16_ms = 0;
    state->last_tick = state->last_command_tick = now_ms;
    return true;
}

void arm_control_disarm(arm_control_t *state)
{
    if (state == 0) return;
    state->armed = state->holding = false;
    state->target_active = false;
    state->expired = false;
    state->integral_effort_q16_ms = 0;
    state->integral_pending = false;
    state->session = 0;
    state->gravity_received = false;
    state->gravity_effort_q16 = 0;
    state->gravity_target = 0;
    state->gravity_sequence = 0;
}

bool arm_control_target(arm_control_t *state, uint16_t session,
                        arm_target_t target, uint32_t now_ms)
{
    if (state == 0 || !state->armed || state->expired ||
        state->session != session ||
        target.sequence == 0u ||
        target.sequence != (uint16_t)(state->accepted_sequence + 1u) ||
        target.speed_limit == 0u || target.acceleration == 0u) return false;
    /* Commands request motion; configuration owns its envelope. Clamp before
     * comparing active limits or planning, so repeated out-of-range targets
     * behave exactly like requests for the same reachable boundary. */
    if (target.position_q8 < state->config.position_min_q8)
        target.position_q8 = state->config.position_min_q8;
    if (target.position_q8 > state->config.position_max_q8)
        target.position_q8 = state->config.position_max_q8;
    if (target.speed_limit > state->config.velocity_limit)
        target.speed_limit = state->config.velocity_limit;
    if (target.acceleration > state->config.acceleration_limit)
        target.acceleration = state->config.acceleration_limit;
    /* Limits are setup for each rest-to-rest move. Streaming retargets preserve
     * them so the current acceleration and its stopping envelope remain valid. */
    if (!arm_motion_idle(&state->motion) &&
        (target.speed_limit != state->motion.speed_limit ||
         target.acceleration != state->motion.acceleration_limit)) return false;
    /* Plan atomically from the current reference. Failed commands neither
     * consume a sequence nor extend the session lease. */
    if (!arm_motion_target(&state->motion, target.position_q8,
        target.speed_limit, target.acceleration, state->config.ramp_time_ms,
        state->config.position_min_q8, state->config.position_max_q8)) return false;
    state->accepted_sequence = target.sequence;
    state->target_active = !arm_motion_idle(&state->motion);
    state->holding = !state->target_active;
    state->last_command_tick = now_ms;
    return true;
}

bool arm_control_stop(arm_control_t *state, uint16_t session, uint32_t now_ms)
{
    if (state == 0 || !state->armed || state->session != session ||
        now_ms - state->last_tick > 2u) return false;
    if (!arm_motion_stop(&state->motion, state->config.ramp_time_ms,
        state->config.position_min_q8, state->config.position_max_q8)) return false;
    state->target_active = !arm_motion_idle(&state->motion);
    state->holding = !state->target_active;
    if (!state->expired) state->last_command_tick = now_ms;
    return true;
}

bool arm_control_stage_profile(arm_control_t *state, uint16_t session,
    uint8_t slot, uint16_t generation, arm_profile_t profile)
{
    /* Recovery is the verified torque-off configuration; only candidate slot
     * can be staged live, and never while that slot is active. */
    if (!state || !state->armed || state->expired || state->session != session || slot != 1 ||
        state->active_profile == slot || generation <= state->profile_generation[slot] ||
        !profile.effort_limit || profile.effort_limit > 1000 ||
        profile.integral_limit > profile.effort_limit || !profile.velocity_filter_q8) return false;
    state->profiles[slot] = profile;
    state->profile_generation[slot] = generation;
    return true;
}

bool arm_control_commit_profile(arm_control_t *state, uint16_t session,
    uint16_t sequence, uint8_t slot, uint16_t generation, uint32_t now_ms)
{
    if (!state || !state->armed || state->session != session || slot > 1 || !generation ||
        state->profile_generation[slot] != generation || !sequence ||
        !state->holding || state->target_active ||
        !arm_motion_idle(&state->motion) || now_ms - state->last_tick > 2u)
        return false;
    if (sequence == state->accepted_sequence && state->active_profile == slot) return true;
    if (state->accepted_sequence == 65535u || sequence != state->accepted_sequence + 1u) return false;
    if (state->active_profile == slot) {
        state->accepted_sequence = sequence;
        return true;
    }
    arm_profile_t profile = state->profiles[slot];
    if (state->gravity_received) {
        int32_t target_magnitude = effort_magnitude(state->gravity_target);
        int64_t active_magnitude =
            (int64_t)effort_magnitude(state->gravity_effort_q16);
        if (target_magnitude > profile.effort_limit ||
            active_magnitude > (int64_t)profile.effort_limit * 65536)
            return false;
    }
    if (state->last_requested_effort > profile.effort_limit ||
        state->last_requested_effort < -(int32_t)profile.effort_limit) return false;
    int64_t integral = state->integral_effort_q16_ms;
    int64_t bound = (int64_t)profile.integral_limit * 65536000;
    if (!profile.ki_q8) integral = 0;
    if (integral > bound) integral = bound;
    if (integral < -bound) integral = -bound;
    int64_t nominal = (int64_t)profile.kp_q8 *
        (state->last_reference_position_q8 - state->measured_position_q8) / 65536 -
        (int64_t)profile.kd_q8 * state->filtered_velocity_q8_s / 65536 +
        (int32_t)(integral / 65536) / 1000 + state->last_feedforward;
    int64_t bias = state->last_requested_effort - nominal;
    /* Reject unbounded cancellation rather than hiding a wildly wrong profile. */
    if (bias < -2000 || bias > 2000) return false;
    state->config.kp_q8 = profile.kp_q8;
    state->config.kd_q8 = profile.kd_q8;
    state->config.ki_q8 = profile.ki_q8;
    state->config.integral_limit = profile.integral_limit;
    state->config.effort_limit = profile.effort_limit;
    state->config.velocity_filter_q8 = profile.velocity_filter_q8;
    state->integral_effort_q16_ms = integral;
    state->integral_pending = false;
    state->transition_bias = (int32_t)bias;
    state->active_profile = slot;
    state->accepted_sequence = sequence;
    if (!state->expired) state->last_command_tick = now_ms;
    return true;
}

bool arm_control_gravity(arm_control_t *state, uint16_t session,
    uint16_t sequence, int16_t gravity,
    uint16_t slew_effort_s, uint16_t ttl_ms, uint32_t now_ms)
{
    if (!state || !state->armed || state->expired || session != state->session ||
        now_ms - state->last_tick > 2u ||
        !sequence || sequence != (uint16_t)(state->gravity_sequence + 1u) ||
        !slew_effort_s || slew_effort_s > 10000u || ttl_ms < 20u || ttl_ms > 500u ||
        effort_magnitude(gravity) > state->config.effort_limit) return false;
    state->gravity_received = true;
    state->gravity_stale = false;
    state->gravity_sequence = sequence;
    state->gravity_target = gravity;
    state->gravity_slew = slew_effort_s;
    state->gravity_ttl_ms = ttl_ms;
    state->gravity_tick = now_ms;
    return true;
}

static int32_t slew_effort(int32_t current, int16_t target,
                            uint16_t rate, uint32_t dt)
{
    int32_t goal = (int32_t)target * 65536;
    /* Accepted steps are 1–2 ms and rate <=10000: the Q16 product fits u32. */
    int32_t change = (int32_t)((uint32_t)rate * 65536u * dt / 1000u);
    if (current < goal) return goal - current < change ? goal : current + change;
    return current - goal < change ? goal : current - change;
}

static int16_t step_gravity(arm_control_t *state, uint32_t now_ms, uint32_t dt)
{
    if (state->expired || now_ms - state->gravity_tick > state->gravity_ttl_ms)
        state->gravity_stale = true;
    if (!state->gravity_stale)
        state->gravity_effort_q16 = slew_effort(state->gravity_effort_q16,
            state->gravity_target, state->gravity_slew, dt);
    return (int16_t)(state->gravity_effort_q16 / 65536);
}

static int16_t velocity_feedforward(const arm_control_t *state, int32_t velocity_q8_s)
{
    uint16_t limit = state->velocity_ff.effort_limit;
    if (limit == 0u) return 0;
    if (limit > state->config.effort_limit) limit = state->config.effort_limit;
    uint16_t gain = velocity_q8_s >= 0 ? state->velocity_ff.positive_gain_q8 :
        state->velocity_ff.negative_gain_q8;
    /* Q8 gain times Q8 reference velocity yields Q16 effort. Keep the signed
     * division: both directions truncate toward zero. Maximum product fits
     * int64_t. Stop/expiry follow the bounded braking reference to zero. */
    return clamp_effort((int64_t)gain * velocity_q8_s / 65536, limit);
}

/* Measurement history is updated before command expiry and reference motion. */
static void update_velocity(arm_control_t *state, int32_t measured, uint32_t dt)
{
    /* Eight acquisition intervals suppress single-count derivative spikes.
     * Timestamps, not a fixed nominal divisor, handle accepted 2 ms gaps.
     * Arm starts with a stationary prehistory, just as its reference does. */
    unsigned slot = state->velocity_cursor;
    state->velocity_window_ms = (uint16_t)(state->velocity_window_ms -
        state->velocity_intervals_ms[slot] + dt);
    /* Divide before scaling: the eight-sample window is 8–16 ms and
     * positions are bounded to ±32767 counts. Both signed products fit i32;
     * the quotient/remainder form retains truncation toward zero exactly. */
    int32_t delta = measured - state->velocity_positions_q8[slot];
    int32_t window = state->velocity_window_ms;
    int32_t raw_velocity = (delta / window) * 1000 +
        (delta % window) * 1000 / window;
    state->velocity_positions_q8[slot] = measured;
    state->velocity_intervals_ms[slot] = (uint8_t)dt;
    state->velocity_cursor = (uint8_t)((slot + 1u) % ARM_VELOCITY_WINDOW);
    state->measured_position_q8 = measured;
    /* Repeat the blend at most twice to preserve its per-ms time scale. */
    for (unsigned i = 0; i < dt; ++i) {
        int64_t difference = (int64_t)raw_velocity - state->filtered_velocity_q8_s;
        int64_t blend = (int64_t)state->config.velocity_filter_q8 * difference;
        state->filtered_velocity_q8_s = clamp_i32(
            (int64_t)state->filtered_velocity_q8_s +
            (blend + (blend > 0 ? 128 : blend < 0 ? -128 : 0)) / 256);
    }
    int32_t low = measured, high = measured;
    for (unsigned i = 0; i < ARM_VELOCITY_WINDOW; ++i) {
        if (state->velocity_positions_q8[i] < low) low = state->velocity_positions_q8[i];
        if (state->velocity_positions_q8[i] > high) high = state->velocity_positions_q8[i];
    }
    if (high - low <= 256 && state->filtered_velocity_q8_s >= -25 * 256 &&
        state->filtered_velocity_q8_s <= 25 * 256) {
        if (state->stationary_ms < 50u) state->stationary_ms += (uint16_t)dt;
    } else state->stationary_ms = 0;
}

/* Stop/expiry keep the load-support bias while bringing reference velocity
 * to zero. Disarm, in contrast, clears the powered session and its bias. */
static bool advance_reference(arm_control_t *state, uint32_t now_ms,
                              uint32_t dt, arm_result_t *result)
{
    if (!state->expired &&
        now_ms - state->last_command_tick > state->config.timeout_ms) {
        state->expired = true;
        if (!arm_motion_stop(&state->motion, state->config.ramp_time_ms,
            state->config.position_min_q8, state->config.position_max_q8)) {
            arm_control_disarm(state);
            return false;
        }
    }
    arm_motion_step(&state->motion, dt);
    state->target_active = !arm_motion_idle(&state->motion);
    state->holding = !state->target_active;
    result->reference_position_q8 = arm_motion_position(&state->motion);
    result->reference_velocity_q8_s = arm_motion_velocity(&state->motion);
    if (state->gravity_received)
        result->gravity_feedforward = step_gravity(state, now_ms, dt);
    result->velocity_feedforward = velocity_feedforward(
        state, result->reference_velocity_q8_s);
    result->feedforward = result->gravity_feedforward + result->velocity_feedforward;
    return true;
}

/* Gain Q8 times position/velocity Q8 produces effort Q16. The integral also
 * accumulates milliseconds, hence its 65536 * 1000 divisor. Applied-output
 * feedback later rolls back only outward integration at the final PWM cap. */
static void step_feedback(arm_control_t *state, int32_t measured,
                          uint32_t dt, bool current_limit_active,
                          arm_result_t *result)
{
    int64_t position_error = (int64_t)result->reference_position_q8 - measured;
    int64_t velocity_error = (int64_t)result->reference_velocity_q8_s -
        state->filtered_velocity_q8_s;
    int64_t p = (int64_t)state->config.kp_q8 * position_error / 65536;
    int64_t d = (int64_t)state->config.kd_q8 * velocity_error / 65536;
    state->integral_before_step = state->integral_effort_q16_ms;
    state->integral_pending = true;
    /* One encoder count is unresolved at rest. Do not slowly pump a learned
     * load bias through stiction after arrival. P/D and FF remain active;
     * larger error, a moving reference or measured motion resumes learning. */
    bool quiet_hold = state->holding && result->reference_velocity_q8_s == 0 &&
        state->stationary_ms >= 50u &&
        position_error >= -256 && position_error <= 256;
    if (state->config.ki_q8 == 0u) state->integral_effort_q16_ms = 0;
    else if (!current_limit_active && !quiet_hold) {
        int64_t increment = (int64_t)state->config.ki_q8 * position_error * dt;
        int64_t bound = (int64_t)state->config.integral_limit * 65536000;
        int64_t candidate = state->integral_effort_q16_ms + increment;
        if (candidate > bound) candidate = bound;
        if (candidate < -bound) candidate = -bound;
        state->integral_effort_q16_ms = candidate;
    }
    /* Sequential truncation by positive integer factors is exact; after the
     * Q16 shift the clamped integral fits i32, avoiding a software wide divide. */
    int32_t i = (int32_t)(state->integral_effort_q16_ms / 65536) / 1000;
    int64_t raw = p + d + i + result->feedforward + state->transition_bias;
    result->transition_bias = (int16_t)state->transition_bias;
    result->advanced = true;
    result->session = state->session;
    result->gravity_sequence = state->gravity_sequence;
    /* Hold one sample at the matched effort, then remove the handover offset.
     * Feedback still responds normally to subsequent measured disturbances. */
    if (state->transition_bias > 0)
        state->transition_bias -= state->transition_bias > (int32_t)dt ? (int32_t)dt : state->transition_bias;
    else if (state->transition_bias < 0)
        state->transition_bias += -state->transition_bias > (int32_t)dt ? (int32_t)dt : -state->transition_bias;
    result->p_term = clamp_effort(p, 32767);
    result->d_term = clamp_effort(d, 32767);
    result->i_term = (int16_t)i;
    result->requested_effort = clamp_effort(raw, state->config.effort_limit);
    state->last_requested_effort = result->requested_effort;
    state->last_raw_effort = clamp_i32(raw);
    state->last_feedforward = result->feedforward;
    result->saturated = raw != result->requested_effort;
    state->last_reference_position_q8 = result->reference_position_q8;
    state->last_reference_velocity_q8_s = result->reference_velocity_q8_s;
    result->active = true;
    result->holding = state->holding;
    result->accepted_sequence = state->accepted_sequence;
}

arm_result_t arm_control_step(arm_control_t *state, int32_t position_counts,
                              uint32_t now_ms, bool fresh,
                              bool current_limit_active)
{
    arm_result_t result = {0};
    if (state == 0 || !state->armed || !state->initialized ||
        position_counts < -32767 || position_counts > 32767) return result;
    uint32_t dt = now_ms - state->last_tick;
    /* A newly published sensor pair can share the millisecond counter with
     * the arm command or the previous pair. Keep the last bounded reference
     * without inventing an elapsed control interval. */
    if (dt == 0u) {
        result.fresh = fresh;
        if (!fresh) return result;
        result.reference_position_q8 = state->last_reference_position_q8;
        result.reference_velocity_q8_s = state->last_reference_velocity_q8_s;
        result.measured_velocity_q8_s = state->filtered_velocity_q8_s;
        result.requested_effort = state->last_requested_effort;
        result.feedforward = state->last_feedforward;
        result.active = true;
        result.holding = state->holding;
        result.accepted_sequence = state->accepted_sequence;
        return result;
    }
    if (dt > 1u) {
        uint32_t room = UINT16_MAX - state->overrun_count;
        state->overrun_count += (uint16_t)(dt - 1u > room ? room : dt - 1u);
    }
    result.fresh = fresh && dt > 0u && dt <= 2u;
    state->last_tick = now_ms;
    if (!result.fresh) {
        state->integral_effort_q16_ms = 0;
        return result;
    }
    int32_t measured = position_counts * 256;
    update_velocity(state, measured, dt);
    result.measured_velocity_q8_s = state->filtered_velocity_q8_s;
    if (!advance_reference(state, now_ms, dt, &result)) return (arm_result_t){0};
    step_feedback(state, measured, dt, current_limit_active, &result);
    return result;
}

void arm_control_applied(arm_control_t *state, int16_t applied,
                         bool drive_enabled)
{
    if (state == 0) return;
    if (!state->armed || !drive_enabled) {
        state->integral_effort_q16_ms = 0;
    } else if (state->integral_pending) {
        /* Conditional integration against the FINAL permitted output. Undo
         * only this sample's outward integration, never the learned bias.
         * Opposing error is allowed to unwind at either limiting boundary. */
        int64_t increment = state->integral_effort_q16_ms - state->integral_before_step;
        if ((state->last_raw_effort > applied && increment > 0) ||
            (state->last_raw_effort < applied && increment < 0))
            state->integral_effort_q16_ms = state->integral_before_step;
    }
    state->integral_pending = false;
}

int16_t arm_control_flip_effort_polarity(int16_t effort)
{
    return (int16_t)-(int32_t)effort;
}
