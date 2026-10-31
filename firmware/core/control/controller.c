#include "controller.h"

#include <limits.h>

static int32_t saturate_i32(int64_t value)
{
    if (value > INT32_MAX) return INT32_MAX;
    if (value < INT32_MIN) return INT32_MIN;
    return (int32_t)value;
}

static int16_t limit_output(int64_t output, uint16_t configured_limit,
                            int32_t *residual)
{
    int32_t maximum = configured_limit > 1000u ? 1000 : configured_limit;
    int32_t bounded = output > maximum ? maximum :
        output < -maximum ? -maximum : (int32_t)output;
    *residual = saturate_i32(output - bounded);
    return (int16_t)bounded;
}

void position_controller_reset(position_controller_t *state)
{
    *state = (position_controller_t){0};
}

void velocity_controller_reset(velocity_controller_t *state)
{
    *state = (velocity_controller_t){0};
}

int16_t position_controller_step(position_controller_t *state,
                                 const position_controller_config_t *config,
                                 int32_t measured_position,
                                 int32_t target_position,
                                 bool current_limit_active)
{
    if (state == 0 || config == 0) return 0;
    if (config->torque_enabled != 1u) {
        position_controller_reset(state);
        return 0;
    }
    int32_t error = saturate_i32((int64_t)measured_position - target_position);
    if (error < -(int32_t)config->negative_deadband) error += config->negative_deadband;
    else if (error > config->positive_deadband) error -= config->positive_deadband;
    else error = 0;

    uint16_t period = config->derivative_period == 0u ? 1u : config->derivative_period;
    if (++state->derivative_counter >= period) {
        state->derivative_counter = 0;
        int32_t delta = saturate_i32((int64_t)error - state->previous_sampled_error);
        state->previous_sampled_error = error;
        int64_t magnitude = delta < 0 ? -(int64_t)delta : delta;
        state->sampled_delta = magnitude < config->derivative_deadband ? 0 : delta;
    }

    uint8_t ki = config->ki;
    if (ki == 0u) state->integrator = 0;
    else if (!current_limit_active &&
             config->integrator_allowed) {
        state->integrator = saturate_i32((int64_t)state->integrator + error -
            state->output_residual - state->i_clamp_residual);
    }
    int64_t raw_i = (int64_t)ki * state->integrator / 500;
    int64_t i_term = raw_i;
    int32_t i_limit = (int32_t)config->integral_limit * 4;
    if (i_limit != 0) {
        if (i_term > i_limit) i_term = i_limit;
        if (i_term < -i_limit) i_term = -i_limit;
    }
    state->i_clamp_residual = saturate_i32(raw_i - i_term);
    int64_t output = (int64_t)config->kp * error / 4 +
        (int64_t)config->kd * state->sampled_delta / 8 + i_term;
    if (output > 0) output += config->bias;
    else if (output < 0) output -= config->bias;
    return limit_output(output, config->output_limit,
                        &state->output_residual);
}

int16_t velocity_controller_step(velocity_controller_t *state,
                                 const velocity_controller_config_t *config,
                                 int32_t measured_speed,
                                 int32_t target_speed)
{
    if (state == 0 || config == 0) return 0;
    if (config->torque_enabled != 1u) {
        velocity_controller_reset(state);
        return 0;
    }
    int32_t error = saturate_i32((int64_t)measured_speed - target_speed);
    uint8_t ki = config->ki;
    if (ki == 0u) state->integrator = 0;
    else state->integrator = saturate_i32((int64_t)state->integrator + error -
                                          state->output_residual);
    int64_t output = (int64_t)config->kp * error / 10 +
        (int64_t)ki * state->integrator / 1000;
    if (output > 0) output += config->bias;
    else if (output < 0) output -= config->bias;
    return limit_output(output, config->output_limit,
                        &state->output_residual);
}
