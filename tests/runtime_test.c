#include "storage_adapter.h"
#include "app_runtime.h"
#include "command_service.h"
#include "board.h"
#include "storage_service.h"
#include "bridge_driver.h"
#include "bridge_output.h"
#include "control_adapter.h"
#include "arm_extension.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static char events[32];
static unsigned event_count;
static uint8_t incoming[128];
static unsigned incoming_length, incoming_cursor;
static bool tx_complete;
static bool delay_complete = true;
static unsigned baud_changes;
static uint8_t last_tx_id;
static bool led_on;
static bool restart_success = true;
void status_led_driver_set(bool on) { led_on = on; }
static bool bridge_accept = true;
bool bridge_driver_init(uint8_t configuration)
{ (void)configuration; return true; }
void bridge_driver_disarm(void) {}
bool bridge_driver_apply(bridge_request_t request, bool polarity,
                         int16_t *applied_effort)
{
    bridge_output_t output;
    *applied_effort = 0;
    if (!bridge_accept || !bridge_output_map_standard(request, polarity, &output))
        return false;
    *applied_effort = output.applied_effort;
    return true;
}

static void event(char code) { assert(event_count < sizeof(events)); events[event_count++] = code; }
void board_watchdog_feed(void) {}
void board_halt_safe(void) { assert(0 && "unexpected halt"); for (;;) {} }
void board_system_reset(void) { assert(0 && "unexpected reset"); for (;;) {} }
bool sensor_driver_init(sensor_driver_t *driver, bool complementary)
{
    (void)complementary;
    event('S');
    *driver = (sensor_driver_t){0};
    return true;
}
bool sensor_driver_restart(sensor_driver_t *driver, bool complementary)
{
    (void)complementary;
    event('S');
    uint32_t ticks = driver->ticks;
    *driver = (sensor_driver_t){0};
    driver->ticks = ticks;
    return restart_success;
}
uint32_t sensor_driver_ticks(const sensor_driver_t *driver) { return driver->ticks; }
void sensor_driver_stop(sensor_driver_t *driver) { driver->enabled = false; }
void sensor_driver_service(sensor_driver_t *driver) { (void)driver; }
bool sensor_driver_take_pair(sensor_driver_t *driver, sensor_pair_t *pair)
{
    if (!driver->ready) return false;
    *pair = driver->completed;
    driver->ready = false;
    return true;
}
bool storage_service_commit(const storage_mirror_t *mirror)
{
    (void)mirror;
    event('F');
    return true;
}
void uart_driver_init(uart_driver_t *driver, uint8_t baud)
{ (void)baud; *driver = (uart_driver_t){0}; }
static uart_service_handler_t serial_handler;
static void *serial_context;
static bool servicing;
void uart_driver_set_handler(uart_driver_t *driver, uart_service_handler_t handler,
                             void *context)
{ (void)driver; serial_handler = handler; serial_context = context; }
void uart_driver_lock(void) {}
void uart_driver_unlock(void) {}
void uart_driver_poll(uart_driver_t *driver)
{
    (void)driver;
    if (servicing) return;
    servicing = true;
    serial_handler(serial_context);
    servicing = false;
}
bool uart_driver_transmit_done(uart_driver_t *driver)
{
    if (!tx_complete) return false;
    tx_complete = false;
    driver->transmitting = false;
    event('C');
    return true;
}
bool uart_driver_take_overflow(uart_driver_t *driver) { (void)driver; return false; }
bool uart_driver_read(uart_driver_t *driver, uint8_t *byte)
{
    (void)driver;
    if (incoming_cursor == incoming_length) return false;
    *byte = incoming[incoming_cursor++];
    return true;
}
bool uart_driver_idle(const uart_driver_t *driver) { (void)driver; return true; }
void uart_driver_delay(uart_driver_t *driver, uint8_t slot, uint8_t length, uint8_t baud)
{
    (void)driver; (void)length; (void)baud;
    assert(slot == 1);
    event('D');
}
bool uart_driver_delay_done(uart_driver_t *driver)
{ (void)driver; return delay_complete; }
void uart_driver_transmit(uart_driver_t *driver, const uint8_t *bytes, uint8_t length)
{
    assert(length >= 6 && bytes[0] == 0xff && bytes[1] == 0xff);
    driver->transmitting = true;
    last_tx_id = bytes[2];
    event('T');
}
void uart_driver_abort_transmission(uart_driver_t *driver)
{ driver->transmitting = false; event('X'); }
void uart_driver_set_baud(uart_driver_t *driver, uint8_t baud)
{
    (void)driver;
    assert(baud == 1);
    ++baud_changes;
    event('B');
}

static void inject_write(uint8_t id, uint8_t address, uint8_t value)
{
    const uint8_t bytes[] = {0xff, 0xff, id, 4, 3, address, value,
        (uint8_t)~(id + 4u + 3u + address + value)};
    memcpy(incoming, bytes, sizeof(bytes));
    incoming_length = sizeof(bytes);
    incoming_cursor = 0;
    uart_driver_poll(NULL);
}

static void inject_sync_read(void)
{
    const uint8_t bytes[] = {0xff, 0xff, 0xfe, 6, 0x82, 56, 2, 1, 2,
        (uint8_t)~(0xfeu + 6u + 0x82u + 56u + 2u + 1u + 2u)};
    memcpy(incoming, bytes, sizeof(bytes));
    incoming_length = sizeof(bytes);
    incoming_cursor = 0;
    uart_driver_poll(NULL);
}

static void write_torque(app_state_t *state, uint8_t torque)
{
    state->device.registers.byte[REG_TORQUE_ENABLE] = torque;
    protocol_result_t write = {.effect=PROTOCOL_EFFECT_WRITE,
        .write={.start=REG_TORQUE_ENABLE,.accepted_count=1}};
    command_service_apply(&write,state);
}

static void select_extension(app_state_t *state, uint16_t session)
{
    protocol_packet_t packet={.id=2,.instruction=0x91,.param_count=4,
        .params={0xB8,1,(uint8_t)session,(uint8_t)(session>>8)}};
    protocol_result_t reply={0};
    arm_extension_process(&packet,&state->device.registers,&reply,state);
    assert(reply.response[5]==0 && state->arm_selected && !state->arm.armed);
    assert(state->arm_pending_session==session);
}

