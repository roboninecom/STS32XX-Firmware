#include "status_led.h"

#include <assert.h>
#include <stdio.h>

int main(void)
{
    status_led_t led;
    status_led_init(&led);

    status_led_update_t update = status_led_step(&led, 0u, 0u);
    assert(update.write_output && !update.output_on);
    update = status_led_step(&led, 0x3fu, 0u);
    assert(update.write_output && update.output_on);

    for (unsigned i = 0; i < 100u; ++i) {
        update = status_led_step(&led, 1u, 1u);
        assert(!update.write_output);
    }
    update = status_led_step(&led, 1u, 1u);
    assert(update.write_output && !update.output_on);
    for (unsigned i = 0; i < 100u; ++i)
        assert(!status_led_step(&led, 1u, 1u).write_output);
    update = status_led_step(&led, 1u, 1u);
    assert(update.write_output && update.output_on);

    update = status_led_step(&led, 0x10u, 0x10u);
    assert(update.write_output && update.output_on);
    update = status_led_step(&led, 0u, 1u);
    assert(update.write_output && !update.output_on);

    puts("Status LED policy and blink phase: OK");
}
