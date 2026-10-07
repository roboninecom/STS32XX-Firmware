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
    state->start_position_q8 = state->measured_position_q8;
    state->last_reference_position_q8 = state->start_position_q8;
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
        config.velocity_filter_q8 == 0u ||
        config.position_min_q8 < -32767 * 256 ||
        config.position_max_q8 > 32767 * 256 ||
        config.position_min_q8 >= config.position_max_q8) return false;
    state->config = config;
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

bool arm_control_arm(arm_control_t *state, uint16_t session,
                     int32_t position_counts, uint32_t now_ms)
{
    if (state == 0 || !state->initialized || state->config.effort_limit == 0u ||
        session == 0u || state->armed ||
        position_counts < -32767 || position_counts > 32767) return false;
    if ((int64_t)position_counts * 256 < state->config.position_min_q8 ||
        (int64_t)position_counts * 256 > state->config.position_max_q8)
        return false;
    state->feedforward_enabled = state->feedforward_stale = false;
    state->feedforward_sequence = 0;
    state->gravity_effort_q16 = state->dynamic_effort_q16 = 0;
    state->gravity_target = state->dynamic_target = 0;
    state->session = session;
    state->armed = true;
    state->expired = false;
    state->holding = true;
    state->running = false;
    state->queue_head = state->queue_count = 0;
    state->segment_mode = false;
    state->target_mode = state->target_pending = state->target_active = false;
    state->target_position_remainder = state->target_velocity_remainder = 0;
    state->elapsed_ms = state->accepted_sequence = 0;
    state->measured_position_q8 = position_counts * 256;
    state->start_position_q8 = state->measured_position_q8;
    state->start_velocity_q8_s = state->start_acceleration_q8_s2 = 0;
    state->last_reference_position_q8 = state->start_position_q8;
    state->last_reference_velocity_q8_s = 0;
    state->filtered_velocity_q8_s = 0;
    for (unsigned i = 0; i < ARM_VELOCITY_WINDOW; ++i) {
        state->velocity_positions_q8[i] = state->measured_position_q8;
        state->velocity_intervals_ms[i] = 1;
    }
    state->velocity_cursor = 0;
    state->stationary_ms = 0;
    state->velocity_window_ms = ARM_VELOCITY_WINDOW;
    state->stop_braking = state->config.acceleration_limit;
    state->transition_bias = 0;
    state->last_feedforward = 0;
    state->last_requested_effort = 0;
    state->integral_pending = false;
    state->start_feedforward = 0;
    state->integral_effort_q16_ms = 0;
    state->last_tick = state->last_command_tick = now_ms;
    return true;
}

void arm_control_disarm(arm_control_t *state)
{
    if (state == 0) return;
    state->armed = state->running = state->holding = false;
    state->segment_mode = false;
    state->target_mode = state->target_pending = state->target_active = false;
    state->expired = false;
    state->queue_head = state->queue_count = 0;
    state->integral_effort_q16_ms = 0;
    state->integral_pending = false;
    state->session = 0;
    state->feedforward_enabled = false;
    state->gravity_effort_q16 = state->dynamic_effort_q16 = 0;
    state->gravity_target = state->dynamic_target = 0;
    state->feedforward_sequence = 0;
}

/* Quintic Hermite curves are quintic Bezier curves. Their position, velocity
 * and acceleration stay in the convex hulls of their respective control
 * points. Rejecting any control point outside limits is conservative and
 * avoids an unbounded per-millisecond search during command dispatch. */
static void segment_points(int64_t p0, int64_t v0, int64_t a0,
                           arm_segment_t segment, int64_t p[6])
{
    int64_t p5 = segment.position_q8;
    int64_t v1 = segment.velocity_q8_s;
    int64_t a1 = segment.acceleration_q8_s2;
    int64_t t = segment.duration_ms;
    p[0] = p0;
    p[1] = p0 + v0 * t / 5000;
    p[2] = p0 + 2 * v0 * t / 5000 + a0 * t * t / 20000000;
    p[3] = p5 - 2 * v1 * t / 5000 + a1 * t * t / 20000000;
    p[4] = p5 - v1 * t / 5000;
    p[5] = p5;
}

