#ifndef PROTOCOL_SERVICE_H
#define PROTOCOL_SERVICE_H

#include "device.h"
#include "protocol.h"
#include <stdatomic.h>

_Static_assert(ATOMIC_CHAR_LOCK_FREE == 2, "snapshot index must be lock-free");

typedef struct protocol_service protocol_service_t;
typedef void (*protocol_effect_handler_t)(const protocol_result_t *effect,
                                          void *context);
typedef void (*protocol_extension_handler_t)(const protocol_packet_t *packet,
                                             register_table_t *registers,
                                             protocol_result_t *result,
                                             void *context);

/* Serial service owns parser/result. Foreground owns live registers and the
 * inactive snapshot. command_pending transfers one effectful packet to main;
 * the parser remains held through effects, publication and response handoff. */
struct protocol_service {
    device_t *device;
    protocol_parser_t parser;
    register_table_t published[2];
    atomic_uchar published_index;
    bool command_pending;
    protocol_command_state_t command;
    protocol_result_t result;
    protocol_effect_handler_t effect_handler;
    void *effect_context;
    protocol_extension_handler_t extension_handler;
    void *extension_context;
    bool response_ready;
    bool transmit_busy;
};

void protocol_service_init(protocol_service_t *service,
                           device_t *device,
                           protocol_effect_handler_t effect_handler,
                           void *effect_context);
/* Foreground copies the inactive snapshot and atomically publishes its index.
 * Call after startup, a complete sensor/fault update, or command dispatch;
 * ordinary bus polling does not publish. Never call from a serial IRQ. */
void protocol_service_publish(protocol_service_t *service);
/* Effectful command stays pending until the caller publishes and releases it. */
void protocol_service_dispatch(protocol_service_t *service);
bool protocol_service_feed(protocol_service_t *service, uint8_t byte);
const uint8_t *protocol_service_response(protocol_service_t *service,
                                         uint8_t *length, uint8_t *delay_slot);
void protocol_service_transmit_complete(protocol_service_t *service);
void protocol_service_bind_extension(protocol_service_t *service,
                                     protocol_extension_handler_t handler,
                                     void *context);

#endif
