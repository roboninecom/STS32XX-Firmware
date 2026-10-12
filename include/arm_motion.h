#ifndef ARM_MOTION_H
#define ARM_MOTION_H

#include <stdbool.h>
#include <stdint.h>

/* Internal units: counts/ms^n Q36; phase time: milliseconds Q16.
 * Seven slots cover two acceleration transitions and an optional cruise. */
enum { ARM_MOTION_PHASES = 7 };
typedef struct {
    uint64_t remaining;
    int32_t jerk, end_acceleration;
} arm_motion_phase_t;
typedef struct {
    int64_t position, velocity, goal, cruise_velocity;
    int32_t acceleration;
    arm_motion_phase_t phase[ARM_MOTION_PHASES];
    uint16_t speed_limit, acceleration_limit;
    uint8_t cursor;
} arm_motion_t;

void arm_motion_init(arm_motion_t *motion, int32_t position_q8);
bool arm_motion_idle(const arm_motion_t *motion);
int32_t arm_motion_position(const arm_motion_t *motion);
int32_t arm_motion_velocity(const arm_motion_t *motion);
/* Preparation is atomic. The caller owns session/command sequencing. */
bool arm_motion_target(arm_motion_t *motion, int32_t target_q8,
    uint16_t speed, uint16_t acceleration, uint8_t ramp_ms,
    int32_t lower_q8, int32_t upper_q8);
void arm_motion_step(arm_motion_t *motion, uint32_t milliseconds);

#ifdef FW_ARM_TIMING_PROBE
/* Timing-only observer supplied by the application; no MCU dependency here. */
enum { ARM_TIMING_TARGET, ARM_TIMING_VALIDATION, ARM_TIMING_EVALUATION,
       ARM_TIMING_COUNT };
extern uint16_t arm_motion_iterations;
uint32_t arm_motion_clock(void);
void arm_motion_record(unsigned operation, uint32_t started);
#endif

#endif
