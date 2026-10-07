#include "trajectory.h"

static int32_t approach(int32_t current, int32_t target, int32_t step)
{
    if (step <= 0) return target;
    if (current < target) {
        int64_t next = (int64_t)current + step;
        return next >= target ? target : (int32_t)next;
    }
    if (current > target) {
        int64_t next = (int64_t)current - step;
        return next <= target ? target : (int32_t)next;
    }
    return current;
}

static uint64_t magnitude_i64(int64_t value)
{
    return value < 0 ? (uint64_t)(-(value + 1)) + 1u : (uint64_t)value;
}

void trajectory_init(trajectory_t *state, int32_t measured_position)
{
    *state = (trajectory_t){0};
    state->position_q = (int64_t)measured_position * TRAJECTORY_POSITION_SCALE;
    state->goal_q = state->position_q;
}

void trajectory_alarm_reanchor(trajectory_t *state, int32_t measured_position)
{
    int64_t position_q = (int64_t)measured_position * TRAJECTORY_POSITION_SCALE;
    state->position_q = position_q;
    state->goal_q = position_q;
    /* A position goal must hold at the measured point. A velocity request
     * continues ramping while its output is masked, as on the reference. */
    if (state->mode != MOTION_MODE_VELOCITY) state->velocity_q = 0;
    state->active = false;
    state->phase_active = false;
}

bool trajectory_set_request(trajectory_t *state,
                            const motion_request_t *request)
{
    if (state == 0 || request == 0 || request->mode > MOTION_MODE_RELATIVE ||
        request->acceleration_step < 0 || request->minimum_velocity_x10 < 0 ||
        request->velocity_limit_x10 < 0) return false;
    if ((request->mode == MOTION_MODE_POSITION ||
         request->mode == MOTION_MODE_RELATIVE) &&
        request->velocity_limit_x10 < request->minimum_velocity_x10 &&
        request->velocity_limit_x10 != 0) return false;
    /* Repeated writes of the same effective request do not restart braking.
     * A changed goal or profile limit does, as in the reconstructed planner. */
    bool phase_changed = state->mode != (uint8_t)request->mode ||
        state->goal_q != (int64_t)request->position_goal * TRAJECTORY_POSITION_SCALE ||
        state->acceleration_q != request->acceleration_step ||
        state->requested_velocity_q != (request->mode == MOTION_MODE_VELOCITY
            ? request->velocity_goal_x10 : request->velocity_limit_x10);
    state->mode = (uint8_t)request->mode;
    state->acceleration_q = request->acceleration_step;
    state->minimum_velocity_q = request->minimum_velocity_x10;
    state->goal_q = (int64_t)request->position_goal * TRAJECTORY_POSITION_SCALE;
    state->requested_velocity_q = request->mode == MOTION_MODE_VELOCITY
        ? request->velocity_goal_x10 : request->velocity_limit_x10;
    if (phase_changed) state->phase_active = false;
    if (request->mode == MOTION_MODE_PWM) {
        state->velocity_q = 0;
        state->active = false;
    } else {
        state->active = state->mode == MOTION_MODE_VELOCITY
            ? state->velocity_q != state->requested_velocity_q
            : state->position_q != state->goal_q || state->velocity_q != 0;
    }
    return true;
}

void trajectory_step(trajectory_t *state)
{
    if (state == 0) return;
    if (state->mode == MOTION_MODE_PWM) return;
    if (state->mode == MOTION_MODE_VELOCITY) {
        state->velocity_q = approach(state->velocity_q,
                                     state->requested_velocity_q,
                                     state->acceleration_q);
        state->active = state->velocity_q != state->requested_velocity_q;
        return;
    }

    int64_t remaining = state->goal_q - state->position_q;
    if (remaining == 0 && state->velocity_q == 0) {
        state->active = false;
        return;
    }
    int32_t direction = remaining > 0 ? 1 : remaining < 0 ? -1 : 0;
    int32_t desired = direction * state->requested_velocity_q;
    if (state->acceleration_q == 0) {
        state->velocity_q = desired;
    } else if (direction == 0 || desired == 0) {
        state->velocity_q = approach(state->velocity_q, 0,
                                     state->acceleration_q);
    } else {
        uint64_t speed = magnitude_i64(state->velocity_q);
        uint64_t acceleration = (uint32_t)state->acceleration_q;
        uint64_t steps = speed / acceleration;
        uint64_t braking = steps == 0u ? 0u :
            steps * (2u * speed - (steps + 1u) * acceleration) / 2u;
        /* Before a new profile phase is selected, preserve momentum while
         * reversing or braking; crossing an intermediate goal is not a stop. */
        if (!state->phase_active) {
            if ((state->velocity_q > 0 && direction < 0) ||
                (state->velocity_q < 0 && direction > 0)) {
                state->velocity_q = approach(state->velocity_q, 0,
                                             state->acceleration_q);
                if (magnitude_i64(state->velocity_q) <=
                    (uint32_t)state->minimum_velocity_q) state->velocity_q = 0;
            } else if (magnitude_i64(remaining) >= braking) {
                state->phase_active = true;
            } else {
                state->velocity_q = approach(state->velocity_q, 0,
                                             state->acceleration_q);
                if (magnitude_i64(state->velocity_q) <
                    (uint32_t)state->minimum_velocity_q) state->velocity_q = 0;
            }
        }
        if (state->phase_active) {
            state->velocity_q = approach(state->velocity_q,
                braking >= magnitude_i64(remaining) ? 0 : desired,
                state->acceleration_q);
            if (magnitude_i64(state->velocity_q) <
                (uint32_t)state->minimum_velocity_q) {
                state->velocity_q = direction * state->minimum_velocity_q;
            }
        }
    }
    int64_t next = state->position_q + state->velocity_q;
    if ((state->acceleration_q == 0 || state->phase_active) &&
        ((remaining > 0 && next >= state->goal_q) ||
         (remaining < 0 && next <= state->goal_q))) {
        state->position_q = state->goal_q;
        state->velocity_q = 0;
    } else {
        state->position_q = next;
    }
    state->active = state->position_q != state->goal_q || state->velocity_q != 0;
}

int32_t trajectory_position(const trajectory_t *state)
{
    return (int32_t)(state->position_q / TRAJECTORY_POSITION_SCALE);
}

int32_t trajectory_velocity(const trajectory_t *state)
{
    return state->velocity_q;
}
