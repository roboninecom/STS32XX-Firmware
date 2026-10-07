#ifndef CONTROL_PIPELINE_H
#define CONTROL_PIPELINE_H

#include "bridge_policy.h"
#include "controller.h"
#include "motion_request.h"
#include "protection.h"
#include "trajectory.h"

/* Portable composition of one accepted sensor pair and one control step.
 * The platform bridge driver is deliberately outside this interface. */
typedef struct {
    trajectory_t trajectory;
    position_controller_t position;
    velocity_controller_t velocity;
    protection_state_t protection;
    bridge_policy_t bridge;
    motion_request_t request;
    motion_limits_t limits;
    int32_t relative_origin;
    bool request_valid;
} control_pipeline_t;

typedef struct {
    int32_t position;
    int32_t speed;
    int16_t current;
    uint8_t voltage;
    uint8_t temperature;
    bool fresh;
    bool current_limit_active;
} control_sample_t;

typedef struct {
    int16_t requested_output;
    int16_t protected_output;
    int32_t target_position;
    int32_t target_speed;
    uint8_t errors;
    uint8_t torque;
    bridge_request_t bridge;
} control_result_t;

/* A new encoder origin or post-flash sensor restart discards the active
 * profile and its controller/protection history. Cached device limits live
 * outside this state and survive the reanchor. */
void control_pipeline_reanchor(control_pipeline_t *state, int32_t position);
void control_pipeline_reset_controllers(control_pipeline_t *state);
/* Call once per accepted motion-setting change, never once per sample: mode 3
 * relative goals are based on the previous accepted goal. */
bool control_pipeline_accept(control_pipeline_t *state,
                             const motion_request_t *request,
                             const motion_limits_t *limits,
                             bool position_goal_changed);
/* Both controllers submit native-polarity effort through this final portable
 * protection/bridge gate. Brake permission is explicit because only legacy
 * torque=2 supports that behaviour. Platform PWM mapping remains outside it. */
void control_pipeline_output(control_pipeline_t *state,
                             const protection_config_t *protection,
                             const control_sample_t *sample, control_result_t *result,
                             bool drive_permitted, bool brake_permitted,
                             bool complementary);
control_result_t control_pipeline_step(control_pipeline_t *state,
                                       const controller_settings_t *controllers,
                                       const protection_config_t *protection,
                                       uint8_t selected_mode,
                                       bool complementary,
                                       control_sample_t sample,
                                       bool platform_permit);

#endif
