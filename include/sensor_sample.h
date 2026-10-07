#ifndef SENSOR_SAMPLE_H
#define SENSOR_SAMPLE_H
#include <stdbool.h>
#include <stdint.h>

/* One complete acquisition; timestamp precedes transfer and foreground work.
 * Invalid pairs never drive. Buffers belong to the producer until publication. */
typedef struct {
    uint32_t tick_ms;
    uint16_t encoder_raw;
    uint16_t adc_raw[3];
    bool valid;
#ifdef FW_TIMING_PROBE
    uint32_t started_cycles;
    uint16_t tick_late_us;
#endif
} sensor_pair_t;
#endif
