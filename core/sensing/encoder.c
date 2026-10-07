#include "sensing.h"

enum { TURN_COUNTS = 4096, WRAP_THRESHOLD = TURN_COUNTS - 20,
       MAX_PLAUSIBLE_STEP = 1024 };

void encoder_tracker_init(encoder_tracker_t *tracker)
{
    tracker->turns = 0;
    tracker->previous_angle = 0;
    tracker->filtered_position = 0;
    tracker->position = 0;
    tracker->arm_position_q8 = 0;
    tracker->initialized = false;
    tracker->mode_valid = false;
    tracker->previous_mode = 0;
}

static int32_t wrap_angle(int32_t angle)
{
    angle %= TURN_COUNTS;
    if (angle < 0) angle += TURN_COUNTS;
    return angle;
}

bool encoder_calibration_offset(uint16_t raw_angle, bool reverse,
                                int16_t desired_position, int32_t *offset)
{
    if (offset == 0 || raw_angle >= TURN_COUNTS ||
        desired_position < -(TURN_COUNTS - 1) ||
        desired_position > TURN_COUNTS - 1) return false;
    int32_t sample = reverse ? TURN_COUNTS - 1 - (int32_t)raw_angle : raw_angle;
    /* Keep the full calibration difference for the immediate RAM position.
     * Storage encoding handles a positive value outside its 13-bit range. */
    *offset = sample - desired_position;
    return true;
}

bool encoder_tracker_sample(encoder_tracker_t *tracker, uint16_t raw_angle,
                            bool reverse, int32_t offset, uint8_t mode,
                            int32_t *position)
{
    if (raw_angle >= TURN_COUNTS || position == 0) return false;
    if (tracker->mode_valid && tracker->previous_mode != mode) {
        /* Work-mode transitions establish a new single-turn origin. */
        tracker->initialized = false;
        tracker->turns = 0;
    }
    tracker->previous_mode = mode;
    tracker->mode_valid = true;
    int32_t sample = reverse ? TURN_COUNTS - 1 - (int32_t)raw_angle : raw_angle;
    if (mode != 0u && mode != 3u) {
        tracker->initialized = false;
        tracker->position = sample;
        tracker->arm_position_q8 = (int64_t)sample * 256;
        *position = sample;
        return true;
    }
    int32_t corrected = wrap_angle(sample - offset % TURN_COUNTS);
    if (!tracker->initialized) {
        tracker->initialized = true;
        tracker->turns = 0;
        tracker->previous_angle = corrected;
        tracker->filtered_position = corrected;
        tracker->position = corrected;
        tracker->arm_position_q8 = (int64_t)corrected * 256;
    } else {
        int32_t delta = corrected - tracker->previous_angle;
        /* A one-sample I2C outlier near zero has been observed with a static
         * encoder near 3931. Reject non-wrap jumps beyond a quarter turn;
         * retain the last valid state so the next sample can recover. */
        if ((delta > MAX_PLAUSIBLE_STEP && delta <= WRAP_THRESHOLD) ||
            (delta < -MAX_PLAUSIBLE_STEP && delta >= -WRAP_THRESHOLD)) {
            return false;
        }
        int64_t turns = tracker->turns;
        if (delta > WRAP_THRESHOLD) --turns;
        else if (delta < -WRAP_THRESHOLD) ++turns;
        int64_t unfiltered = (int64_t)corrected + turns * TURN_COUNTS;
        if (unfiltered < INT32_MIN || unfiltered > INT32_MAX) return false;
        tracker->turns = (int32_t)turns;
        tracker->previous_angle = corrected;
        tracker->filtered_position = (int32_t)(
            ((int64_t)tracker->filtered_position * 2 + unfiltered * 8) / 10);
        /* Preserve the same 20/80 blend for arm mode, retaining fractions
         * so a one-count increase cannot remain hidden indefinitely. The
         * numerator fits int64_t across the accepted int32_t count range. */
        tracker->arm_position_q8 =
            (tracker->arm_position_q8 * 2 + unfiltered * 256 * 8) / 10;
        tracker->position = tracker->filtered_position;
    }
    *position = tracker->position;
    return true;
}

int32_t encoder_arm_position(const encoder_tracker_t *tracker)
{
    int64_t position = tracker->arm_position_q8;
    return (int32_t)((position + (position < 0 ? -128 : 128)) / 256);
}

void speed_tracker_init(speed_tracker_t *tracker)
{
    tracker->previous_position = 0;
    tracker->measured_delta = 0;
    tracker->sample_count = 0;
    tracker->initialized = false;
    tracker->moving = false;
}

void speed_tracker_sample(speed_tracker_t *tracker, int32_t position,
                          uint8_t motion_rate_scale, uint8_t moving_deadband)
{
    if (!tracker->initialized) {
        tracker->initialized = true;
        tracker->previous_position = position;
        tracker->sample_count = 0;
    }
    uint32_t scale = motion_rate_scale == 0u ? 1u : motion_rate_scale;
    uint32_t interval = 1000u / scale;
    if (interval == 0u) interval = 1u;
    ++tracker->sample_count;
    if (tracker->sample_count >= interval) {
        uint16_t wrapped = (uint16_t)((uint32_t)position - (uint32_t)tracker->previous_position);
        int32_t delta = (int16_t)wrapped;
        tracker->previous_position = position;
        tracker->sample_count = 0;
        if (delta < -2048) delta += 4096;
        else if (delta > 2048) delta -= 4096;
        tracker->measured_delta = (int16_t)delta;
    }
    int32_t speed = tracker->measured_delta;
    if (speed < 0) speed = -speed;
    tracker->moving = speed >= moving_deadband;
    if (!tracker->moving) tracker->measured_delta = 0;
}
