#ifndef OUTPUT_SAFETY_H
#define OUTPUT_SAFETY_H

#include <stdbool.h>
#include <stdint.h>

typedef enum {
    OUTPUT_REQUALIFYING,
    OUTPUT_READY,
    OUTPUT_MAINTENANCE,
    OUTPUT_FAILED,
} output_phase_t;

typedef struct {
    output_phase_t phase;
    uint8_t fresh_pairs;
} output_safety_t;

void output_safety_init(output_safety_t *state, bool board_capable);
void output_safety_revoke(output_safety_t *state);
void output_safety_begin_maintenance(output_safety_t *state);
void output_safety_end_maintenance(output_safety_t *state, bool sensors_active);
void output_safety_pair_accepted(output_safety_t *state);
void output_safety_fail(output_safety_t *state);
bool output_safety_permit(const output_safety_t *state, bool motion_valid,
                          bool configuration_stable, bool encoder_healthy);

#endif
