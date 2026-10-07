#ifndef BUS_TIMING_H
#define BUS_TIMING_H

#include <stdint.h>

uint32_t bus_baud_rate(uint8_t index);
/* Factory slot spacing includes three byte-times beyond the status frame. */
uint16_t bus_slot_us(uint8_t response_length, uint8_t baud_index);
uint32_t bus_response_timeout_ms(uint8_t slot, uint8_t length, uint8_t baud_index);

#endif
