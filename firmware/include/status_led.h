#ifndef STATUS_LED_H
#define STATUS_LED_H

#include <stdbool.h>
#include <stdint.h>

typedef struct {
    uint8_t blink_counter;
    bool high_phase;
} status_led_t;

typedef struct {
    bool write_output;
    bool output_on;
} status_led_update_t;

void status_led_init(status_led_t *state);
status_led_update_t status_led_step(status_led_t *state,
                                    uint8_t alarm_mask,
                                    uint8_t errors);

#endif