static bool segment_within_limits(const arm_control_t *state,
                                  arm_segment_t segment)
{
    int64_t p0, v0, a0;
    if (state->queue_count != 0u) {
        const arm_segment_t *tail = &state->queue[
            (state->queue_head + state->queue_count - 1u) % ARM_QUEUE_CAPACITY];
        p0 = tail->position_q8;
        v0 = tail->velocity_q8_s;
        a0 = tail->acceleration_q8_s2;
    } else if (state->running) {
        p0 = state->current.position_q8;
        v0 = state->current.velocity_q8_s;
        a0 = state->current.acceleration_q8_s2;
    } else {
        p0 = state->start_position_q8;
        v0 = state->start_velocity_q8_s;
        a0 = state->start_acceleration_q8_s2;
    }
    int64_t t = segment.duration_ms;
    int64_t p[6];
    segment_points(p0, v0, a0, segment, p);
    for (unsigned i = 0; i < 6u; ++i) {
        if (p[i] < state->config.position_min_q8 ||
            p[i] > state->config.position_max_q8) return false;
    }
    for (unsigned i = 0; i < 5u; ++i) {
        int64_t v = 5000 * (p[i + 1u] - p[i]) / t;
        if (v < -(int64_t)state->config.velocity_limit * 256 ||
            v > (int64_t)state->config.velocity_limit * 256) return false;
    }
    for (unsigned i = 0; i < 4u; ++i) {
        int64_t a = 20000000 * (p[i + 2u] - 2 * p[i + 1u] + p[i]) / (t * t);
        if (a < -(int64_t)state->config.acceleration_limit * 256 ||
            a > (int64_t)state->config.acceleration_limit * 256) return false;
    }
    return true;
}

bool arm_control_submit(arm_control_t *state, uint16_t session,
                        arm_segment_t segment, uint32_t now_ms)
{
    if (state == 0 || !state->armed || state->expired ||
        state->session != session ||
        segment.sequence == 0u ||
        segment.sequence != (uint16_t)(state->accepted_sequence + 1u) ||
        segment.duration_ms < 10u || segment.duration_ms > 1000u ||
        state->queue_count == ARM_QUEUE_CAPACITY ||
        state->feedforward_enabled || state->target_mode || state->target_pending || state->target_active ||
        segment.position_q8 < state->config.position_min_q8 ||
        segment.position_q8 > state->config.position_max_q8 ||
        segment.velocity_q8_s < -(int32_t)state->config.velocity_limit * 256 ||
        segment.velocity_q8_s > (int32_t)state->config.velocity_limit * 256 ||
        segment.acceleration_q8_s2 < -(int32_t)state->config.acceleration_limit * 256 ||
        segment.acceleration_q8_s2 > (int32_t)state->config.acceleration_limit * 256 ||
        segment.feedforward < -(int32_t)state->config.effort_limit ||
        segment.feedforward > (int32_t)state->config.effort_limit ||
        !segment_within_limits(state, segment)) return false;
    uint8_t index = (uint8_t)((state->queue_head + state->queue_count) % ARM_QUEUE_CAPACITY);
    state->queue[index] = segment;
++state->queue_count;
    state->segment_mode = true;
    state->accepted_sequence = segment.sequence;
    state->last_command_tick = now_ms;
    return true;
}

