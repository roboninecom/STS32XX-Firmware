#include "protocol_service.h"

void protocol_service_init(protocol_service_t *service,
                           device_t *device,
                           protocol_effect_handler_t effect_handler,
                           void *effect_context)
{
    service->device = device;
    service->command_pending = false;
    atomic_init(&service->published_index, 0u);
    protocol_service_publish(service);
    protocol_parser_init(&service->parser);
    service->command.pending = false;
    service->command.count = 0;
    service->effect_handler = effect_handler;
    service->effect_context = effect_context;
    service->extension_handler = 0;
    service->extension_context = 0;
    service->response_ready = false;
    service->transmit_busy = false;
}

void protocol_service_bind_extension(protocol_service_t *service,
                                     protocol_extension_handler_t handler,
                                     void *context)
{
    service->extension_handler = handler;
    service->extension_context = context;
}

void protocol_service_publish(protocol_service_t *service)
{
    unsigned index = atomic_load_explicit(&service->published_index,
                                          memory_order_relaxed) ^ 1u;
    service->published[index] = service->device->registers;
    atomic_store_explicit(&service->published_index, (unsigned char)index,
                          memory_order_release);
}

bool protocol_service_feed(protocol_service_t *service, uint8_t byte)
{
    if (service->command_pending || service->response_ready ||
        service->transmit_busy) return false;
    /* ID writes only happen while command_pending holds the parser. */
    if (!protocol_feed(&service->parser, service->device->registers.byte[REG_ID], byte))
        return true;
    /* These instructions only read a published snapshot. All state changes,
     * including staged writes and their callbacks, belong to foreground. */
    uint8_t instruction = service->parser.packet.instruction;
    if (instruction == 1u || instruction == 2u || instruction == 0x82u) {
        const register_table_t *published = &service->published[
            atomic_load_explicit(&service->published_index, memory_order_acquire)];
        protocol_build_response(&service->parser.packet, published,
                                &service->result);
        service->response_ready = service->result.response_size != 0u;
    } else {
        service->command_pending = true;
    }
    return true;
}

void protocol_service_dispatch(protocol_service_t *service)
{
    if (!service->command_pending) return;
    register_table_t *registers = &service->device->registers;
    uint8_t instruction = service->parser.packet.instruction;
    if (instruction >= 0x90u && instruction <= 0x9Au) {
        service->result.response_size = 0;
        service->result.delay_slot = 0;
        if (service->extension_handler != 0)
            service->extension_handler(&service->parser.packet, registers,
                                       &service->result,
                                       service->extension_context);
        service->response_ready = service->result.response_size != 0u;
        return;
    }
    protocol_execute(&service->parser.packet, &service->command,
                     registers, &service->result);
    if (service->effect_handler != 0 &&
        service->result.effect != PROTOCOL_EFFECT_NONE) {
        service->effect_handler(&service->result, service->effect_context);
    }
    protocol_build_response(&service->parser.packet, registers,
                            &service->result);
    service->response_ready = service->result.response_size != 0;
}

const uint8_t *protocol_service_response(protocol_service_t *service,
                                         uint8_t *length, uint8_t *delay_slot)
{
    if (!service->response_ready || service->transmit_busy) return 0;
    service->response_ready = false;
    service->transmit_busy = true;
    *length = service->result.response_size;
    *delay_slot = service->result.delay_slot;
    return service->result.response;
}

void protocol_service_transmit_complete(protocol_service_t *service)
{
    service->transmit_busy = false;
}
