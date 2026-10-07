#include "output_safety.h"

enum { REQUIRED_FRESH_PAIRS = 10 };

void output_safety_init(output_safety_t *state, bool board_capable)
{
    state->phase = board_capable ? OUTPUT_REQUALIFYING : OUTPUT_FAILED;
    state->fresh_pairs = 0u;
}

void output_safety_revoke(output_safety_t *state)
{
    if (state->phase == OUTPUT_READY || state->phase == OUTPUT_REQUALIFYING) {
        state->phase = OUTPUT_REQUALIFYING;
        state->fresh_pairs = 0u;
    }
}

void output_safety_begin_maintenance(output_safety_t *state)
{
    if (state->phase != OUTPUT_FAILED) state->phase = OUTPUT_MAINTENANCE;
    state->fresh_pairs = 0u;
}

void output_safety_end_maintenance(output_safety_t *state, bool sensors_active)
{
    if (state->phase == OUTPUT_MAINTENANCE)
        state->phase = sensors_active ? OUTPUT_REQUALIFYING : OUTPUT_FAILED;
    state->fresh_pairs = 0u;
}

void output_safety_pair_accepted(output_safety_t *state)
{
    if (state->phase != OUTPUT_REQUALIFYING) return;
    if (++state->fresh_pairs >= REQUIRED_FRESH_PAIRS)
        state->phase = OUTPUT_READY;
}

void output_safety_fail(output_safety_t *state)
{
    state->phase = OUTPUT_FAILED;
    state->fresh_pairs = 0u;
}

bool output_safety_permit(const output_safety_t *state, bool motion_valid,
                          bool configuration_stable, bool encoder_healthy,
                          bool lease_valid)
{
    return state->phase == OUTPUT_READY && motion_valid &&
           configuration_stable && encoder_healthy && lease_valid;
}