bool arm_control_target(arm_control_t *state, uint16_t session,
                        arm_target_t target, uint32_t now_ms)
{
    if (state == 0 || !state->armed || state->expired ||
        state->session != session || state->running ||
        state->queue_count != 0u || state->target_pending ||
        state->segment_mode ||
        target.sequence == 0u ||
        target.sequence != (uint16_t)(state->accepted_sequence + 1u) ||
        target.position_q8 < state->config.position_min_q8 ||
        target.position_q8 > state->config.position_max_q8 ||
        target.speed_limit == 0u ||
        target.speed_limit > state->config.velocity_limit ||
        target.acceleration == 0u ||
        target.acceleration > state->config.acceleration_limit ||
        target.braking == 0u ||
        target.braking > state->config.acceleration_limit ||
        (state->feedforward_enabled && target.feedforward != 0) ||
        target.feedforward < -(int32_t)state->config.effort_limit ||
        target.feedforward > (int32_t)state->config.effort_limit) return false;
    int64_t velocity = state->start_velocity_q8_s;
    int64_t remaining = velocity >= 0 ?
        (int64_t)state->config.position_max_q8 - state->start_position_q8 :
        (int64_t)state->start_position_q8 - state->config.position_min_q8;
    int64_t speed = velocity < 0 ? -velocity : velocity;
    int64_t margin = speed == 0 ? 0 : speed * 2 / 1000 + 256;
    bool same_boundary_plan = state->target_mode &&
        target.position_q8 == state->target.position_q8 &&
        target.braking >= state->target.braking;
    if (!same_boundary_plan && (remaining < margin ||
        speed * speed > 2 * (int64_t)target.braking * 256 * (remaining - margin)))
        return false;
    state->pending_target = target;
    state->target_mode = true;
    state->target_pending = true;
    state->accepted_sequence = target.sequence;
    state->last_command_tick = now_ms;
    return true;
}

bool arm_control_start(arm_control_t *state, uint16_t session, uint32_t now_ms)
{
    if (state == 0 || !state->armed || state->expired ||
        state->session != session || state->running) return false;
    if (state->target_pending) {
        state->target = state->pending_target;
        state->target_pending = false;
        state->target_active = true;
        state->holding = false;
        state->start_feedforward = state->target.feedforward;
        state->stop_braking = state->target.braking;
        state->last_command_tick = now_ms;
        return true;
    }
    if (state->target_active || state->queue_count == 0u) return false;
    state->running = true;
    state->holding = false;
    state->last_command_tick = now_ms;
    return true;
}

bool arm_control_stop(arm_control_t *state, uint16_t session, uint32_t now_ms)
{
    if (state == 0 || !state->armed || state->session != session ||
        now_ms - state->last_tick > 2u) return false;
    state->dynamic_target = 0;
    state->queue_count = state->queue_head = 0;
    state->running = state->target_pending = state->target_active = false;
    state->holding = true;
    state->start_position_q8 = state->last_reference_position_q8;
    state->start_velocity_q8_s = state->last_reference_velocity_q8_s;
    state->start_acceleration_q8_s2 = 0;
    state->start_feedforward = state->last_feedforward;
    state->target_position_remainder = state->target_velocity_remainder = 0;
    if (!state->expired) state->last_command_tick = now_ms;
    return true;
}

