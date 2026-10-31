#include "sensing.h"

/* Logical sample order is temperature, current, voltage. The board driver
 * owns the physical channel-to-DMA-slot mapping. These are 12-bit samples. */
static const uint16_t temperature_lut[31] = {
    0x250, 0x216, 0x1dd, 0x1a7, 0x175, 0x147, 0x11e, 0x0f9,
    0x0d8, 0x0bc, 0x0a3, 0x08e, 0x07b, 0x06b, 0x05e, 0x052,
    0x048, 0x03f, 0x038, 0x031, 0x02b, 0x027, 0x022, 0x01f,
    0x01b, 0x019, 0x016, 0x014, 0x012, 0x010, 0x00f
};

void adc_tracker_init(adc_tracker_t *tracker)
{
    tracker->current_baseline_sum = 0;
    tracker->current_baseline = 0;
    tracker->baseline_remaining = 16;
    tracker->temperature_scale = 5;
}

static uint8_t temperature_convert(uint16_t sample, uint8_t scale)
{
    uint16_t value = sample >> 2;
    if (value >= temperature_lut[0]) return 0;
    for (uint8_t index = 0; index < 30; ++index) {
        uint16_t high = temperature_lut[index];
        uint16_t low = temperature_lut[index + 1u];
        if (value >= low) {
            uint32_t fraction = (uint32_t)scale * (high - value) / (high - low);
            return (uint8_t)(scale * index + fraction);
        }
    }
    return 150;
}

bool adc_tracker_sample(adc_tracker_t *tracker, const uint16_t samples[3],
                        bool complementary_output, adc_reading_t *reading)
{
    if (tracker == 0 || samples == 0 || reading == 0) return false;
    for (unsigned i = 0; i < 3; ++i) {
        if (samples[i] > 4095u) return false;
    }
    reading->temperature = temperature_convert(samples[0], tracker->temperature_scale);
    reading->voltage = (uint8_t)(samples[2] >> 4);
    reading->current = 0;
    if (complementary_output) return true;
    int16_t current = (int16_t)(samples[1] >> 2);
    if (tracker->baseline_remaining != 0u) {
        tracker->current_baseline_sum += current;
        --tracker->baseline_remaining;
        if (tracker->baseline_remaining == 0u) {
            tracker->current_baseline = (int16_t)(tracker->current_baseline_sum >> 4);
        }
    } else {
        reading->current = (int16_t)(current - tracker->current_baseline);
    }
    return true;
}
