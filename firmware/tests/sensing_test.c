#include "sensing.h"

#include <assert.h>
#include <stdio.h>

static void arm_position_filter_test(void)
{
    encoder_tracker_t encoder;
    int32_t legacy;
    encoder_tracker_init(&encoder);
    assert(encoder_tracker_sample(&encoder, 1000, false, 0, 0, &legacy));
    for (unsigned i = 0; i < 100; ++i)
        assert(encoder_tracker_sample(&encoder, 1001, false, 0, 0, &legacy));
    assert(legacy == 1000); /* Factory readback is unchanged. */
    assert(encoder_arm_position(&encoder) == 1001);
    encoder_tracker_init(&encoder);
    assert(encoder_tracker_sample(&encoder, 1000, false, 0, 0, &legacy));
    assert(encoder_tracker_sample(&encoder, 999, false, 0, 0, &legacy));
    assert(encoder_arm_position(&encoder) == 999);

    /* Signed wrap and a rejected outlier preserve the arm history too. */
    encoder_tracker_init(&encoder);
    assert(encoder_tracker_sample(&encoder, 0, false, 0, 0, &legacy));
    assert(encoder_tracker_sample(&encoder, 4095, false, 0, 0, &legacy));
    assert(encoder_arm_position(&encoder) == -1);
    int64_t previous = encoder.arm_position_q8;
    assert(!encoder_tracker_sample(&encoder, 2000, false, 0, 0, &legacy));
    assert(encoder.arm_position_q8 == previous);
    assert(encoder_tracker_sample(&encoder, 123, false, 0, 1, &legacy));
    assert(encoder_arm_position(&encoder) == 123); /* Mode change reanchors. */
}

int main(void)
{
    arm_position_filter_test();
    encoder_tracker_t encoder;
    speed_tracker_t speed;
    int32_t position;
    encoder_tracker_init(&encoder);
    int32_t correction;
    assert(encoder_calibration_offset(1802, false, 2048, &correction));
    assert(correction == -246);
    assert(encoder_calibration_offset(1802, true, 2000, &correction));
    assert(correction == 293);
    assert(encoder_calibration_offset(4095, false, -4095, &correction));
    assert(correction == 8190);
    assert(!encoder_calibration_offset(4096, false, 2048, &correction));
    assert(!encoder_calibration_offset(1802, false, 4096, &correction));
    assert(!encoder_calibration_offset(1802, false, 2048, 0));
    assert(!encoder_tracker_sample(&encoder, 4096, false, 0, 0, &position));
    assert(encoder_tracker_sample(&encoder, 4095, false, 0, 0, &position));
    assert(position == 4095);
    assert(encoder_tracker_sample(&encoder, 0, false, 0, 0, &position));
    assert(position == 4095); /* 8/10 filtering of the one-tick wrap */
    assert(encoder.turns == 1);
    assert(encoder_tracker_sample(&encoder, 1, false, 0, 0, &position));
    assert(position == 4096);
    encoder_tracker_init(&encoder);
    assert(encoder_tracker_sample(&encoder, 3931, false, 0, 0, &position));
    assert(!encoder_tracker_sample(&encoder, 13, false, 0, 0, &position));
    assert(encoder.previous_angle == 3931 && encoder.position == 3931);
    assert(encoder_tracker_sample(&encoder, 3931, false, 0, 0, &position));
    assert(position == 3931);
    assert(encoder_tracker_sample(&encoder, 100, false, 0, 1, &position));
    assert(position == 100 && !encoder.initialized);
    assert(encoder_tracker_sample(&encoder, 100, true, 0, 0, &position));
    assert(position == 3995);
    encoder_tracker_init(&encoder);
    assert(encoder_tracker_sample(&encoder, 5, false, 0, 3, &position));
    assert(encoder_tracker_sample(&encoder, 4090, false, 0, 3, &position));
    assert(position < 0 && encoder.turns == -1);
    assert(encoder_tracker_sample(&encoder, 4090, false, 0, 0, &position));
    assert(position == 4090 && encoder.turns == 0);
    assert(encoder_tracker_sample(&encoder, 5, false, 0, 0, &position));
    assert(position > 4090 && encoder.turns == 1);
    encoder_tracker_init(&encoder);
    assert(encoder_tracker_sample(&encoder, 100, false, INT32_MIN, 0, &position));
    encoder_tracker_init(&encoder);
    assert(encoder_tracker_sample(&encoder, 4095, false, 0, 0, &position));
    encoder.turns = INT32_MAX / 4096;
    assert(!encoder_tracker_sample(&encoder, 0, false, 0, 0, &position));
    assert(encoder.previous_angle == 4095);

    speed_tracker_init(&speed);
    for (unsigned i = 0; i < 20; ++i) {
        speed_tracker_sample(&speed, (int32_t)i, 50, 1);
    }
    assert(speed.measured_delta == 19 && speed.moving);
    speed_tracker_sample(&speed, 20, 50, 100);
    assert(speed.measured_delta == 0 && !speed.moving);
    /* S0 characterization: callers currently choose the sampling interval on
     * every update. The application passes live register 82, unlike the
     * reconstruction's reset-cached motion rate. */
    speed_tracker_init(&speed);
    for (unsigned i = 0; i < 10; ++i) {
        speed_tracker_sample(&speed, (int32_t)i, 50, 1);
    }
    assert(speed.sample_count == 10 && speed.measured_delta == 0);
    speed_tracker_sample(&speed, 10, 100, 1);
    assert(speed.sample_count == 0 && speed.measured_delta == 10);
    speed_tracker_init(&speed);
    for (unsigned i = 0; i < 1000; ++i) {
        speed_tracker_sample(&speed, (int32_t)i, 0, 1);
    }
    assert(speed.measured_delta == 999);
    adc_tracker_t adc;
    adc_reading_t reading;
    uint16_t samples[3] = {0x250u << 2, 400, 1600};
    adc_tracker_init(&adc);
    for (unsigned i = 0; i < 16; ++i) {
        assert(adc_tracker_sample(&adc, samples, false, &reading));
        assert(reading.current == 0);
    }
    assert(reading.temperature == 0 && reading.voltage == 100);
    samples[1] = 440;
    assert(adc_tracker_sample(&adc, samples, false, &reading));
    assert(reading.current == 10);
    assert(adc_tracker_sample(&adc, samples, true, &reading));
    assert(reading.current == 0);
    samples[2] = 4096;
    assert(!adc_tracker_sample(&adc, samples, false, &reading));
    samples[2] = 1600;
    samples[0] = 0x216u << 2;
    assert(adc_tracker_sample(&adc, samples, false, &reading));
    assert(reading.temperature == 5);
    samples[0] = 0;
    assert(adc_tracker_sample(&adc, samples, false, &reading));
    assert(reading.temperature == 150);
    puts("Portable sensing tests: OK");
}
