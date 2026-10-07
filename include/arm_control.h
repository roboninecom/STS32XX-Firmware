#ifndef ARM_CONTROL_H
#define ARM_CONTROL_H

#include <stdbool.h>
#include <stdint.h>

/* Provisional standalone-motor envelope after the 6000/60000 braking-voltage
 * excursion. This is a command limit, not a loaded-arm voltage guarantee. */
enum { ARM_VELOCITY_WINDOW = 8, ARM_QUEUE_CAPACITY = 2, ARM_MAX_ACCELERATION_COUNTS_S2 = 30000 };

/* Positions use encoder counts ×256; speeds counts/s ×256; acceleration
 * counts/s² ×256. P gain is effort/count ×256, D is effort/(count/s) ×256,
 * and I is effort/(count·s) ×256. Effort is a signed PWM command, not torque. */
typedef struct {
    uint16_t kp_q8, kd_q8, ki_q8;
    uint16_t integral_limit, effort_limit;
    uint16_t velocity_limit, acceleration_limit;
    uint16_t timeout_ms;
    uint8_t velocity_filter_q8;
    int32_t position_min_q8, position_max_q8;
} arm_config_t;

typedef struct {
    int32_t position_q8, velocity_q8_s, acceleration_q8_s2;
    int16_t feedforward;
    uint16_t duration_ms;
    uint16_t sequence;
} arm_segment_t;

/* A servo-planned move stops at position_q8. Speed, acceleration and braking
 * are positive counts/s and counts/s², capped by arm_config_t. */
typedef struct {
    int32_t position_q8;
    uint16_t speed_limit, acceleration, braking;
    int16_t feedforward;
    uint16_t sequence;
} arm_target_t;

typedef struct {
    int32_t reference_position_q8, reference_velocity_q8_s;
    int32_t measured_velocity_q8_s;
    int16_t p_term, d_term, i_term, feedforward;
    int16_t requested_effort;
    bool saturated, active, holding, fresh;
    uint16_t accepted_sequence;
} arm_result_t;

typedef struct {
    uint16_t kp_q8, kd_q8, ki_q8, integral_limit, effort_limit;
    uint8_t velocity_filter_q8;
} arm_profile_t;

typedef struct {
    /* Independent v1.6 bias stream; Q16 effort retains fractional slew steps. */
    int32_t gravity_effort_q16, dynamic_effort_q16;
    int16_t gravity_target, dynamic_target;
    uint16_t feedforward_sequence, feedforward_slew, feedforward_ttl_ms;
    uint32_t feedforward_tick;
    bool feedforward_enabled, feedforward_stale;
    arm_config_t config;
    arm_profile_t profiles[2];
    uint16_t profile_generation[2];
    uint8_t active_profile;
    int32_t transition_bias; /* effort; decays at at most 1 effort/ms */
    arm_segment_t queue[ARM_QUEUE_CAPACITY];
    uint8_t queue_head, queue_count;
    arm_segment_t current;
    arm_target_t pending_target, target;
    int32_t start_position_q8, start_velocity_q8_s, start_acceleration_q8_s2;
    int32_t target_position_remainder, target_velocity_remainder;
    int16_t start_feedforward;
    int32_t measured_position_q8, filtered_velocity_q8_s;
    int32_t last_reference_position_q8, last_reference_velocity_q8_s;
    /* Integral effort scaled by 65536*1000; clamp the stored state itself. */
    int64_t integral_effort_q16_ms, integral_before_step;
    int32_t velocity_positions_q8[ARM_VELOCITY_WINDOW];
    uint8_t velocity_intervals_ms[ARM_VELOCITY_WINDOW];
    uint8_t velocity_cursor;
    uint16_t velocity_window_ms, stop_braking;
    uint16_t stationary_ms;
    int32_t last_raw_effort;
    int16_t last_feedforward;
    bool integral_pending;
    uint32_t last_tick, last_command_tick;
    uint16_t elapsed_ms, accepted_sequence, session;
    int16_t last_requested_effort;
    uint16_t overrun_count;
    bool initialized, running, segment_mode, target_mode, target_pending, target_active;
    bool armed, holding, expired;
} arm_control_t;

void arm_control_init(arm_control_t *state, int32_t position_counts,
                      uint32_t now_ms);
bool arm_control_configure(arm_control_t *state, arm_config_t config);
bool arm_control_arm(arm_control_t *state, uint16_t session,
                     int32_t position_counts, uint32_t now_ms);
void arm_control_disarm(arm_control_t *state);
bool arm_control_submit(arm_control_t *state, uint16_t session,
                        arm_segment_t segment, uint32_t now_ms);
bool arm_control_target(arm_control_t *state, uint16_t session,
                        arm_target_t target, uint32_t now_ms);
bool arm_control_start(arm_control_t *state, uint16_t session, uint32_t now_ms);
/* Explicit powered operations; never select a controller or enable a bridge. */
bool arm_control_stop(arm_control_t *state, uint16_t session, uint32_t now_ms);
bool arm_control_takeover(arm_control_t *state, uint16_t expected_session,
                          uint16_t expected_sequence, uint16_t new_session,
                          uint32_t now_ms);
bool arm_control_stage_profile(arm_control_t *state, uint16_t session,
    uint8_t slot, uint16_t generation, arm_profile_t profile);
bool arm_control_commit_profile(arm_control_t *state, uint16_t session,
    uint16_t sequence, uint8_t slot, uint16_t generation, uint32_t now_ms);
bool arm_control_feedforward(arm_control_t *state, uint16_t session,
    uint16_t sequence, int16_t gravity, int16_t dynamic,
    uint16_t slew_effort_s, uint16_t ttl_ms, uint32_t now_ms);
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