static void arm_extension_transaction_test(void)
{
    app_state_t arm_state = {0};
    registers_factory_defaults(&arm_state.device.registers);
    arm_state.device.registers.byte[5] = 2;
    registers_set_u16(&arm_state.device.registers, REG_MAX_ANGLE_LIMIT, 4095);
    arm_state.control_initialized = true;
    arm_state.sensors.ticks = 12;
    arm_state.last_good_tick = 12;
    arm_state.sensor_service.measurement.position = 100;
    arm_state.sensor_service.measurement.arm_position = 100;
    arm_control_init(&arm_state.arm, 100, 12);
    protocol_result_t reply = {0};
    protocol_packet_t packet = {.id=2, .instruction=0x91, .param_count=25};
    uint8_t config[24] = {0};
    config[0]=0;
    config[1]=1; /* Kp 256 */
    config[8]=0xbc; config[9]=2; /* effort 700 */
    config[10]=0x88; config[11]=0x13; /* velocity 5000 */
    config[12]=0x30; config[13]=0x75; /* acceleration 30000 */
    config[14]=64; config[15]=30;
    config[22]=0xe8;config[23]=3; /* gravity slew 1000 */
    /* Shared little-endian configuration vector in the host codec tests. */
    packet.params[0] = 0xA0;
    memcpy(packet.params+1, config, 24);
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    assert(reply.response_size == 7 && reply.response[5] == 0);
    arm_config_t accepted_config=arm_state.arm.config;
    for(unsigned count=27;count<=33;count+=6) { /* Old 26/32-byte configuration. */
        packet.param_count=(uint8_t)count;
        arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
        assert(reply.response[5]==1);
        assert(memcmp(&accepted_config,&arm_state.arm.config,sizeof accepted_config)==0);
    }
    packet.param_count=25;
    config[12]=0x31; /* 30001 is rejected without changing the RAM profile. */
    memcpy(packet.params+1, config, 24);
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    assert(reply.response[5] == 1 && arm_state.arm.config.acceleration_limit == 30000);
    config[12]=0x30;
    select_extension(&arm_state,7);
    arm_state.arm_feedback[12] = 1;
    write_torque(&arm_state,1);
    assert(arm_state.arm.armed && arm_state.arm.session==7);
    assert(!(arm_state.arm_feedback[12]&1u));
    arm_state.sensors.ticks = 13;
    arm_state.sensor_service.measurement.voltage = 60;
    arm_state.sensor_service.measurement.temperature = 20;
    arm_state.sensor_service.temperature_validated = 19;
    arm_state.sensor_service.temperature_valid = true;
    arm_state.sensor_service.temperature_spikes = 0x1234u;
    arm_state.sensor_service.temperature_candidate_count = 1u;
    packet.instruction = 0x91;
    app_runtime_service_control_pair(&arm_state, arm_state.sensors.ticks);
    assert(arm_state.arm.armed); /* Enabled control must survive a fresh pair. */
    arm_state.sensors.ticks = 14;
    assert(arm_control_gravity(&arm_state.arm, 7, 1, 10, 14));
    app_runtime_service_control_pair(&arm_state, 13);
    assert(arm_state.arm.last_tick == 14 && arm_state.arm.gravity_received);
    assert(arm_state.arm_sample_tick == 13 && arm_state.last_good_tick == 13);

    arm_state.sensors.ticks = 14;
    packet.param_count = 19;
    memset(packet.params, 0, 21);
    packet.params[0] = 0xE0;
    packet.params[1] = 7;
    packet.params[3] = 1;
    packet.params[5] = 100;
    int32_t target = 100*256;
    memcpy(packet.params+7, &target, 4);
    arm_control_t before_retired = arm_state.arm;
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    assert(reply.response[5] == 1 && arm_state.arm.accepted_sequence == 0);
    /* Retired segment and live-state selectors cannot mutate the controller. */
    assert(memcmp(&before_retired, &arm_state.arm, sizeof before_retired) == 0);
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    assert(reply.response[5] == 1);
    assert(memcmp(&before_retired, &arm_state.arm, sizeof before_retired) == 0);
    packet.instruction = 0x90;
    packet.param_count = 2;
    packet.params[0] = 0xB0;
    packet.params[1] = 8;
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    assert(reply.response[5] == 1 && reply.response_size == 7);
    assert(memcmp(&before_retired, &arm_state.arm, sizeof before_retired) == 0);
    packet.params[0] = 0x90;
    packet.params[1] = 8;
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    const uint8_t expected_caps[8] = {'A','R','M','C',9,0,0,1};
    assert(reply.response[5] == 0);
    assert(memcmp(reply.response+6, expected_caps, sizeof expected_caps) == 0);
    arm_state.device.registers.byte[40] = 1;
    packet.instruction = 0x92;
    packet.params[0] = 7;
    packet.params[1] = 0;
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    assert(reply.response[5] != 0 && !arm_state.arm.target_active);

    arm_control_disarm(&arm_state.arm);
    arm_state.device.registers.byte[40] = 0;
    select_extension(&arm_state,9);
    write_torque(&arm_state,1);
    assert(arm_state.arm.armed);
    packet.instruction = 0x91;
    packet.param_count = 13;
    packet.params[0] = 0xF0;
    memset(packet.params + 1, 0, 12);
    before_retired = arm_state.arm;
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    assert(reply.response[5] == 1); /* Retired staging selector. */
    assert(memcmp(&before_retired, &arm_state.arm, sizeof before_retired) == 0);
    arm_state.device.registers.byte[REG_ID] = 2;
    arm_state.device.registers.byte[40] = 1;
    arm_state.device.registers.byte[65] = 0;
    arm_state.output.phase = OUTPUT_READY;
    arm_state.arm_drive_enabled = true;
    arm_state.arm.last_tick = arm_state.last_good_tick = arm_state.sensors.ticks;
    packet.instruction = 0x9A;
    /* Shared Node/C vector: session9, ID2, seq1, q=-25, V1200. */
    const uint8_t target_bytes[11] = {9,0,2,1,0, 0,0xe7,0xff,0xff,
                                      0xb0,4};
    memcpy(packet.params, target_bytes, sizeof target_bytes);
    before_retired = arm_state.arm;
    /* Validate the entire group first, including entries after our own. */
    packet.param_count = 20;
    memcpy(packet.params + 11, target_bytes + 2, 9);
    for (unsigned invalid = 0; invalid < 3; ++invalid) {
        packet.params[11] = invalid == 0 ? 2 : invalid == 1 ? 254 : 3;
        packet.params[18] = invalid == 2 ? 0 : 0xb0;
        packet.params[19] = invalid == 2 ? 0 : 4;
        arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
        assert(reply.response[5] == 1);
        assert(memcmp(&before_retired, &arm_state.arm, sizeof before_retired) == 0);
    }
    packet.param_count = 10; /* Truncated entry. */
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    assert(reply.response[5] == 1);
    packet.param_count = 11;
    packet.params[2] = 3; /* Unlisted axis has no effect, including its session. */
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    assert(reply.response[5] == 0);
    assert(memcmp(&before_retired, &arm_state.arm, sizeof before_retired) == 0);
    packet.params[2] = 2;
    arm_state.last_good_tick -= 3;
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    assert(reply.response[5] == 2 && arm_state.arm.accepted_sequence == 0);
    arm_state.last_good_tick = arm_state.sensors.ticks;
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    assert(reply.response[5] == 0 && arm_state.arm.target_active);
    assert(arm_state.arm.accepted_sequence == 1);
    before_retired = arm_state.arm;
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    assert(reply.response[5] == 2); /* Duplicate sequence is not a new move. */
    assert(memcmp(&before_retired, &arm_state.arm, sizeof before_retired) == 0);

    /* Large numeric requests in any entry are valid. Only the addressed
     * servo clips to its own configuration; structural validation stays atomic. */
    app_state_t clipped = arm_state;
    arm_control_disarm(&clipped.arm);
    assert(arm_control_arm(&clipped.arm, 9, 0, clipped.sensors.ticks,0,4095));
    packet.param_count = 20;
    memcpy(packet.params, target_bytes, sizeof target_bytes);
    memcpy(packet.params + 11, target_bytes + 2, 9);
    packet.params[11] = 3;
    for (unsigned offset = 2; offset < 20; offset += 9) {
        memset(packet.params + offset + 3, 0xff, 6);
        packet.params[offset + 6] = 0x7f; /* INT32_MAX, V=UINT16_MAX. */
    }
    arm_extension_process(&packet, &clipped.device.registers, &reply, &clipped);
    assert(reply.response[5] == 0 && clipped.arm.accepted_sequence == 1);
    assert(clipped.arm.motion.goal == (int64_t)clipped.arm.upper_q8 * (1LL << 28));
    assert(clipped.arm.motion.speed_limit == clipped.arm.config.velocity_limit);
    assert(clipped.arm.motion.acceleration_limit == clipped.arm.config.acceleration_limit);

    /* All six entries fit one broadcast; seven and partial entries do not. */
    packet.param_count = 65;
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    assert(reply.response[5] == 1);
    assert(memcmp(&before_retired, &arm_state.arm, sizeof before_retired) == 0);
    packet.param_count = 56;
    for (unsigned i = 0; i < 6; ++i) {
        memcpy(packet.params + 2 + 9 * i, target_bytes + 2, 9);
        packet.params[2 + 9 * i] = (uint8_t)(i + 1);
        packet.params[3 + 9 * i] = 2;
    }
    packet.id = PROTOCOL_BROADCAST;
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    assert(reply.response_size == 0 && arm_state.arm.accepted_sequence == 2);
    assert(arm_state.arm.target_active);
    packet.id = 2;

    /* Removed keepalive and stop commands cannot change a powered session. */
    arm_state.arm.session=0x1234;
    arm_state.arm.accepted_sequence=0x2a;
    arm_state.output.phase=OUTPUT_READY;
    arm_state.arm_drive_enabled=true;
    arm_state.device.registers.byte[65]=0;
    arm_state.arm.last_tick=arm_state.last_good_tick=arm_state.sensors.ticks;
    before_retired=arm_state.arm;
    for (uint8_t instruction=0x93;instruction<=0x95;instruction++) {
        packet.instruction=instruction;packet.param_count=2;
        packet.params[0]=0x34;packet.params[1]=0x12;
        for (unsigned broadcast=0;broadcast<2;broadcast++) {
            packet.id=broadcast?PROTOCOL_BROADCAST:2;
            arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
            if (broadcast) assert(reply.response_size==0);
            else assert(reply.response[5]==5);
            assert(memcmp(&before_retired,&arm_state.arm,sizeof before_retired)==0);
            assert(arm_state.device.registers.byte[40]==1 && arm_state.arm_drive_enabled);
        }
    }
    packet.id=2;
    packet.instruction=0x96;packet.param_count=6;
    const uint8_t takeover_vector[6]={0x34,0x12,0x2a,0,0x35,0x12};
    memcpy(packet.params,takeover_vector,6);
    before_retired = arm_state.arm;
    for (unsigned probe = 0; probe < 3; ++probe) {
        packet.id = probe == 2 ? PROTOCOL_BROADCAST : 2;
        packet.param_count = probe == 1 ? 5 : 6;
        arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
        if (probe == 2) assert(reply.response_size == 0);
        else assert(reply.response[5] == 5); /* unsupported opcode */
        assert(memcmp(&before_retired, &arm_state.arm, sizeof before_retired) == 0);
        assert(arm_state.device.registers.byte[40] == 1 && arm_state.arm_drive_enabled);
    }
    /* New powered sessions now require the ordinary torque-off rearm path. */
    arm_state.device.registers.byte[40] = 0;
    arm_control_disarm(&arm_state.arm);
    assert(arm_control_arm(&arm_state.arm,0x1235,0,arm_state.sensors.ticks,0,4095));
    arm_state.device.registers.byte[40] = 1;
    packet.id = 2;
    /* Removed profile commands and reads never change a powered session. */
    before_retired=arm_state.arm;
    for (unsigned operation=0;operation<3;operation++) {
        packet.instruction=operation==2?0x90:(uint8_t)(0x97+operation);
        packet.param_count=operation==2?2:operation==0?17:7;
        memset(packet.params,0,sizeof packet.params);
        packet.params[0]=operation==2?0xA1:0x35;
        packet.params[1]=operation==2?32:0x12;
        for (unsigned broadcast=0;broadcast<2;broadcast++) {
            packet.id=broadcast?PROTOCOL_BROADCAST:2;
            arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
            if (broadcast) assert(reply.response_size==0);
            else assert(reply.response[5]==(operation==2?1:5));
            assert(memcmp(&before_retired,&arm_state.arm,sizeof before_retired)==0);
            assert(arm_state.device.registers.byte[40]==1 && arm_state.arm_drive_enabled);
        }
    }
    packet.id=2;

    /* Gravity has its own sequence and no expiry field. */
    packet.instruction=0x99;packet.param_count=6;
    const uint8_t ff_vector[6]={0x35,0x12,1,0,0xba,0xff};
    memcpy(packet.params,ff_vector,6);
    arm_state.arm.last_feedforward=0;
    for(unsigned count=8;count<=10;count+=2) { /* Old slew/TTL packets. */
        packet.param_count=(uint8_t)count;
        arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
        assert(reply.response[5]==1 && !arm_state.arm.gravity_received);
    }
    packet.param_count=6;packet.id=PROTOCOL_BROADCAST;
    arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
    assert(!arm_state.arm.gravity_received);
    packet.id=2;arm_state.device.registers.byte[65]=4;
    arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
    assert(reply.response[5]==2 && !arm_state.arm.gravity_received);
    arm_state.device.registers.byte[65]=0;
    arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
    assert(reply.response[5]==0 && arm_state.arm.gravity_target==-70);
    assert(arm_state.arm.gravity_sequence==1 && arm_state.arm.accepted_sequence==0);
    arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
    assert(reply.response[5]==2); /* replay */
    packet.instruction=0x90;packet.param_count=2;packet.params[0]=0xA2;packet.params[1]=20;
    arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
    assert(reply.response[5]==1); /* Retired overlapping FF telemetry. */

    /* The wire decoder accepts zero on wrap and forward gaps for both streams. */
    const uint16_t sequence[]={5,32770,65535,0,1};
    for(unsigned i=0;i<sizeof sequence/sizeof sequence[0];i++) {
        packet.instruction=0x9A;packet.param_count=11;
        const uint8_t target[11]={0x35,0x12,2,0,0,0,0,0,0,0xb0,4};
        memcpy(packet.params,target,sizeof target);
        packet.params[3]=(uint8_t)sequence[i];packet.params[4]=(uint8_t)(sequence[i]>>8);
        arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
        assert(reply.response[5]==0 && arm_state.arm.accepted_sequence==sequence[i]);
        packet.instruction=0x99;packet.param_count=6;
        memcpy(packet.params,ff_vector,sizeof ff_vector);
        packet.params[2]=(uint8_t)sequence[i];packet.params[3]=(uint8_t)(sequence[i]>>8);
        arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
        assert(reply.response[5]==0 && arm_state.arm.gravity_sequence==sequence[i]);
    }
    /* Torque-off is the sole shutdown command and preserves mode selection. */
    arm_state.device.registers.byte[40]=0;
    protocol_result_t torque_off={.effect=PROTOCOL_EFFECT_WRITE,
        .write={.start=40,.accepted_count=1}};
    command_service_apply(&torque_off,&arm_state);
    assert(arm_state.arm_selected && !arm_state.arm.armed && !arm_state.arm.session);
    assert(!arm_state.arm.gravity_received && arm_state.arm.gravity_effort_q16==0);
    assert(arm_state.output.phase!=OUTPUT_READY);
    arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
    assert(reply.response[5]==2); /* No old-session gravity after shutdown. */
    select_extension(&arm_state,0x1236);
    assert(arm_state.device.registers.byte[40]==0); /* Setup never enables torque. */
    write_torque(&arm_state,1);
    assert(arm_state.arm.session==0x1236);


}

