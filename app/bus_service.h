#ifndef BUS_SERVICE_H
#define BUS_SERVICE_H

#include "protocol_service.h"
#include "uart_driver.h"

typedef enum {
    BUS_RECEIVE,
    BUS_WAIT_IDLE,
    BUS_WAIT_SLOT,
    BUS_TRANSMIT,
} bus_phase_t;

typedef struct {
    protocol_service_t protocol;
    uart_driver_t uart;
    const uint8_t *reply;
    uint8_t reply_length;
    uint8_t reply_slot;
    bus_phase_t phase;
    uint32_t phase_started_tick;
    uint32_t last_poll_tick;
    uint16_t response_timeouts;
    bool baud_pending;
#ifdef FW_TIMING_PROBE
    uint8_t timing_overflows;
    uint32_t command_completed_cycles;
    uint32_t command_wait_mean_cycles;
    uint32_t command_wait_max_cycles;
    uint32_t command_dispatch_mean_cycles;
    uint32_t command_dispatch_max_cycles;
    uint16_t timed_commands;
#endif
} bus_service_t;

void bus_service_init(bus_service_t *bus, device_t *device,
                      protocol_effect_handler_t effect_handler,
                      void *effect_context, uint8_t baud_index);
void bus_service_poll(bus_service_t *bus, uint32_t now_tick);
void bus_service_request_baud(bus_service_t *bus);

#endif
