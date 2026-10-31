#include "status_led.h"

enum {
    LED_RELEVANT_ERRORS = 0x2fu,
    LED_HALF_PERIOD_TICKS = 100u,
};

void status_led_init(status_led_t *state)
{
    *state = (status_led_t){0};
}

status_led_update_t status_led_step(status_led_t *state,
                                    uint8_t alarm_mask,
                                    uint8_t errors)
{
    if (alarm_mask == 0u) {
        return (status_led_update_t){.write_output = true, .output_on = false};
    }
    if ((alarm_mask & errors & LED_RELEVANT_ERRORS) == 0u) {
        return (status_led_update_t){.write_output = true, .output_on = true};
    }
    if (state->blink_counter < LED_HALF_PERIOD_TICKS) {
        ++state->blink_counter;
        return (status_led_update_t){0};
    }
    state->blink_counter = 0u;
    state->high_phase = !state->high_phase;
    return (status_led_update_t){
        .write_output = true,
        .output_on = !state->high_phase,
    };
}
