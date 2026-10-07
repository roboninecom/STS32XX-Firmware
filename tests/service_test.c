#include "protocol_service.h"
#include "fixtures/initial_wire.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static unsigned effects;
static void effect(const protocol_result_t *result,
                   void *context)
{
    device_t *device = context;
    assert(result->effect == PROTOCOL_EFFECT_WRITE);
    ++effects;
    device->registers.byte[65] = 0x04;
}

int main(void)
{
    register_table_t initial = {0};
    initial.byte[5] = 2;
    initial.byte[8] = 1;
    device_t device;
    device_init(&device, &initial);
    protocol_service_t service;
    protocol_service_init(&service, &device, effect, &device);
    for (unsigned i = 0; i < sizeof(ping_request); ++i) {
        assert(protocol_service_feed(&service, ping_request[i]));
    }
    uint8_t length, delay;
    const uint8_t *response = protocol_service_response(&service, &length, &delay);
    assert(response != NULL && length == sizeof(ping_response));
    assert(memcmp(response, ping_response, length) == 0);
    assert(!protocol_service_feed(&service, 0x00));
    protocol_service_transmit_complete(&service);

    const uint8_t write[] = {0xff,0xff,2,4,3,50,0x33,0x73};
    /* Last byte is the checksum for ID 2, LEN 4, WRITE 3, 50, 0x33. */
    uint8_t packet[sizeof(write)];
    memcpy(packet, write, sizeof(write));
    packet[sizeof(packet)-1] = (uint8_t)~(2u+4u+3u+50u+0x33u);
    for (unsigned i = 0; i < sizeof(packet); ++i) {
        assert(protocol_service_feed(&service, packet[i]));
    }
    assert(effects == 0 && service.command_pending);
    assert(!protocol_service_feed(&service, 0));
    protocol_service_dispatch(&service);
    assert(effects == 1 && device.registers.byte[50] == 0x33);
    response = protocol_service_response(&service, &length, &delay);
    assert(length == 6 && response[4] == 0x04);
    protocol_service_publish(&service);
    service.command_pending = false;
    protocol_service_transmit_complete(&service);

    /* A read during a foreground telemetry update sees the last complete
     * publication. The next publication exposes both new bytes together. */
    registers_set_u16(&device.registers, 56, 0x1234);
    protocol_service_publish(&service);
    device.registers.byte[56] = 0xab;
    uint8_t read[] = {255,255,2,4,2,56,2,(uint8_t)~(2u+4u+2u+56u+2u)};
    for (unsigned i = 0; i < sizeof(read); ++i)
        assert(protocol_service_feed(&service, read[i]));
    response = protocol_service_response(&service, &length, &delay);
    assert(length == 8 && response[5] == 0x34 && response[6] == 0x12);
    protocol_service_transmit_complete(&service);
    device.registers.byte[57] = 0xcd;
    protocol_service_publish(&service);
    for (unsigned i = 0; i < sizeof(read); ++i)
        assert(protocol_service_feed(&service, read[i]));
    response = protocol_service_response(&service, &length, &delay);
    assert(length == 8 && response[5] == 0xab && response[6] == 0xcd);
    assert(effects == 1);
    puts("Protocol deferred effects and coherent read publication: OK");
}