static void snapshot_publication_test(void)
{
    app_state_t sample = {0};
    registers_factory_defaults(&sample.device.registers);
    bus_service_init(&sample.bus, &sample.device, command_service_apply, &sample, 0);
    sample.sensor_active = true;
    unsigned index = atomic_load(&sample.bus.protocol.published_index);
    app_runtime_service_sensors(&sample);
    assert(atomic_load(&sample.bus.protocol.published_index) == index);

    /* A stale-sample fault is a publication event even without a new pair. */
    sample.control_initialized = true;
    sample.sensors.ticks = 3;
    app_runtime_service_sensors(&sample);
    unsigned fault_index = atomic_load(&sample.bus.protocol.published_index);
    assert(fault_index != index);
    assert(sample.bus.protocol.published[fault_index].byte[REG_SERVO_STATUS] & 2u);
    app_runtime_service_sensors(&sample);
    assert(atomic_load(&sample.bus.protocol.published_index) == fault_index);
}

static void acquisition_deadline_test(void)
{
    app_state_t sample = {0};
    registers_factory_defaults(&sample.device.registers);
    sample.device.registers.byte[REG_CONFIGURATION_FLAGS] = 0x5c;
    bus_service_init(&sample.bus, &sample.device, command_service_apply, &sample, 0);
    sensor_service_init(&sample.sensor_service);
    sample.sensor_active = true;
    sample.sensors.in_flight = true;
    sample.bus.protocol.parser.packet = (protocol_packet_t){
        .id=PROTOCOL_BROADCAST, .instruction=3, .param_count=2, .params={50, 7}};
    sample.bus.protocol.command_pending = true;
    sample.sensors.ticks = 1;
    app_runtime_poll(&sample);
    assert(!sample.bus.protocol.command_pending && sample.device.registers.byte[50] == 7);
    assert(sample.sensor_service.completed_pairs == 0);

    sample.sensors.completed = (sensor_pair_t){.tick_ms=1, .valid=true,
        .encoder_raw=1800, .adc_raw={0x250u << 2, 400, 1600}};
    sample.sensors.ready = true;
    sample.sensors.ticks = 2;
    app_runtime_service_sensors(&sample);
    assert(sample.sensor_service.completed_pairs == 1);
    assert(sample.last_good_tick == 1 && sample.sensor_service.measurement.position == 1800);

    /* A recent DMA completion cannot make a genuinely old sample fresh. */
    sample.sensors.completed.tick_ms = 1;
    sample.sensors.ready = true;
    sample.sensors.ticks = 4;
    sample.output.phase = OUTPUT_READY;
    app_runtime_service_sensors(&sample);
    assert(sample.sensor_service.completed_pairs == 1);
    assert(sample.last_good_tick == 1 && sample.stale_reported);
    assert(sample.output.phase == OUTPUT_REQUALIFYING);
    assert(sample.device.registers.byte[REG_SERVO_STATUS] & 2u);

    sample.sensors.completed.tick_ms = 4;
    sample.sensors.completed.valid = false;
    sample.sensors.ready = true;
    sample.output.phase = OUTPUT_READY;
    app_runtime_service_sensors(&sample);
    assert(sample.output.phase == OUTPUT_REQUALIFYING);
}

