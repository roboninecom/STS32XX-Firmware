#ifndef MOTION_REQUEST_H
#define MOTION_REQUEST_H

#include <stdbool.h>
#include <stdint.h>

typedef enum { MOTION_MODE_POSITION = 0, MOTION_MODE_VELOCITY = 1,
               MOTION_MODE_PWM = 2, MOTION_MODE_RELATIVE = 3 } motion_mode_t;

/* Fixed-point velocity is counts/step times 10. Position is encoder counts.
 * This is policy data only: it never enables the bridge. */
typedef struct {
    motion_mode_t mode;
    int32_t position_goal;
    int32_t velocity_goal_x10;
    int32_t velocity_limit_x10;
    int32_t minimum_velocity_x10;
    int32_t acceleration_step;
    int16_t pwm_goal;
    uint8_t normalized_divisor;
    uint8_t normalized_acceleration;
} motion_request_t;

typedef struct {
    uint8_t rate;
    uint8_t minimum_velocity;
    uint8_t maximum_velocity;
} motion_limits_t;

#endif
