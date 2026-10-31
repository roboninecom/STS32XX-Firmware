#ifndef SENSING_H
#define SENSING_H

#include <stdbool.h>
#include <stdint.h>

typedef struct {
    int32_t turns;
    int32_t previous_angle;
    int32_t filtered_position;
    int32_t position;
    /* Arm filter retains Q8 fractions; the legacy whole-count path above
     * remains unchanged. Wide state supports the full tracked count range. */
    int64_t arm_position_q8;
    bool initialized;
    bool mode_valid;
    uint8_t previous_mode;
} encoder_tracker_t;

typedef struct {
    int32_t previous_position;
    int16_t measured_delta;
    uint16_t sample_count;
    bool initialized;
    bool moving;
} speed_tracker_t;

void encoder_tracker_init(encoder_tracker_t *tracker);
bool encoder_tracker_sample(encoder_tracker_t *tracker, uint16_t raw_angle,
                            bool reverse, int32_t offset, uint8_t mode,
                            int32_t *position);
/* Round only at the arm controller boundary, symmetrically about zero. */
int32_t encoder_arm_position(const encoder_tracker_t *tracker);
bool encoder_calibration_offset(uint16_t raw_angle, bool reverse,
                                int16_t desired_position, int32_t *offset);
void speed_tracker_init(speed_tracker_t *tracker);
void speed_tracker_sample(speed_tracker_t *tracker, int32_t position,
                          uint8_t motion_rate_scale, uint8_t moving_deadband);

typedef struct {
    int32_t current_baseline_sum;
    int16_t current_baseline;
    uint8_t baseline_remaining;
    uint8_t temperature_scale;
} adc_tracker_t;

typedef struct {
    uint8_t temperature;
    uint8_t voltage;
    int16_t current;
} adc_reading_t;

void adc_tracker_init(adc_tracker_t *tracker);
bool adc_tracker_sample(adc_tracker_t *tracker, const uint16_t samples[3],
                        bool complementary_output, adc_reading_t *reading);

#endif