static uint16_t wire_u16(const uint8_t *p)
{
    return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
}

static protocol_result_t read_arm(app_state_t *state, uint8_t address, uint8_t count)
{
    protocol_packet_t packet={.id=2,.instruction=0x90,.param_count=2};
    packet.params[0]=address;packet.params[1]=count;
    protocol_result_t reply={0};
    arm_extension_process(&packet,&state->device.registers,&reply,state);
    return reply;
}

static void sensor_only_feedback_test(void)
{
    app_state_t state={0};
    registers_factory_defaults(&state.device.registers);
    state.sensor_service.measurement=(sensor_measurement_t){
        .position=100,.arm_position=100,.voltage=120,.temperature=30,.current=12};
    state.sensor_service.temperature_valid=true;
    state.sensor_service.temperature_validated=29;
    state.sensor_service.temperature_candidate_count=1;
    for(unsigned selected=0;selected<2;selected++) {
        state.arm_selected=selected;
        state.sensors.ticks=selected+1;
        app_runtime_service_control_pair(&state, state.sensors.ticks);
        protocol_result_t reply=read_arm(&state,0xC2,ARM_TUNING_BYTES);
        const uint8_t *data=reply.response+6;
        assert(reply.response[5]==0 && !(data[12]&1u));
        assert(wire_u16(data+12)&(1u<<10));
        assert(!(wire_u16(data+12)&((1u<<2)|(1u<<11))));
        assert(data[27]==29 && data[26]==120 && wire_u16(data+24)==12);
        assert(wire_u16(data+30)==0 && data[15]==100);
        for(unsigned i=32;i<ARM_TUNING_BYTES;i++) assert(data[i]==0);
    }
    state.sensors.ticks+=3;
    protocol_result_t stale=read_arm(&state,0xC1,ARM_FEEDBACK_BYTES);
    assert(wire_u16(stale.response+6+30)==3);
}

static void coherent_feedback_test(const app_state_t *source, int direction)
{
    app_state_t state=*source;
    protocol_result_t normal=read_arm(&state,0xC1,ARM_FEEDBACK_BYTES);
    protocol_result_t detail=read_arm(&state,0xC2,ARM_TUNING_BYTES);
    assert(normal.response_size==39 && detail.response_size==61);
    assert(normal.response[5]==0 && detail.response[5]==0);
    assert(memcmp(normal.response+6,detail.response+6,ARM_FEEDBACK_BYTES)==0);
    const uint8_t *payload=detail.response+6;
    assert(payload[29]==0 && !(wire_u16(payload+12)&0x0240));
    assert(wire_u16(payload+52)==state.arm.overrun_count);
    protocol_result_t obsolete=read_arm(&state,0xC2,56);
    assert(obsolete.response[5]==1 && obsolete.response_size==7);
    assert(payload[0]==1 && wire_u16(payload+4)==1);
    assert(wire_u16(payload+6)==1 && wire_u16(payload+8)==0);
    assert(wire_u16(payload+12)&1u);
    assert(payload[14]==0 && payload[15]==100); /* Position 100 in Q8. */
    assert(wire_u16(payload+22)==(uint16_t)(direction*970));
    assert(wire_u16(payload+40)==(uint16_t)(direction*1000));
    assert(wire_u16(payload+30)==0 && (payload[12]&8u));
    /* Live sensor/controller changes cannot mix into an already frozen sample. */
    state.sensor_service.measurement.current=123;
    state.sensor_service.temperature_validated=99;
    state.arm_result.p_term=99;
    state.arm_result.advanced=false;
    arm_extension_publish_sample(&state);
    protocol_result_t again=read_arm(&state,0xC2,ARM_TUNING_BYTES);
    assert(memcmp(detail.response,again.response,detail.response_size)==0);
    state.sensors.ticks=3;
    again=read_arm(&state,0xC1,ARM_FEEDBACK_BYTES);
    assert(wire_u16(again.response+6+30)==2 && (again.response[6+12]&1u));
    state.sensors.ticks=4;
    again=read_arm(&state,0xC1,ARM_FEEDBACK_BYTES);
    assert(wire_u16(again.response+6+30)==3 && !(again.response[6+12]&1u));
    state.sensors.ticks=100000;
    again=read_arm(&state,0xC1,ARM_FEEDBACK_BYTES);
    assert(wire_u16(again.response+6+30)==UINT16_MAX);
    state.sensors.ticks=1;
    state.arm.gravity_sequence++;
    again=read_arm(&state,0xC1,ARM_FEEDBACK_BYTES);
    assert(!(again.response[6+12]&1u)); /* Await the applied gravity sample. */
    state.arm.gravity_sequence--;
    state.arm.accepted_sequence++;
    again=read_arm(&state,0xC1,ARM_FEEDBACK_BYTES);
    assert(!(again.response[6+12]&1u));
    state.arm.accepted_sequence--;
    state.arm.session++;
    again=read_arm(&state,0xC1,ARM_FEEDBACK_BYTES);
    assert(!(again.response[6+12]&1u));
    state.arm.session--;
    output_safety_fail(&state.output);
    again=read_arm(&state,0xC1,ARM_FEEDBACK_BYTES);
    assert(!(again.response[6+12]&1u));
    state.output=source->output;
    state.arm_result=source->arm_result;
    state.arm_sample_tick=UINT32_MAX-1;
    arm_extension_publish_sample(&state);
    state.sensors.ticks=0;
    again=read_arm(&state,0xC1,ARM_FEEDBACK_BYTES);
    assert(wire_u16(again.response+6+30)==2 && (again.response[6+12]&1u));
    const uint8_t retired[][2]={{0xC0,30},{0xD0,6},{0xDC,18},{0xA2,20}};
    for(unsigned i=0;i<sizeof retired/sizeof retired[0];i++)
        assert(read_arm(&state,retired[i][0],retired[i][1]).response[5]==1);
    assert(read_arm(&state,0xC1,ARM_FEEDBACK_BYTES-1).response[5]==1);
}

