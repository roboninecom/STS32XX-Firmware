#ifndef CONTROLLER_H
#define CONTROLLER_H

#include <stdbool.h>
#include <stdint.h>

typedef struct {
    bool torque_enabled;
    bool integrator_allowed;
    uint8_t kp, kd, ki, bias;
    uint8_t integral_limit;
    uint8_t positive_deadband, negative_deadband;
    uint8_t derivative_deadband;
    uint8_t derivative_period;
    uint16_t output_limit;
} position_controller_config_t;

typedef struct {
    bool torque_enabled;
    uint8_t kp, ki, bias;
    uint16_t output_limit;
} velocity_controller_config_t;

typedef struct {
    position_controller_config_t position;
    velocity_controller_config_t velocity;
} controller_settings_t;

typedef struct {
    int32_t integrator;
    int32_t previous_sampled_error;
    int32_t sampled_delta;
    int32_t output_residual;
    int32_t i_clamp_residual;
    uint16_t derivative_counter;
} position_controller_t;

typedef struct {
    int32_t integrator;
    int32_t output_residual;
} velocity_controller_t;

void position_controller_reset(position_controller_t *state);
void velocity_controller_reset(velocity_controller_t *state);
int16_t position_controller_step(position_controller_t *state,
                                 const position_controller_config_t *config,
                                 int32_t measured_position,
                                 int32_t target_position,
                                 bool current_limit_active);
int16_t velocity_controller_step(velocity_controller_t *state,
                                 const velocity_controller_config_t *config,
                                 int32_t measured_speed,
                                 int32_t target_speed);

#endif
