#ifndef TRAJECTORY_H
#define TRAJECTORY_H

#include "motion_request.h"

#include <stdbool.h>
#include <stdint.h>

enum { TRAJECTORY_POSITION_SCALE = 10000 };

typedef struct {
    int64_t position_q;
    int64_t goal_q;
    int32_t velocity_q;
    int32_t requested_velocity_q;
    int32_t acceleration_q;
    int32_t minimum_velocity_q;
    uint8_t mode;
    bool active;
    bool phase_active;
} trajectory_t;

void trajectory_init(trajectory_t *state, int32_t measured_position);
/* Alarm shutdown pins current/target position without discarding velocity and
 * request parameters; the control pipeline reapplies the retained goal. */
void trajectory_alarm_reanchor(trajectory_t *state, int32_t measured_position);
bool trajectory_set_request(trajectory_t *state,
                            const motion_request_t *request);
/* One accepted sensor pair advances the profile by exactly one step. */
void trajectory_step(trajectory_t *state);
int32_t trajectory_position(const trajectory_t *state);
int32_t trajectory_velocity(const trajectory_t *state);

#endif