static void consolidated_configuration_test(void)
{
    app_state_t state={0};
    registers_factory_defaults(&state.device.registers);
    arm_control_init(&state.arm,100,0);
    protocol_packet_t packet={.id=2,.instruction=0x91,.param_count=25,.params={0xA0}};
    uint8_t *config=packet.params+1;
    config[8]=0x2c;config[9]=1; /* effort 300 */
    config[10]=config[12]=config[22]=0xe8;
    config[11]=config[13]=config[23]=3; /* speed, acceleration, slew 1000 */
    config[14]=64;config[15]=30;
    config[17]=1;config[19]=2;config[20]=120; /* directional FF */
    protocol_result_t reply={0};
    state.device.registers.byte[40]=1;
    arm_extension_process(&packet,&state.device.registers,&reply,&state);
    assert(reply.response[5]==2 && !state.arm.config.effort_limit);
    state.device.registers.byte[40]=0;
    arm_extension_process(&packet,&state.device.registers,&reply,&state);
    assert(reply.response[5]==0);
    reply=read_arm(&state,0xA0,24);
    assert(memcmp(reply.response+6,config,24)==0);
    arm_config_t accepted=state.arm.config;
    const unsigned offsets[]={20,22};
    for(unsigned i=0;i<2;i++) {
        unsigned offset=offsets[i];uint8_t low=config[offset],high=config[offset+1];
        config[offset]=config[offset+1]=0; /* noncanonical FF or zero slew */
        arm_extension_process(&packet,&state.device.registers,&reply,&state);
        assert(reply.response[5]==1);
        assert(memcmp(&accepted,&state.arm.config,sizeof accepted)==0);
        config[offset]=low;config[offset+1]=high;
    }
    assert(arm_control_arm(&state.arm,1,100,0,0,4095));
    arm_extension_process(&packet,&state.device.registers,&reply,&state);
    assert(reply.response[5]==1 && state.arm.armed);
    packet.params[0]=0xA3;packet.param_count=7;
    arm_extension_process(&packet,&state.device.registers,&reply,&state);
    assert(reply.response[5]==1);
    assert(read_arm(&state,0xA3,6).response[5]==1);
    assert(read_arm(&state,0x90,16).response[5]==1);
    reply=read_arm(&state,0x90,8);
    assert(reply.response[10]==9 && reply.response[11]==0);
}

static void saved_limits_define_extension_envelope(void)
{
    app_state_t initial={0};
    registers_factory_defaults(&initial.device.registers);
    register_table_t *registers=&initial.device.registers;
    registers->byte[REG_ID]=2;
    registers_set_u16(registers,REG_MIN_ANGLE_LIMIT,500);
    registers_set_u16(registers,REG_MAX_ANGLE_LIMIT,3500);
    initial.control_initialized=true;
    initial.arm_selected=true;
    initial.sensors.ticks=initial.last_good_tick=5;
    initial.sensor_service.measurement.arm_position=1000;
    arm_control_init(&initial.arm,1000,5);
    assert(arm_control_configure(&initial.arm,(arm_config_t){
        .effort_limit=300,.velocity_limit=1000,.acceleration_limit=1000,
        .gravity_slew=1000,.velocity_filter_q8=64,.ramp_time_ms=30}));
    select_extension(&initial,7);
    write_torque(&initial,1);
    protocol_packet_t packet={0};
    protocol_result_t reply={0};
    assert(initial.arm.armed && initial.arm.lower_q8==500*256 && initial.arm.upper_q8==3500*256);
    assert(initial.arm.last_reference_position_q8==1000*256);
    registers->byte[REG_TORQUE_ENABLE]=1;
    initial.arm_drive_enabled=true;
    initial.output.phase=OUTPUT_READY;
    /* Both out-of-range targets are capped, using bounds read from the legacy table. */
    for(unsigned high=0;high<2;high++) {
        app_state_t state=initial;
        packet=(protocol_packet_t){.id=2,.instruction=0x9A,.param_count=11,
            .params={7,0,2,1,0,0,0,0,0,0xe8,3}};
        packet.params[8]=high?0x7f:0x80;
        arm_extension_process(&packet,&state.device.registers,&reply,&state);
        assert(reply.response[5]==0);
        assert(state.arm.motion.goal==(int64_t)(high?3500:500)*(1LL<<36));
    }
    /* Each accepted byte of either legacy limit invalidates a cached envelope,
     * including RAM-only writes where there is no storage commit to end control. */
    for(unsigned address=9;address<=12;address++) {
        app_state_t state=initial;
        state.device.registers.byte[address]^=1;
        protocol_result_t changed={.effect=PROTOCOL_EFFECT_WRITE,
            .write={.start=(uint8_t)address,.accepted_count=1}};
        command_service_apply(&changed,&state);
        assert(!state.arm.armed && state.arm.session==0);
        assert(state.device.registers.byte[REG_TORQUE_ENABLE]==0);
        assert(state.output.phase!=OUTPUT_READY);
    }
    /* Enable reads the latest values, after both configuration and setup. */
    app_state_t state=initial;
    write_torque(&state,0);
    select_extension(&state,8);
    registers_set_u16(&state.device.registers,REG_MIN_ANGLE_LIMIT,1200);
    write_torque(&state,1);
    assert(!state.arm.armed && state.device.registers.byte[40]==0);
    assert(state.arm_pending_session==0); /* Failed starts consume setup. */
    registers_set_u16(&state.device.registers,REG_MIN_ANGLE_LIMIT,800);
    write_torque(&state,1);
    assert(!state.arm.armed && state.device.registers.byte[40]==0);
    select_extension(&state,9);
    write_torque(&state,1);
    assert(state.arm.armed && state.arm.lower_q8==800*256);

}

