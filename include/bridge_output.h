#ifndef BRIDGE_OUTPUT_H
#define BRIDGE_OUTPUT_H

#include "bridge_policy.h"

#include <stdbool.h>
#include <stdint.h>

/* Target-specific electrical mapping; no MMIO so it can be checked on host. */
typedef struct {
    uint16_t channel_0;
    uint16_t channel_2;
    /* Signed effort after the duty cap, before motor polarity conversion. */
    int16_t applied_effort;
    bool gate_enabled;
} bridge_output_t;

bool bridge_output_map_standard(bridge_request_t request, bool motor_polarity,
                                bridge_output_t *output);

#endif