bool arm_control_takeover(arm_control_t *state, uint16_t expected_session,
                          uint16_t expected_sequence, uint16_t new_session,
                          uint32_t now_ms)
{
    if (state == 0 || !state->armed || !state->holding ||
        state->running || state->target_active || state->target_pending ||
        state->queue_count != 0 || state->session != expected_session ||
        state->accepted_sequence != expected_sequence ||
        new_session <= expected_session || state->stationary_ms < 50u ||
        state->last_reference_velocity_q8_s != 0 ||
        now_ms - state->last_tick > 2u) return false;
    /* Monotonically increasing sessions within a powered lifetime prevent
     * old-session replay. Exhaustion requires a deliberate disarmed session. */
    state->feedforward_sequence = 0;
    state->feedforward_stale = true;
    state->dynamic_target = 0;
    state->session = new_session;
    state->accepted_sequence = 0;
    state->segment_mode = false;
    state->target_mode = false;
    state->expired = false;
    state->last_command_tick = now_ms;
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
        !state->holding || state->running || state->target_active || state->target_pending ||
        state->queue_count || state->last_reference_velocity_q8_s || now_ms - state->last_tick > 2u)
        return false;
    if (sequence == state->accepted_sequence && state->active_profile == slot) return true;
    if (state->accepted_sequence == 65535u || sequence != state->accepted_sequence + 1u) return false;
    if (state->active_profile == slot) {
        state->accepted_sequence = sequence;
        return true;
    }
    arm_profile_t profile = state->profiles[slot];
    if (state->feedforward_enabled) {
        int32_t target_magnitude = effort_magnitude(state->gravity_target) +
            effort_magnitude(state->dynamic_target);
        int64_t active_magnitude =
            (int64_t)effort_magnitude(state->gravity_effort_q16) +
            effort_magnitude(state->dynamic_effort_q16);
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
        integral / 65536000 + state->last_feedforward;
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

bool arm_control_feedforward(arm_control_t *state, uint16_t session,
    uint16_t sequence, int16_t gravity, int16_t dynamic,
    uint16_t slew_effort_s, uint16_t ttl_ms, uint32_t now_ms)
{
    if (!state || !state->armed || state->expired || session != state->session ||
        now_ms - state->last_tick > 2u || state->segment_mode ||
        !sequence || sequence != (uint16_t)(state->feedforward_sequence + 1u) ||
        !slew_effort_s || slew_effort_s > 10000u || ttl_ms < 20u || ttl_ms > 500u ||
        effort_magnitude(gravity) + effort_magnitude(dynamic) > state->config.effort_limit ||
        (!state->feedforward_enabled && state->last_feedforward != 0) ||
        (state->target_pending && state->pending_target.feedforward != 0) ||
        (state->target_active && state->target.feedforward != 0) ||
        (dynamic != 0 && !state->target_active)) return false;
    state->feedforward_enabled = true;
    state->feedforward_stale = false;
    state->feedforward_sequence = sequence;
    state->gravity_target = gravity;
    state->dynamic_target = dynamic;
    state->feedforward_slew = slew_effort_s;
    state->feedforward_ttl_ms = ttl_ms;
    state->feedforward_tick = now_ms;
    return true;
}

static int32_t slew_effort(int32_t current, int16_t target,
                            uint16_t rate, uint32_t dt)
{
    int32_t goal = (int32_t)target * 65536;
    int32_t change = (int32_t)((int64_t)rate * 65536 * dt / 1000);
    if (current < goal) return goal - current < change ? goal : current + change;
    return current - goal < change ? goal : current - change;
}

static int16_t step_feedforward(arm_control_t *state, uint32_t now_ms, uint32_t dt)
{
    if (state->expired || now_ms - state->feedforward_tick > state->feedforward_ttl_ms)
        state->feedforward_stale = true;
    if (!state->feedforward_stale)
        state->gravity_effort_q16 = slew_effort(state->gravity_effort_q16,
            state->gravity_target, state->feedforward_slew, dt);
    bool remove_dynamic = state->feedforward_stale || !state->target_active;
    if (remove_dynamic) state->dynamic_target = 0;
    /* On stop/arrival/lease expiry dynamic effort reaches zero within 100 ms,
     * even if the configured experimental slew rate was very small. */
    state->dynamic_effort_q16 = slew_effort(state->dynamic_effort_q16,
        state->dynamic_target, remove_dynamic ? 10000u : state->feedforward_slew, dt);
    return (int16_t)((state->gravity_effort_q16 + state->dynamic_effort_q16) / 65536);
}

/* Fixed 32-iteration integer square root; no data-dependent catch-up loop. */
static uint32_t sqrt_u64(uint64_t value)
{
    uint64_t root = 0, bit = (uint64_t)1 << 62;
    for (unsigned i = 0; i < 32; ++i, bit >>= 2) {
        if (value >= root + bit) {
            value -= root + bit;
            root = (root >> 1) + bit;
        } else root >>= 1;
    }
    return (uint32_t)root;
}

/* Bang-bang speed planning with a stopping-distance guard. All reference
 * integration runs on fresh 1 kHz samples; host update cadence is irrelevant
 * to the local acceleration and braking bounds. */
static void step_target(arm_control_t *state, uint32_t dt, arm_result_t *result)
{
    int64_t position = state->start_position_q8;
    int64_t velocity = state->start_velocity_q8_s;
    int64_t initial_velocity = velocity;
    int64_t distance = (int64_t)state->target.position_q8 - position;
    int64_t brake = (int64_t)state->target.braking * 256;
    int64_t accel = (int64_t)state->target.acceleration * 256;
    int64_t speed = (int64_t)state->target.speed_limit * 256;
    int direction = (distance > 0) - (distance < 0);
    int velocity_direction = (velocity > 0) - (velocity < 0);
    int64_t distance_abs = distance < 0 ? -distance : distance;
    int64_t brake_step = brake * dt / 1000;
    /* Limit next speed so its next displacement PLUS its stopping distance
     * fits. Reserve two Q8 position quanta for integration rounding. */
    int64_t room = distance_abs > 2 ? distance_abs - 2 : 0;
    int64_t allowed = sqrt_u64((uint64_t)(brake_step * brake_step + 2 * brake * room)) - brake_step;
    if (allowed > speed) allowed = speed;
    int64_t desired = direction * allowed;
    bool braking = direction == 0 ||
        (velocity_direction != 0 && velocity_direction != direction) ||
        (velocity < 0 ? -velocity : velocity) > allowed;
    if (velocity_direction != 0 && velocity_direction != direction) desired = 0;
    int64_t rate = braking ? brake : accel;
    int64_t numerator = rate * dt + state->target_velocity_remainder;
    int64_t change = numerator / 1000;
    state->target_velocity_remainder = (int32_t)(numerator%1000);
    if (velocity < desired) velocity += (desired - velocity < change) ? desired - velocity : change;
    else if (velocity > desired) velocity -= (velocity - desired < change) ? velocity - desired : change;
    int64_t movement = velocity * dt + state->target_position_remainder;
    int64_t delta = movement / 1000;
    state->target_position_remainder = (int32_t)(movement%1000);
    int64_t next = position + delta;
    if (next < state->config.position_min_q8 ||
        next > state->config.position_max_q8) {
        state->armed = state->target_active = false;
        state->expired = true;
        return;
    }
    /* Do not pin q while claiming a nonzero dq. Snap only when one legal
     * braking interval can stop the remaining speed. Replaced targets that
     * cannot be reached without overshoot continue braking and reverse. */
    bool crossing = (distance > 0 && next >= state->target.position_q8) ||
                    (distance < 0 && next <= state->target.position_q8) ||
                    distance_abs <= 2;
    if (crossing && (initial_velocity < 0 ? -initial_velocity : initial_velocity) <= change) {
        next = state->target.position_q8;
        velocity = 0;
        state->target_position_remainder = state->target_velocity_remainder = 0;
        state->target_active = false;
        state->holding = true;
    }
    state->start_position_q8 = (int32_t)next;
    state->start_velocity_q8_s = (int32_t)velocity;
    result->reference_position_q8 = (int32_t)next;
    result->reference_velocity_q8_s = (int32_t)velocity;
    result->feedforward = state->target.feedforward;
}

/* Position and its analytic derivative share the same checked Bezier points.
 * Build once per sample, then evaluate each hull with the original signed
 * division/rounding order. No persistent cache or additional state is needed. */
static void interpolate_reference(const arm_control_t *state, uint16_t elapsed,
                                  arm_result_t *result)
{
    if (elapsed == state->current.duration_ms) {
        result->reference_position_q8 = state->current.position_q8;
        result->reference_velocity_q8_s = state->current.velocity_q8_s;
        return;
    }
    int64_t position[6], velocity[5];
    segment_points(state->start_position_q8, state->start_velocity_q8_s,
                   state->start_acceleration_q8_s2, state->current, position);
    for (unsigned i = 0; i < 5u; ++i)
        velocity[i] = 5000 * (position[i + 1u] - position[i]) /
            state->current.duration_ms;
    uint32_t fraction = (uint32_t)elapsed * 65536u / state->current.duration_ms;
    for (unsigned width = 5u; width != 0u; --width)
        for (unsigned i = 0; i < width; ++i)
            position[i] += (position[i + 1u] - position[i]) * fraction / 65536;
    for (unsigned width = 4u; width != 0u; --width)
        for (unsigned i = 0; i < width; ++i)
            velocity[i] += (velocity[i + 1u] - velocity[i]) * fraction / 65536;
    result->reference_position_q8 = clamp_i32(position[0]);
    result->reference_velocity_q8_s = clamp_i32(velocity[0]);
}

static void begin_next(arm_control_t *state, int32_t position_q8,
                       int32_t velocity_q8_s)
{
    state->start_position_q8 = position_q8;
    state->start_velocity_q8_s = velocity_q8_s;
    /* Start metadata belongs to the accepted hold/previous endpoint, not
     * the stale current segment left over from a disarm or takeover. */
    state->current = state->queue[state->queue_head];
    state->queue_head = (uint8_t)((state->queue_head + 1u) % ARM_QUEUE_CAPACITY);
--state->queue_count;
    state->elapsed_ms = 0;
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
    int32_t raw_velocity = clamp_i32(
        ((int64_t)measured - state->velocity_positions_q8[slot]) * 1000 /
        state->velocity_window_ms);
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
        state->queue_count = 0;
        state->running = false;
        state->target_pending = state->target_active = false;
        state->target_mode = false;
        state->holding = true;
        state->start_position_q8 = state->last_reference_position_q8;
        state->start_velocity_q8_s = state->last_reference_velocity_q8_s;
        state->start_acceleration_q8_s2 = 0;
        state->start_feedforward = state->last_feedforward;
    }
    if (state->running && state->elapsed_ms == 0u) {
        if (state->queue_count != 0u) begin_next(state, state->start_position_q8,
                                                  state->start_velocity_q8_s);
        else {
            state->running = false;
            state->holding = true;
        }
    }
    if (state->target_active) {
        step_target(state, dt, result);
        if (!state->armed) return false;
    } else if (state->running) {
        uint16_t next = (uint16_t)(state->elapsed_ms + dt);
        if (next > state->current.duration_ms) next = state->current.duration_ms;
        interpolate_reference(state, next, result);
        int32_t delta_ff = (int32_t)state->current.feedforward - state->start_feedforward;
        result->feedforward = (int16_t)(state->start_feedforward +
            delta_ff * next / state->current.duration_ms);
        state->elapsed_ms = next;
        if (next == state->current.duration_ms) {
            state->start_position_q8 = state->current.position_q8;
            state->start_velocity_q8_s = state->current.velocity_q8_s;
            state->start_acceleration_q8_s2 = state->current.acceleration_q8_s2;
            state->start_feedforward = state->current.feedforward;
            state->elapsed_ms = 0;
            if (state->queue_count == 0u) {
                state->running = false;
                state->holding = true;
            }
        }
    } else {
        int64_t previous_velocity = state->start_velocity_q8_s;
        int64_t velocity = previous_velocity;
        int64_t change = (int64_t)state->stop_braking * 256 * dt / 1000;
        if (change < 1) change = 1;
        if (velocity > 0) velocity = velocity > change ? velocity - change : 0;
        else if (velocity < 0) velocity = velocity < -change ? velocity + change : 0;
        int64_t next_position = (int64_t)state->start_position_q8 +
            (previous_velocity + velocity) * dt / 2000;
        if (next_position < state->config.position_min_q8) {
            next_position = state->config.position_min_q8;
            velocity = 0;
        }
        if (next_position > state->config.position_max_q8) {
            next_position = state->config.position_max_q8;
            velocity = 0;
        }
        state->start_position_q8 = (int32_t)next_position;
        state->start_velocity_q8_s = (int32_t)velocity;
        result->reference_position_q8 = state->start_position_q8;
        result->reference_velocity_q8_s = state->start_velocity_q8_s;
        result->feedforward = state->last_feedforward;
    }
    if (state->feedforward_enabled)
        result->feedforward = step_feedforward(state, now_ms, dt);
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
    int64_t i = state->integral_effort_q16_ms / 65536000;
    int64_t raw = p + d + i + result->feedforward + state->transition_bias;
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