static void torque_enable_starts_extension_session(void)
{
    app_state_t initial={0};
    registers_factory_defaults(&initial.device.registers);
    initial.device.registers.byte[REG_ID]=2;
    registers_set_u16(&initial.device.registers,REG_MIN_ANGLE_LIMIT,500);
    registers_set_u16(&initial.device.registers,REG_MAX_ANGLE_LIMIT,3500);
    initial.control_initialized=true;
    initial.sensors.ticks=initial.last_good_tick=5;
    initial.sensor_service.measurement.arm_position=1000;
    initial.sensor_service.measurement.voltage=60;
    initial.sensor_service.measurement.temperature=20;
    arm_control_init(&initial.arm,1000,5);
    assert(arm_control_configure(&initial.arm,(arm_config_t){
        .kp_q8=256,.effort_limit=300,.velocity_limit=1000,.acceleration_limit=1000,
        .gravity_slew=1000,.velocity_filter_q8=64,.ramp_time_ms=30}));
    select_extension(&initial,7);
    assert(initial.device.registers.byte[40]==0 && initial.arm.session==0);
    assert(!arm_control_target(&initial.arm,7,(arm_target_t){.sequence=1,.position_q8=1200*256,.speed_limit=1000}));
    assert(!arm_control_gravity(&initial.arm,7,1,20,5));

    /* Retired ARM, old selection layout and malformed setup are atomic failures. */
    const protocol_packet_t bad[]={
        {.id=2,.instruction=0x91,.param_count=3,.params={0xBA,7,0}},
        {.id=2,.instruction=0x91,.param_count=2,.params={0xB8,1}},
        {.id=2,.instruction=0x91,.param_count=4,.params={0xB8,1,0,0}},
        {.id=2,.instruction=0x91,.param_count=4,.params={0xB8,0,7,0}},
        {.id=2,.instruction=0x91,.param_count=4,.params={0xB8,2,7,0}},
        {.id=2,.instruction=0x91,.param_count=5,.params={0xB8,1,7,0,0}},
    };
    for(unsigned i=0;i<sizeof bad/sizeof bad[0];i++) {
        app_state_t state=initial;
        protocol_result_t reply={0};
        arm_extension_process(&bad[i],&state.device.registers,&reply,&state);
        assert(reply.response[5]==1);
        assert(state.arm_pending_session==7 && state.arm_selected && !state.arm.armed);
    }

    /* All start gates are checked at torque enable, after successful setup. */
    for(unsigned failure=0;failure<9;failure++) {
        app_state_t state=initial;
        switch(failure) {
        case 0: state.control_initialized=false; break;
        case 1: state.sensors.ticks+=3; break;
        case 2:
            state.device.registers.byte[REG_PROTECTION_SHUTDOWN_MASK]=4;
            state.device.registers.byte[REG_SERVO_STATUS]=4; break;
        case 3: state.arm.config.effort_limit=0; break;
        case 4: state.sensor_service.measurement.arm_position=499; break;
        case 5: registers_set_u16(&state.device.registers,REG_MIN_ANGLE_LIMIT,3600); break;
        case 6: state.arm_pending_session=0; break;
        case 7: state.output.phase=OUTPUT_FAILED; break;
        case 8: state.output.phase=OUTPUT_MAINTENANCE; break;
        }
        write_torque(&state,1);
        assert(state.device.registers.byte[40]==0 && !state.arm.armed);
        assert(state.arm_pending_session==0 && state.output.phase!=OUTPUT_READY);
        state.control_initialized=true;state.sensors.ticks=state.last_good_tick;
        state.output.phase=OUTPUT_REQUALIFYING;
        state.device.registers.byte[REG_SERVO_STATUS]=0;
        state.arm.config=initial.arm.config;
        state.sensor_service.measurement.arm_position=1000;
        registers_set_u16(&state.device.registers,REG_MIN_ANGLE_LIMIT,500);
        write_torque(&state,1);
        assert(state.device.registers.byte[40]==0 && !state.arm.armed);
        select_extension(&state,8);
        write_torque(&state,1);
        assert(state.arm.armed && state.arm.session==8);
    }

    app_state_t state=initial;
    state.sensor_service.measurement.arm_position=1100; /* Moved after setup. */
    write_torque(&state,1);
    assert(state.arm.last_reference_position_q8==1100*256);
    assert(state.arm_pending_session==0 && state.device.registers.byte[40]==1);
    assert(arm_control_target(&state.arm,7,(arm_target_t){.sequence=1,.position_q8=1500*256,.speed_limit=1000}));
    assert(arm_control_gravity(&state.arm,7,1,20,5));
    (void)arm_control_step(&state.arm,1100,6,true,false);
    state.output.phase=OUTPUT_READY;
    arm_control_t moving=state.arm;
    write_torque(&state,1);
    assert(memcmp(&moving,&state.arm,sizeof moving)==0);
    assert(state.output.phase==OUTPUT_READY); /* No bridge interruption either. */
    protocol_packet_t setup={.id=2,.instruction=0x91,.param_count=4,.params={0xB8,1,8,0}};
    protocol_result_t reply={0};
    arm_extension_process(&setup,&state.device.registers,&reply,&state);
    assert(reply.response[5]==2 && state.arm.session==7); /* Setup requires off. */

    /* Torque-off clears running control and unused setup alike. */
    write_torque(&state,0);
    assert(!state.arm.armed && !state.arm.session && !state.arm.gravity_received);
    write_torque(&state,1);
    assert(!state.arm.armed && state.device.registers.byte[40]==0);
    select_extension(&state,8);
    write_torque(&state,0);
    assert(state.arm_pending_session==0);
    write_torque(&state,1);
    assert(!state.arm.armed && state.device.registers.byte[40]==0);

    /* A protection shutdown cannot resume with torque enable alone. */
    state=initial;
    write_torque(&state,1);
    state.sensors.ticks=6;
    state.device.registers.byte[REG_PROTECTION_SHUTDOWN_MASK]=1;
    state.sensor_service.measurement.voltage=0;
    app_runtime_service_control_pair(&state,6);
    assert(!state.arm.armed && state.device.registers.byte[40]==0);
    state.device.registers.byte[REG_SERVO_STATUS]=0;
    state.sensor_service.measurement.voltage=60;
    write_torque(&state,1);
    assert(!state.arm.armed && state.device.registers.byte[40]==0);
    select_extension(&state,8);
    write_torque(&state,1);
    assert(state.arm.armed && state.arm.session==8 && state.arm.accepted_sequence==0);
    assert(!arm_control_target(&state.arm,7,(arm_target_t){.sequence=2,.position_q8=1500*256,.speed_limit=1000}));
    assert(!arm_control_gravity(&state.arm,7,2,20,6));

    /* Sensor failure also consumes a prepared, not-yet-started session. */
    state=initial;state.sensor_active=true;state.sensors.ticks=8;
    bus_service_init(&state.bus,&state.device,command_service_apply,&state,0);
    app_runtime_service_sensors(&state);
    assert(!state.arm_pending_session && state.device.registers.byte[40]==0);
    state.device.registers.byte[REG_SERVO_STATUS]=0;state.last_good_tick=8;
    write_torque(&state,1);
    assert(!state.arm.armed && state.device.registers.byte[40]==0);

    /* Returning to legacy cancels setup and preserves ordinary torque enable. */
    state=initial;setup.params[1]=setup.params[2]=setup.params[3]=0;
    arm_extension_process(&setup,&state.device.registers,&reply,&state);
    assert(reply.response[5]==0 && !state.arm_selected && !state.arm_pending_session);
    write_torque(&state,1);
    assert(state.device.registers.byte[40]==1 && !state.arm.armed);
}

static void final_effort_feedback_test(void)
{
    for (unsigned polarity = 0; polarity < 2; ++polarity) {
        for (int direction = -1; direction <= 1; direction += 2) {
            app_state_t sample = {0};
            registers_factory_defaults(&sample.device.registers);
            sample.device.registers.byte[REG_CONFIGURATION_FLAGS] = (uint8_t)polarity;
            sample.device.registers.byte[REG_TORQUE_ENABLE] = 1;
            registers_set_u16(&sample.device.registers, REG_TORQUE_LIMIT, 1000);
            sample.bridge_config = (uint8_t)polarity;
            sample.control_initialized = true;
            sample.arm_selected = true;
            sample.output.phase = OUTPUT_READY;
            sample.control.bridge = (bridge_policy_t){
                .initialized = true, .previous_torque = 1, .previous_permit = true};
            sample.sensor_service.measurement = (sensor_measurement_t){
                .position = 100, .arm_position = 100, .voltage = 120, .temperature = 30};
            arm_control_init(&sample.arm, 100, 0);
            arm_config_t config = {
                .kp_q8 = 2560, .ki_q8 = 256, .integral_limit = 500,
                .effort_limit = 1000, .velocity_limit = 1000,
                .acceleration_limit = 1000, .gravity_slew = 10000, .velocity_filter_q8 = 64, .ramp_time_ms=30,
                 };
            assert(arm_control_configure(&sample.arm, config));
            assert(arm_control_arm(&sample.arm, 1, 100, 0,0,4095));
            assert(arm_control_gravity(&sample.arm,1,1,(int16_t)(direction*50),0));
            arm_motion_init(&sample.arm.motion, (100 + direction * 100) * 256);
            sample.sensors.ticks = 1;
            app_runtime_service_control_pair(&sample, sample.sensors.ticks);
            assert(sample.arm_result.requested_effort == direction * 1000);
            assert(sample.arm_applied_effort == direction * 970);
            assert(sample.arm_result.saturated);
            assert(sample.arm_drive_enabled);
            assert(sample.arm.integral_effort_q16_ms == 0);

            coherent_feedback_test(&sample,direction);
            bridge_accept = false;
            sample.sensors.ticks = 2;
            app_runtime_service_control_pair(&sample, sample.sensors.ticks);
            assert(sample.arm_applied_effort == 0 && !sample.arm_drive_enabled);
            assert(!sample.arm.armed && sample.arm.integral_effort_q16_ms == 0);
            protocol_result_t stopped=read_arm(&sample,0xC2,ARM_TUNING_BYTES);
            assert(!(stopped.response[6+12]&1u));
            assert(wire_u16(stopped.response+6+22)==0);
            assert(wire_u16(stopped.response+6+48)==(uint16_t)(direction*20));
            assert(wire_u16(stopped.response+6+10)==1);
            assert(wire_u16(stopped.response+6+6)==1);
            bridge_accept = true;
        }
    }
}

