#ifndef ACQUISITION_H
#define ACQUISITION_H

#include <stdbool.h>
#include <stdint.h>

/* Foreground-owned rendezvous. Generation tags reject late completions from
 * an earlier timer period; no control step consumes a partial pair. */
typedef struct {
    uint32_t generation;
    uint32_t completed_pairs;
    uint32_t missed_pairs;
    uint16_t encoder_raw;
    uint16_t adc_raw[3];
    bool encoder_ready;
    bool adc_ready;
    bool pending;
    bool fault;
} acquisition_t;

void acquisition_init(acquisition_t *state);
uint32_t acquisition_begin(acquisition_t *state);
bool acquisition_encoder_done(acquisition_t *state, uint32_t generation,
                              bool valid, uint16_t raw_angle);
bool acquisition_adc_done(acquisition_t *state, uint32_t generation,
                          bool valid, const uint16_t samples[3]);
bool acquisition_take_pair(acquisition_t *state, uint16_t *encoder_raw,
                           uint16_t samples[3]);

#endif
