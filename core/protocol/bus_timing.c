#include "bus_timing.h"

static unsigned baud_index(uint8_t index) { return index < 8u ? index : 0u; }

uint32_t bus_baud_rate(uint8_t index)
{
    static const uint32_t rates[8] = {
        1000000u, 500000u, 250000u, 128000u,
        115107u, 76800u, 57600u, 38400u
    };
    return rates[baud_index(index)];
}

uint16_t bus_slot_us(uint8_t length, uint8_t index)
{
    /* Rounded per byte, as in reconstruction uart_response_delay_ticks.
     * Max valid response is 93 bytes: 96 * 261 = 25,056 us. */
    static const uint16_t byte_us[8] = {10, 20, 40, 79, 87, 131, 174, 261};
    return (uint16_t)(((uint32_t)length + 3u) * byte_us[baud_index(index)]);
}

uint32_t bus_response_timeout_ms(uint8_t slot, uint8_t length, uint8_t index)
{
    uint32_t wire_us = ((uint32_t)slot + 1u) * bus_slot_us(length, index);
    uint32_t deadline = (wire_us + 999u) / 1000u + 20u;
    return deadline < 500u ? 500u : deadline;
}
