#ifndef ARM_CONTROL_H
#define ARM_CONTROL_H

#include <stdbool.h>
#include <stdint.h>
#include "arm_motion.h"

/* Command acceleration limit; actual load and supply limits still apply. */
enum { ARM_VELOCITY_WINDOW = 8, ARM_MAX_ACCELERATION_COUNTS_S2 = 30000 };

/* Nonnegative directional gains, effort/(count/s) Q8. A zero cap disables
 * local FF. Configuration is RAM-only and changes only while disarmed. */
typedef struct {
    uint16_t positive_gain_q8, negative_gain_q8, effort_limit;
} arm_velocity_ff_t;

/* Positions use encoder counts ×256. Speed and acceleration limits use whole
 * counts/s and counts/s². P gain is effort/count ×256, D is effort/(count/s) ×256,
 * and I is effort/(count·s) ×256. Effort is a signed PWM command, not torque. */
typedef struct {
    uint16_t kp_q8, kd_q8, ki_q8;
    uint16_t integral_limit, effort_limit;
    uint16_t velocity_limit, acceleration_limit;
    uint8_t velocity_filter_q8, ramp_time_ms;
    arm_velocity_ff_t velocity_ff;
    uint16_t gravity_slew;
} arm_config_t;

/* Position is clamped to the configured travel envelope before planning.
 * Speed is positive counts/s, capped by arm_config_t. Acceleration and
 * gravity slew belong to the configuration, fixed throughout an armed session. */
typedef struct {
    int32_t position_q8;
    uint16_t speed_limit;
    uint16_t sequence;
} arm_target_t;

typedef struct {
    int32_t reference_position_q8, reference_velocity_q8_s;
    int32_t measured_velocity_q8_s;
    int16_t p_term, d_term, i_term, feedforward;
    int16_t gravity_feedforward, velocity_feedforward;
    int16_t requested_effort;
    bool saturated, active, holding, fresh, advanced;
    uint16_t session, accepted_sequence, gravity_sequence;
} arm_result_t;

typedef struct {
    /* Host gravity only; Q16 effort retains fractional slew steps. */
    int32_t gravity_effort_q16;
    int16_t gravity_target;
    uint16_t gravity_sequence;
    bool gravity_received;
    arm_config_t config;
    arm_motion_t motion;
    /* Cached legacy travel limits, captured when arming; not extension settings. */
    int32_t lower_q8, upper_q8;
    int32_t filtered_velocity_q8_s;
    int32_t last_reference_position_q8, last_reference_velocity_q8_s;
    /* Integral effort scaled by 65536*1000; clamp the stored state itself. */
    int64_t integral_effort_q16_ms, integral_before_step;
    int32_t velocity_positions_q8[ARM_VELOCITY_WINDOW];
    uint8_t velocity_intervals_ms[ARM_VELOCITY_WINDOW];
    uint8_t velocity_cursor;
    uint16_t velocity_window_ms;
    uint16_t stationary_ms;
    int32_t last_raw_effort;
    int16_t last_feedforward;
    bool integral_pending;
    uint32_t last_tick;
    uint16_t accepted_sequence, session;
    int16_t last_requested_effort;
    uint16_t overrun_count;
    bool initialized, target_active;
    bool armed, holding;
} arm_control_t;

void arm_control_init(arm_control_t *state, int32_t position_counts,
                      uint32_t now_ms);
bool arm_control_configure(arm_control_t *state, arm_config_t config);
bool arm_control_arm(arm_control_t *state, uint16_t session,
                     int32_t position_counts, uint32_t now_ms,
                     uint16_t minimum, uint16_t maximum);
void arm_control_disarm(arm_control_t *state);
bool arm_control_target(arm_control_t *state, uint16_t session,
                        arm_target_t target);
bool arm_control_gravity(arm_control_t *state, uint16_t session,
    uint16_t sequence, int16_t gravity, uint32_t now_ms);
arm_result_t arm_control_step(arm_control_t *state, int32_t position_counts,
                              uint32_t now_ms, bool fresh,
                              bool current_limit_active);
/* Called with the actual protected output, and false if the bridge cannot drive. */
void arm_control_applied(arm_control_t *state, int16_t applied,
                         bool drive_enabled);
/* Factory bridge effort drives the encoder opposite to positive count motion.
 * Convert in either direction at the arm/legacy bridge boundary. */
int16_t arm_control_flip_effort_polarity(int16_t effort);

#endif
