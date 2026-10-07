#include "bus_service.h"
#include "bus_timing.h"
#ifdef FW_TIMING_PROBE
#include "diagnostics.h"
#endif

#include <stdint.h>

enum { RX_BYTES_PER_EVENT = 64u };

static void bus_service_event(void *context);

void bus_service_init(bus_service_t *bus, device_t *device,
                      protocol_effect_handler_t effect_handler,
                      void *effect_context, uint8_t baud_index)
{
    protocol_service_init(&bus->protocol, device, effect_handler, effect_context);
    uart_driver_init(&bus->uart, baud_index);
    bus->reply = 0;
    bus->reply_length = 0;
    bus->reply_slot = 0;
    bus->phase = BUS_RECEIVE;
    bus->phase_started_tick = 0;
    bus->last_poll_tick = 0;
    bus->response_timeouts = 0;
    bus->baud_pending = false;
    uart_driver_set_handler(&bus->uart, bus_service_event, bus);
#ifdef FW_TIMING_PROBE
    bus->timing_overflows = 0;
    bus->command_completed_cycles = 0;
    bus->command_wait_mean_cycles = 0;
    bus->command_wait_max_cycles = 0;
    bus->command_dispatch_mean_cycles = 0;
    bus->command_dispatch_max_cycles = 0;
    bus->timed_commands = 0;
#endif
}

void bus_service_request_baud(bus_service_t *bus)
{
    bus->baud_pending = true;
}

static void finish_transmission(bus_service_t *bus)
{
    if (bus->phase != BUS_TRANSMIT ||
        !uart_driver_transmit_done(&bus->uart)) return;
    protocol_service_transmit_complete(&bus->protocol);
    bus->reply = 0;
    bus->phase = BUS_RECEIVE;
    if (bus->baud_pending) {
        uart_driver_set_baud(&bus->uart, bus->protocol.device->registers.byte[REG_BAUD_RATE]);
        bus->baud_pending = false;
    }
}

static void send_ready_reply(bus_service_t *bus)
{
    if (bus->phase != BUS_WAIT_IDLE && bus->phase != BUS_WAIT_SLOT) return;
    if (bus->phase == BUS_WAIT_IDLE && !uart_driver_idle(&bus->uart)) return;
    if (bus->reply_slot != 0u && bus->phase == BUS_WAIT_IDLE) {
        uart_driver_delay(&bus->uart, bus->reply_slot,
                          bus->reply_length,
                          bus->protocol.device->registers.byte[REG_BAUD_RATE]);
        bus->phase = BUS_WAIT_SLOT;
    }
    if (!uart_driver_delay_done(&bus->uart)) return;
    uart_driver_transmit(&bus->uart, bus->reply, bus->reply_length);
    bus->phase = BUS_TRANSMIT;
}

static void take_ready_reply(bus_service_t *bus)
{
    if (!bus->protocol.response_ready) return;
    bus->reply = protocol_service_response(
        &bus->protocol, &bus->reply_length, &bus->reply_slot);
    bus->phase = BUS_WAIT_IDLE;
    bus->phase_started_tick = bus->last_poll_tick;
    send_ready_reply(bus);
}

/* Serial IRQs share one priority and cannot preempt each other. They own the
 * parser and response buffer. Foreground only executes the pending command;
 * command_pending holds the parser until effects and publication complete. */
static void bus_service_event(void *context)
{
    bus_service_t *bus = context;
    finish_transmission(bus);
    if (bus->phase != BUS_RECEIVE) {
        send_ready_reply(bus);
        return;
    }
    if (bus->protocol.command_pending || bus->protocol.transmit_busy) return;
    if (uart_driver_take_overflow(&bus->uart)) {
        protocol_parser_init(&bus->protocol.parser);
#ifdef FW_TIMING_PROBE
        if (bus->timing_overflows != 255u) ++bus->timing_overflows;
#endif
    }
    uint8_t byte;
    unsigned consumed = 0;
    while (consumed < RX_BYTES_PER_EVENT &&
           uart_driver_read(&bus->uart, &byte)) {
        ++consumed;
        (void)protocol_service_feed(&bus->protocol, byte);
        if (bus->protocol.command_pending) {
#ifdef FW_TIMING_PROBE
            bus->command_completed_cycles = diagnostics_probe_cycles();
#endif
            return;
        }
        if (bus->protocol.response_ready) {
            take_ready_reply(bus);
            return;
        }
    }
    if (consumed == RX_BYTES_PER_EVENT) uart_driver_poll(&bus->uart);
}

void bus_service_poll(bus_service_t *bus, uint32_t now_tick)
{
    uart_driver_lock();
    bus->last_poll_tick = now_tick;
    uint32_t elapsed = now_tick - bus->phase_started_tick;
    if (bus->phase != BUS_RECEIVE &&
        elapsed > 500u && elapsed >
            bus_response_timeout_ms(bus->reply_slot, bus->reply_length,
                                    bus->protocol.device->registers.byte[REG_BAUD_RATE])) {
        uart_driver_abort_transmission(&bus->uart);
        protocol_service_transmit_complete(&bus->protocol);
        protocol_parser_init(&bus->protocol.parser);
        bus->reply = 0;
        bus->phase = BUS_RECEIVE;
        if (bus->response_timeouts != UINT16_MAX) ++bus->response_timeouts;
    }
    bool pending = bus->protocol.command_pending;
    uart_driver_unlock();
    if (pending) {
#ifdef FW_TIMING_PROBE
        uint32_t dispatch_started = diagnostics_probe_cycles();
#endif
        protocol_service_dispatch(&bus->protocol);
#ifdef FW_TIMING_PROBE
        uint32_t dispatch_finished = diagnostics_probe_cycles();
        if (bus->timed_commands < 1024u) ++bus->timed_commands;
        diagnostics_record(&bus->command_wait_mean_cycles,
                      &bus->command_wait_max_cycles,
                      dispatch_started - bus->command_completed_cycles,
                      bus->timed_commands);
        diagnostics_record(&bus->command_dispatch_mean_cycles,
                      &bus->command_dispatch_max_cycles,
                      dispatch_finished - dispatch_started,
                      bus->timed_commands);
#endif
        protocol_service_publish(&bus->protocol);
        uart_driver_lock();
        bus->protocol.command_pending = false;
        take_ready_reply(bus);
        uart_driver_unlock();
    }
    uart_driver_lock();
    if (bus->baud_pending && bus->phase == BUS_RECEIVE &&
        uart_driver_idle(&bus->uart)) {
        uart_driver_set_baud(&bus->uart, bus->protocol.device->registers.byte[REG_BAUD_RATE]);
        bus->baud_pending = false;
    }
    /* RX work waits while a response or command owns the parser. Hardware
     * TX/slot IRQs resume it; do not repeatedly pend an IRQ that cannot drain. */
    if (bus->phase == BUS_RECEIVE && !bus->protocol.command_pending &&
        !bus->protocol.transmit_busy)
        uart_driver_poll(&bus->uart);
    uart_driver_unlock();
}