int main(void)
{
    sensor_only_feedback_test();
    consolidated_configuration_test();
    saved_limits_define_extension_envelope();
    torque_enable_starts_extension_session();
    snapshot_publication_test();
    acquisition_deadline_test();
    final_effort_feedback_test();
    arm_extension_transaction_test();
    register_write_result_t accepted = {.start = 34, .accepted_count = 6};
    assert(!registers_write_touches(&accepted, 33, 33));
    assert(!registers_write_touches(&accepted, 40, 49));
    accepted.start = 39;
    accepted.accepted_count = 2;
    assert(registers_write_touches(&accepted, 40, 49));
    accepted.start = 30;
    accepted.accepted_count = 3;
    assert(registers_write_touches(&accepted, 31, 32));
    accepted.accepted_count = 0;
    assert(!registers_write_touches(&accepted, 31, 32));

    app_state_t state = {0};
    register_table_t initial = {0};
    registers_factory_defaults(&initial);
    initial.byte[5] = 2;
    initial.byte[8] = 1;
    initial.byte[55] = 0;
    state.storage_source = STORAGE_SOURCE_PRIMARY;
    storage_copy_registers_to_mirror(&state.storage_mirror, &initial, false);
    device_init(&state.device, &initial);
    bus_service_init(&state.bus, &state.device, command_service_apply, &state, 0);
    state.sensor_active = true;
    state.control_initialized = true;
    state.sensors.ticks = 12;
    state.sensor_service.runtime_calibration_offset = 5503;
    state.sensor_service.runtime_calibration_offset_valid = true;

    inject_write(2, 21, 33);
    bus_service_poll(&state.bus, state.sensors.ticks);
    assert(event_count == 3 && memcmp(events, "FST", 3) == 0);
    assert(state.device.registers.byte[21] == 33);
    assert(state.storage_mirror.byte[21] == 33);
    assert(state.sensors.ticks == 12 && !state.control_initialized);
    assert(state.sensor_service.runtime_calibration_offset_valid &&
           state.sensor_service.runtime_calibration_offset == 5503);
    state.sensor_service.runtime_calibration_offset_valid = false;
    assert(state.bus.protocol.transmit_busy);
    tx_complete = true;
    uart_driver_poll(NULL); /* Deliver the hardware TX-complete IRQ. */
    bus_service_poll(&state.bus, state.sensors.ticks);
    assert(!state.bus.protocol.transmit_busy && events[3] == 'C');

    event_count = 0;
    inject_write(2, 6, 1);
    bus_service_poll(&state.bus, state.sensors.ticks);
    assert(event_count == 3 && memcmp(events, "FST", 3) == 0);
    assert(baud_changes == 0 && state.bus.baud_pending);
    tx_complete = true;
    uart_driver_poll(NULL); /* Deliver the hardware TX-complete IRQ. */
    bus_service_poll(&state.bus, state.sensors.ticks);
    assert(event_count == 5 && memcmp(events, "FSTCB", 5) == 0);
    assert(baud_changes == 1 && !state.bus.baud_pending);

    event_count = 0;
    inject_write(2, 21, 33); /* Identical EEPROM write has no flash transaction. */
    bus_service_poll(&state.bus, state.sensors.ticks);
    assert(event_count == 1 && events[0] == 'T');
    tx_complete = true;
    uart_driver_poll(NULL); /* Deliver the hardware TX-complete IRQ. */
    bus_service_poll(&state.bus, state.sensors.ticks);

    event_count = 0;
    state.device.registers.byte[40] = 1;
    state.device.registers.byte[41] = 5;
    registers_set_u16(&state.device.registers, 46, 10);
    inject_write(2, 33, 2); /* Mode write clears torque, acceleration, velocity. */
    bus_service_poll(&state.bus, state.sensors.ticks);
    assert(event_count == 3 && memcmp(events, "FST", 3) == 0);
    assert(state.device.registers.byte[33] == 2);
    assert(state.device.registers.byte[40] == 0);
    assert(state.device.registers.byte[41] == 0);
    assert(registers_u16(&state.device.registers, 46) == 0);
    assert(state.motion.pending);
    tx_complete = true;
    uart_driver_poll(NULL); /* Deliver the hardware TX-complete IRQ. */
    bus_service_poll(&state.bus, state.sensors.ticks);

    event_count = 0;
    delay_complete = false;
    inject_sync_read();
    bus_service_poll(&state.bus, state.sensors.ticks);
    assert(state.bus.phase == BUS_WAIT_SLOT);
    assert(event_count == 1 && events[0] == 'D');
    bus_service_poll(&state.bus, state.sensors.ticks);
    assert(event_count == 1); /* A waiting response still owns its buffer. */
    delay_complete = true;
    uart_driver_poll(NULL); /* Deliver the hardware slot-timer IRQ. */
    bus_service_poll(&state.bus, state.sensors.ticks);
    assert(state.bus.phase == BUS_TRANSMIT);
    assert(event_count == 2 && events[1] == 'T');
    tx_complete = true;
    uart_driver_poll(NULL); /* Deliver the hardware TX-complete IRQ. */
    bus_service_poll(&state.bus, state.sensors.ticks);

    event_count = 0;
    inject_write(2, 5, 3); /* Response keeps request ID after live ID changes. */
    bus_service_poll(&state.bus, state.sensors.ticks);
    assert(last_tx_id == 2 && state.device.registers.byte[5] == 3);
    assert(event_count == 3 && memcmp(events, "FST", 3) == 0);
    tx_complete = true;
    uart_driver_poll(NULL); /* Deliver the hardware TX-complete IRQ. */
    bus_service_poll(&state.bus, state.sensors.ticks);

    event_count = 0;
    state.device.registers.byte[8] = 0; /* Suppressed ACK: baud changes at idle. */
    inject_write(3, 6, 1);
    bus_service_poll(&state.bus, state.sensors.ticks);
    assert(event_count == 1 && events[0] == 'B');
    assert(!state.bus.baud_pending);

    /* Same-value goals still carry relative-origin/auto-torque effects, and
     * later coalesced acceleration writes must not erase those effects. */
    app_state_t pending = {0};
    pending.device.registers.byte[33] = MOTION_MODE_RELATIVE;
    pending.device.registers.byte[55] = 1;
    protocol_result_t repeat_goal = { .effect = PROTOCOL_EFFECT_WRITE,
        .write = { .start = 43, .accepted_count = 1, .any_changed = false } };
    command_service_apply(&repeat_goal, &pending);
    assert(pending.motion.pending && pending.motion.position_goal && pending.motion.auto_torque);
    protocol_result_t acceleration = { .effect = PROTOCOL_EFFECT_WRITE,
        .write = { .start = 41, .accepted_count = 1, .any_changed = true } };
    command_service_apply(&acceleration, &pending);
    assert(pending.motion.position_goal && pending.motion.auto_torque);
    /* Commands can arrive before the next sensor pair. A later explicit
     * torque write overrides the goal's queued auto-enable, including when
     * torque was already zero and the write does not change its byte. */
    const uint8_t torque_states[] = {0, 2};
    for (unsigned i = 0; i < sizeof torque_states; ++i) {
        app_state_t stopped = pending;
        registers_factory_defaults(&stopped.device.registers);
        stopped.device.registers.byte[REG_OPERATION_MODE] = MOTION_MODE_POSITION;
        stopped.device.registers.byte[REG_TORQUE_ENABLE] = torque_states[i];
        stopped.device.registers.byte[REG_LOCK] = 1;
        stopped.control_initialized = true;
        stopped.sensor_service.measurement.position = 1000;
        stopped.sensor_service.measurement.voltage = 120;
        stopped.sensor_service.measurement.temperature = 25;
        control_pipeline_reanchor(&stopped.control, 1000);
        protocol_result_t torque_write = {.effect = PROTOCOL_EFFECT_WRITE,
            .write = {.start = REG_TORQUE_ENABLE, .accepted_count = 1}};
        command_service_apply(&torque_write, &stopped);
        assert(!stopped.motion.auto_torque);
        app_runtime_service_control_pair(&stopped, 1);
        assert(stopped.device.registers.byte[REG_TORQUE_ENABLE] == torque_states[i]);
        assert(!stopped.motion.pending && stopped.control.relative_origin == 1000);
        /* A new goal after the explicit torque write can still auto-enable. */
        command_service_apply(&repeat_goal, &stopped);
        assert(stopped.motion.auto_torque);
    }
    app_runtime_reanchor(&pending, 321);
    assert(!pending.motion.pending && !pending.motion.position_goal && !pending.motion.auto_torque);
    protocol_result_t empty_goal = { .effect = PROTOCOL_EFFECT_WRITE,
        .write = { .start = 42, .accepted_count = 0 } };
    command_service_apply(&empty_goal, &pending);
    assert(!pending.motion.pending);

    /* Invalid new limits cannot reuse the preceding accepted request to drive.
     * A subsequent valid acceptance clears the inhibition. */
    register_table_t *regs = &state.device.registers;
    regs->byte[33] = 0;
    regs->byte[40] = 1;
    registers_set_u16(regs, 9, 0);
    registers_set_u16(regs, 11, 0);
    control_pipeline_reanchor(&state.control, 100);
    motion_request_t accepted_request;
    assert(motion_request_decode_cached(regs, state.control.relative_origin,
                                        &state.device.cached_motion_limits,
                                        &accepted_request));
    assert(control_pipeline_accept(&state.control, &accepted_request,
                                   &state.device.cached_motion_limits, true));
    state.control_initialized = true;
    state.sensor_service.encoder.position = 100;
    state.sensor_service.measurement.position = 100;
    state.sensor_service.measurement.arm_position = 100;
    state.sensor_service.measurement.current = 7;
    state.sensor_service.measurement.voltage = 120;
    state.sensor_service.measurement.temperature = 30;
    registers_set_u16(regs, 9, 200);
    registers_set_u16(regs, 11, 100);
    state.motion.pending = true;
    app_runtime_service_control_pair(&state, state.sensors.ticks);
    assert(state.motion_rejected);
    assert(!state.control.bridge.previous_permit);
    registers_set_u16(regs, 9, 0);
    registers_set_u16(regs, 11, 0);
    state.motion.pending = true;
    app_runtime_service_control_pair(&state, state.sensors.ticks);
    assert(!state.motion_rejected);
    assert(registers_u16(regs, 56) == 100);
    assert(registers_u16(regs, 69) == 7);
    assert(regs->byte[62] == 120 && regs->byte[63] == 30);
    regs->byte[82] = 3;
    regs->byte[83] = 80;
    regs->byte[84] = 1;
    state.control_initialized = false; /* Offset/maintenance reanchor. */
    state.motion.pending = true;
    app_runtime_service_control_pair(&state, state.sensors.ticks);
    assert(!state.motion_rejected);
    assert(state.control.limits.rate == 50);
    assert(state.control.limits.maximum_velocity == 150);

    /* Motion-only writes, including the common acceleration/goal/speed
     * block, keep the bridge qualified. Adjacent torque/configuration
     * writes still start safety requalification. */
    app_state_t goal_state = {0};
    goal_state.device.registers.byte[55] = 1;
    goal_state.device.registers.byte[40] = 1;
    goal_state.output.phase = OUTPUT_READY;
    for (uint8_t address = 42; address <= 46; address += 2) {
        protocol_result_t goal_write = { .effect = PROTOCOL_EFFECT_WRITE,
            .write = { .start = address, .accepted_count = 2,
                .any_changed = true } };
        command_service_apply(&goal_write, &goal_state);
        assert(goal_state.output.phase == OUTPUT_READY);
    }
    protocol_result_t motion_block = { .effect = PROTOCOL_EFFECT_WRITE,
        .write = { .start = 41, .accepted_count = 7,
            .any_changed = true } };
    command_service_apply(&motion_block, &goal_state);
    assert(goal_state.output.phase == OUTPUT_READY);
    protocol_result_t mode_write = { .effect = PROTOCOL_EFFECT_WRITE,
        .write = { .start = 33, .accepted_count = 1,
            .any_changed = true } };
    command_service_apply(&mode_write, &goal_state);
    assert(goal_state.output.phase == OUTPUT_REQUALIFYING);
    for (uint8_t address = 40; address <= 47; address += 7) {
        goal_state.output.phase = OUTPUT_READY;
        protocol_result_t mixed_write = { .effect = PROTOCOL_EFFECT_WRITE,
            .write = { .start = address, .accepted_count = 2,
                .any_changed = true } };
        command_service_apply(&mixed_write, &goal_state);
        assert(goal_state.output.phase == OUTPUT_REQUALIFYING);
    }
    /* A failed target application latches board capability off until reset.
     * An expected coast result is successful and must not take this path. */
    state.output.phase = OUTPUT_READY;
    state.output.fresh_pairs = 10;
    bridge_accept = false;
    app_runtime_service_control_pair(&state, state.sensors.ticks);
    assert(state.output.phase == OUTPUT_FAILED && state.output.fresh_pairs == 0);
    bridge_accept = true;

    /* A TX completion that never arrives releases the response buffer and
     * parser after a bounded interval; subsequent commands can be accepted. */
    event_count = 0;
    const uint8_t ping[] = {0xff, 0xff, 3, 2, 1, (uint8_t)~(3u + 2u + 1u)};
    memcpy(incoming, ping, sizeof(ping));
    incoming_length = sizeof(ping);
    incoming_cursor = 0;
    bus_service_poll(&state.bus, state.sensors.ticks);
    assert(state.bus.phase == BUS_TRANSMIT && events[0] == 'T');
    bus_service_poll(&state.bus, state.sensors.ticks + 501u);
    assert(state.bus.phase == BUS_RECEIVE && state.bus.response_timeouts == 1);
    assert(!state.bus.protocol.transmit_busy && events[1] == 'X');
    /* A malformed burst cannot monopolize the foreground control loop. */
    memset(incoming, 0, sizeof(incoming));
    incoming_length = sizeof(incoming);
    incoming_cursor = 0;
    bus_service_poll(&state.bus, state.sensors.ticks);
    assert(incoming_cursor == 64);
    bus_service_poll(&state.bus, state.sensors.ticks);
    assert(incoming_cursor == sizeof(incoming));
    /* Maintenance failure leaves acquisition inactive and output unqualified. */
    event_count = 0;
    restart_success = false;
    state.storage_source = STORAGE_SOURCE_PRIMARY;
    assert(app_runtime_commit_storage(&state)); /* Flash succeeded. */
    assert(!state.sensor_active && !state.control_initialized);
    assert((state.device.registers.byte[65] & 2u) != 0u);
    assert(state.output.phase == OUTPUT_FAILED);
    puts("Runtime write/flash/restart/reply/baud ordering: OK");
}
