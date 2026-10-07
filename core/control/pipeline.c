#include "control_pipeline.h"

void control_pipeline_reanchor(control_pipeline_t *state, int32_t position)
{
    *state = (control_pipeline_t){0};
    trajectory_init(&state->trajectory, position);
    position_controller_reset(&state->position);
    velocity_controller_reset(&state->velocity);
    protection_init(&state->protection);
    bridge_policy_init(&state->bridge);
    state->relative_origin = position;
}

void control_pipeline_reset_controllers(control_pipeline_t *state)
{
    position_controller_reset(&state->position);
    velocity_controller_reset(&state->velocity);
}

bool control_pipeline_accept(control_pipeline_t *state,
                             const motion_request_t *new_request,
                             const motion_limits_t *limits,
                             bool position_goal_changed)
{
    if (state == 0 || new_request == 0 || limits == 0) return false;
    motion_request_t request = *new_request;
    if (!position_goal_changed && state->request_valid)
        request.position_goal = state->request.position_goal;
    if (!trajectory_set_request(&state->trajectory, &request)) return false;
    state->limits = *limits;
    state->request = request;
    state->request_valid = true;
    if (position_goal_changed && (request.mode == MOTION_MODE_POSITION ||
                                  request.mode == MOTION_MODE_RELATIVE))
        state->relative_origin = request.position_goal;
    return true;
}

/* Keep the legacy controller frame separate from arm control and dispatch. */
__attribute__((noinline)) control_result_t control_pipeline_step(control_pipeline_t *state,
                                       const controller_settings_t *controllers,
                                       const protection_config_t *protection,
                                       uint8_t selected_mode,
                                       bool complementary,
                                       control_sample_t sample,
                                       bool platform_permit)
{
    control_result_t result = {0};
    if (state == 0 || protection == 0 || controllers == 0) return result;
    bool enabled = protection->torque == 1u;
    bool can_step = sample.fresh && state->request_valid && enabled &&
                    selected_mode == (uint8_t)state->request.mode;
    if (!enabled && sample.fresh) {
        trajectory_init(&state->trajectory, sample.position);
        control_pipeline_reset_controllers(state);
        state->request_valid = false;
        state->relative_origin = sample.position;
        result.target_position = sample.position;
    }
    if (can_step) {
        trajectory_step(&state->trajectory);
        switch (state->request.mode) {
        case MOTION_MODE_POSITION:
        case MOTION_MODE_RELATIVE:
            result.target_position = trajectory_position(&state->trajectory);
            result.target_speed = trajectory_velocity(&state->trajectory) /
                ((int32_t)(state->limits.rate == 0u ? 1u : state->limits.rate) * 10);
            result.requested_output = position_controller_step(
                &state->position, &controllers->position, sample.position,
                result.target_position, sample.current_limit_active);
            break;
        case MOTION_MODE_VELOCITY: {
            uint8_t rate = state->limits.rate == 0u ? 1u : state->limits.rate;
            result.target_speed = trajectory_velocity(&state->trajectory) /
                                  ((int32_t)rate * 10);
            result.requested_output = velocity_controller_step(
                &state->velocity, &controllers->velocity, sample.speed,
                result.target_speed);
            break;
        }
        case MOTION_MODE_PWM:
            result.requested_output = state->request.pwm_goal;
            break;
        }
    }
    control_pipeline_output(state, protection, &sample, &result,
                            platform_permit && can_step, platform_permit, complementary);
    if ((protection->shutdown_mask & result.errors & 0x05u) != 0u) {
        trajectory_alarm_reanchor(&state->trajectory, sample.position);
        if (state->request_valid &&
            (state->request.mode == MOTION_MODE_POSITION ||
             state->request.mode == MOTION_MODE_RELATIVE))
            state->request.position_goal = sample.position;
        result.target_position = sample.position;
        result.target_speed = 0;
    }
    return result;
}

/* Keeping this boundary out of the larger controller frame also bounds stack
 * overlap and avoids duplicating protection setup in the two control modes. */
__attribute__((noinline)) void control_pipeline_output(control_pipeline_t *state,
                             const protection_config_t *protection,
                             const control_sample_t *sample, control_result_t *result,
                             bool drive_permitted, bool brake_permitted,
                             bool complementary)
{
    protection_input_t input = {
        .position = sample->position,
        .current = sample->current,
        .requested_output = result->requested_output,
        .voltage = sample->voltage,
        .temperature = sample->temperature,
        .fresh_sensors = sample->fresh,
    };
    protection_result_t protected = protection_step(&state->protection,
                                                    protection, input);
    result->protected_output = protected.output;
    result->errors = protected.errors;
    result->torque = protected.torque;
    result->bridge = bridge_policy_apply(&state->bridge,
        result->protected_output, result->torque,
        sample->fresh && (drive_permitted || (brake_permitted && result->torque == 2u)),
        complementary);
}
