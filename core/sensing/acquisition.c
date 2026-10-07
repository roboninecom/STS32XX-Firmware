#include "acquisition.h"

void acquisition_init(acquisition_t *state)
{
    *state = (acquisition_t){0};
}

uint32_t acquisition_begin(acquisition_t *state)
{
    if (state->pending) {
        ++state->missed_pairs;
        state->fault = true;
    }
    ++state->generation; /* Unsigned wrap is intentional; equality still works. */
    state->pending = true;
    state->encoder_ready = false;
    state->adc_ready = false;
    return state->generation;
}

bool acquisition_encoder_done(acquisition_t *state, uint32_t generation,
                              bool valid, uint16_t raw_angle)
{
    if (!state->pending || generation != state->generation || state->encoder_ready) {
        return false;
    }
    if (!valid || raw_angle > 4095u) {
        state->fault = true;
        return false;
    }
    state->encoder_raw = raw_angle;
    state->encoder_ready = true;
    return true;
}

bool acquisition_adc_done(acquisition_t *state, uint32_t generation,
                          bool valid, const uint16_t samples[3])
{
    if (!state->pending || generation != state->generation || state->adc_ready) {
        return false;
    }
    if (!valid || samples == 0 || samples[0] > 4095u ||
        samples[1] > 4095u || samples[2] > 4095u) {
        state->fault = true;
        return false;
    }
    for (unsigned i = 0; i < 3; ++i) state->adc_raw[i] = samples[i];
    state->adc_ready = true;
    return true;
}

bool acquisition_take_pair(acquisition_t *state, uint16_t *encoder_raw,
                           uint16_t samples[3])
{
    if (!state->pending || !state->encoder_ready || !state->adc_ready ||
        encoder_raw == 0 || samples == 0) return false;
    *encoder_raw = state->encoder_raw;
    for (unsigned i = 0; i < 3; ++i) samples[i] = state->adc_raw[i];
    state->pending = false;
    ++state->completed_pairs;
    state->fault = false;
    return true;
}
