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
} sensor_pair_t;
#endif
