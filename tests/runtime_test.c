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
bool sensor_driver_timer_tick(sensor_driver_t *driver) { (void)driver; return false; }
void sensor_driver_begin(sensor_driver_t *driver, uint32_t generation)
{ (void)driver; (void)generation; }
bool sensor_driver_take_encoder(sensor_driver_t *driver, uint32_t *generation,
                                bool *valid, uint16_t *raw)
{ (void)driver; (void)generation; (void)valid; (void)raw; return false; }
bool sensor_driver_take_adc(sensor_driver_t *driver, uint32_t *generation,
                            bool *valid, uint16_t samples[3])
{ (void)driver; (void)generation; (void)valid; (void)samples; return false; }
void sensor_driver_poll(sensor_driver_t *driver) { (void)driver; }
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

static void arm_extension_transaction_test(void)
{
    app_state_t arm_state = {0};
    registers_factory_defaults(&arm_state.device.registers);
    arm_state.device.registers.byte[5] = 2;
    arm_state.control_initialized = true;
    arm_state.sensors.ticks = 12;
    arm_state.last_good_tick = 12;
    arm_state.sensor_service.measurement.position = 100;
    arm_state.sensor_service.measurement.arm_position = 100;
    arm_control_init(&arm_state.arm, 100, 12);
    protocol_result_t reply = {0};
    protocol_packet_t packet = {.id=2, .instruction=0x91, .param_count=27};
    uint8_t config[26] = {0};
    config[0]=0;
    config[1]=1; /* Kp 256 */
    config[8]=0xbc; config[9]=2; /* effort 700 */
    config[10]=0x88; config[11]=0x13; /* velocity 5000 */
    config[12]=0x30; config[13]=0x75; /* acceleration 30000 */
    config[14]=0xf4; config[15]=1; /* timeout 500 ms */
    config[16]=64;
    /* Shared little-endian vector in StsServoDriver/test/arm-extension.test.js. */
    const uint8_t range_bytes[8] = {0, 0, 0xf0, 0xff, 0, 0, 0x10, 0};
    memcpy(config+18, range_bytes, sizeof range_bytes);
    packet.params[0] = 0xA0;
    memcpy(packet.params+1, config, 26);
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    assert(reply.response_size == 7 && reply.response[5] == 0);
    config[12]=0x31; /* 30001 is rejected without changing the RAM profile. */
    memcpy(packet.params+1, config, 26);
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    assert(reply.response[5] == 1 && arm_state.arm.config.acceleration_limit == 30000);
    config[12]=0x30;
    packet.param_count = 2;
    packet.params[0] = 0xB8;
    packet.params[1] = 1;
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    assert(reply.response[5] == 0 && arm_state.arm_selected);
    packet.param_count = 3;
    packet.params[0] = 0xBA;
    packet.params[1] = 7;
    packet.params[2] = 0;
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    assert(reply.response[5] == 0 && arm_state.arm.armed);
    arm_state.sensors.ticks = 13;
    arm_state.sensor_service.measurement.voltage = 60;
    arm_state.sensor_service.measurement.temperature = 20;
    arm_state.sensor_service.temperature_validated = 19;
    arm_state.sensor_service.temperature_valid = true;
    arm_state.sensor_service.temperature_spikes = 0x1234u;
    arm_state.sensor_service.temperature_candidate_count = 1u;
    packet.instruction = 0x90;
    packet.param_count = 2;
    packet.params[0] = 0xD0;
    packet.params[1] = 6;
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    assert(reply.response[5] == 0);
    const uint8_t quality_vector[6] = {20,19,0x34,0x12,3,1};
    assert(memcmp(reply.response+6, quality_vector, sizeof quality_vector) == 0);
    packet.instruction = 0x91;
    app_runtime_service_control_pair(&arm_state);
    assert(arm_state.arm.armed); /* Torque-off preparation must survive a pair. */
    arm_state.sensors.ticks = 14;
    packet.param_count = 21;
    memset(packet.params, 0, 21);
    packet.params[0] = 0xE0;
    packet.params[1] = 7;
    packet.params[3] = 1;
    packet.params[5] = 100;
    int32_t target = 100*256;
    memcpy(packet.params+7, &target, 4);
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    assert(reply.response[5] == 0 && arm_state.arm.queue_count == 1);
    packet.params[3] = 1; /* duplicate sequence stays rejected atomically */
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    assert(reply.response[5] != 0 && arm_state.arm.queue_count == 1);
    arm_state.device.registers.byte[40] = 1;
    packet.instruction = 0x92;
    packet.param_count = 2;
    packet.params[0] = 7;
    packet.params[1] = 0;
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    assert(reply.response[5] == 0 && arm_state.arm.running);

    arm_control_disarm(&arm_state.arm);
    arm_state.device.registers.byte[40] = 0;
    packet.instruction = 0x91;
    packet.param_count = 3;
    packet.params[0] = 0xBA;
    packet.params[1] = 9;
    packet.params[2] = 0;
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    assert(reply.response[5] == 0);
    packet.param_count = 17;
    packet.params[0] = 0xF0;
    /* Shared target vector in StsServoDriver/test/arm-extension.test.js. */
    const uint8_t target_bytes[16] = {9,0,1,0, 0,0xe7,0xff,0xff,
                                      0xb0,4, 0xb8,0x0b, 8,7, 0xba,0xff};
    memcpy(packet.params+1, target_bytes, sizeof target_bytes);
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    assert(reply.response[5] == 0 && arm_state.arm.target_pending);
    assert(arm_state.arm.pending_target.position_q8 == -6400);
    assert(arm_state.arm.pending_target.braking == 1800);
    arm_state.device.registers.byte[40] = 1;
    packet.instruction = 0x92;
    packet.param_count = 2;
    packet.params[0] = 9;
    packet.params[1] = 0;
    arm_extension_process(&packet, &arm_state.device.registers, &reply, &arm_state);
    assert(reply.response[5] == 0 && arm_state.arm.target_active);

    /* v1.4 operations keep the original abort/arm contract. */
    arm_state.arm.session=0x1234;
    arm_state.arm.accepted_sequence=0x2a;
    arm_state.output.phase=OUTPUT_READY;
    arm_state.arm_drive_enabled=true;
    arm_state.device.registers.byte[65]=0;
    arm_state.arm.last_tick=arm_state.last_good_tick=arm_state.sensors.ticks;
    packet.instruction=0x95;packet.param_count=2;
    packet.params[0]=0x34;packet.params[1]=0x12;
    arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
    assert(reply.response[5]==0 && arm_state.device.registers.byte[40]==1);
    assert(!arm_state.arm.target_active && arm_state.arm.holding);
    packet.instruction=0x96;packet.param_count=6;
    const uint8_t takeover_vector[6]={0x34,0x12,0x2a,0,0x35,0x12};
    memcpy(packet.params,takeover_vector,6);
    arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
    assert(reply.response[5]==2); /* not yet stationary-qualified */
    arm_state.arm.stationary_ms=50;
    arm_state.arm.expired=true;
    arm_state.device.registers.byte[65]=4;
    arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
    assert(reply.response[5]==2 && arm_state.arm.session==0x1234);
    arm_state.device.registers.byte[65]=0;
    packet.id=PROTOCOL_BROADCAST;
    arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
    assert(arm_state.arm.session==0x1234 && reply.response_size==0);
    packet.id=2;packet.param_count=5;
    arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
    assert(reply.response[5]==1 && arm_state.arm.session==0x1234);
    packet.param_count=6;
    arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
    assert(reply.response[5]==0 && arm_state.arm.session==0x1235);
    assert(!arm_state.arm.expired && arm_state.arm.accepted_sequence==0);
    assert(arm_state.device.registers.byte[40]==1 && arm_state.arm.armed);
    arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
    assert(reply.response[5]==2); /* stale takeover cannot reset sequence */
    /* v1.5 stage vector shared with the Node driver. */
    packet.instruction=0x97;packet.param_count=17;
    const uint8_t profile_vector[17]={0x35,0x12,1,1,0,0,1,0,0,0,1,100,0,0x2c,1,64,0};
    memcpy(packet.params,profile_vector,17);
    packet.params[16]=1;
    arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
    assert(reply.response[5]==1 && !arm_state.arm.profile_generation[1]);
    packet.params[16]=0;packet.param_count=16;
    arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
    assert(reply.response[5]==1 && !arm_state.arm.profile_generation[1]);
    packet.param_count=17;packet.id=PROTOCOL_BROADCAST;
    arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
    assert(!arm_state.arm.profile_generation[1]);
    packet.id=2;
    arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
    assert(reply.response[5]==0 && arm_state.arm.profile_generation[1]==1);
    packet.instruction=0x98;packet.param_count=7;
    const uint8_t commit_vector[7]={0x35,0x12,1,0,1,1,0};
    memcpy(packet.params,commit_vector,7);
    arm_state.arm.last_requested_effort=0;
    arm_state.arm.filtered_velocity_q8_s=0;
    arm_state.arm.last_reference_position_q8=arm_state.arm.measured_position_q8;
    arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
    assert(reply.response[5]==0 && arm_state.arm.active_profile==1);
    assert(arm_state.device.registers.byte[40]==1);

    /* v1.6 FF vector shared with Node; no planner sequence consumption. */
    packet.instruction=0x99;packet.param_count=12;
    const uint8_t ff_vector[12]={0x35,0x12,1,0,0xba,0xff,0,0,0xe8,3,100,0};
    memcpy(packet.params,ff_vector,12);
    arm_state.arm.last_feedforward=0;
    packet.param_count=11;
    arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
    assert(reply.response[5]==1 && !arm_state.arm.feedforward_enabled);
    packet.param_count=12;packet.id=PROTOCOL_BROADCAST;
    arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
    assert(!arm_state.arm.feedforward_enabled);
    packet.id=2;arm_state.device.registers.byte[65]=4;
    arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
    assert(reply.response[5]==2 && !arm_state.arm.feedforward_enabled);
    arm_state.device.registers.byte[65]=0;
    arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
    assert(reply.response[5]==0 && arm_state.arm.gravity_target==-70);
    assert(arm_state.arm.feedforward_sequence==1 && arm_state.arm.accepted_sequence==1);
    arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
    assert(reply.response[5]==2); /* replay */
    packet.instruction=0x90;packet.param_count=2;packet.params[0]=0xA2;packet.params[1]=20;
    arm_extension_process(&packet,&arm_state.device.registers,&reply,&arm_state);
    assert(reply.response[5]==0 && reply.response[10]==1 && reply.response[24]==1);

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
#ifdef FW_MOTOR_TEST
            sample.drive_lease_valid = true;
            sample.drive_lease_deadline = 100;
#endif
            arm_control_init(&sample.arm, 100, 0);
            arm_config_t config = {
                .kp_q8 = 2560, .ki_q8 = 256, .integral_limit = 500,
                .effort_limit = 1000, .velocity_limit = 1000,
                .acceleration_limit = 1000, .timeout_ms = 1000,
                .velocity_filter_q8 = 64,
                .position_min_q8 = 0, .position_max_q8 = 4095 * 256};
            assert(arm_control_configure(&sample.arm, config));
            assert(arm_control_arm(&sample.arm, 1, 100, 0));
            sample.arm.start_position_q8 = (100 + direction * 100) * 256;
            sample.sensors.ticks = 1;
            app_runtime_service_control_pair(&sample);
            assert(sample.arm_result.requested_effort == direction * 1000);
            assert(sample.arm_applied_effort == direction * 970);
            assert(sample.arm_result.saturated);
            assert(sample.arm_drive_enabled);
            assert(sample.arm.integral_effort_q16_ms == 0);

            bridge_accept = false;
            sample.sensors.ticks = 2;
            app_runtime_service_control_pair(&sample);
            assert(sample.arm_applied_effort == 0 && !sample.arm_drive_enabled);
            assert(!sample.arm.armed && sample.arm.integral_effort_q16_ms == 0);
            bridge_accept = true;
        }
    }
}

int main(void)
{
    snapshot_publication_test();
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
    app_runtime_service_control_pair(&state);
    assert(state.motion_rejected);
    assert(!state.control.bridge.previous_permit);
    registers_set_u16(regs, 9, 0);
    registers_set_u16(regs, 11, 0);
    state.motion.pending = true;
    app_runtime_service_control_pair(&state);
    assert(!state.motion_rejected);
    assert(registers_u16(regs, 56) == 100);
    assert(registers_u16(regs, 69) == 7);
    assert(regs->byte[62] == 120 && regs->byte[63] == 30);
    regs->byte[82] = 3;
    regs->byte[83] = 80;
    regs->byte[84] = 1;
    state.control_initialized = false; /* Offset/maintenance reanchor. */
    state.motion.pending = true;
    app_runtime_service_control_pair(&state);
    assert(!state.motion_rejected);
    assert(state.control.limits.rate == 50);
    assert(state.control.limits.maximum_velocity == 150);

#ifndef FW_MOTOR_TEST
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
#endif
#ifdef FW_MOTOR_TEST
    app_state_t lease = state;
    lease.device.registers.byte[55] = 1;
    lease.device.registers.byte[40] = 1;
    lease.sensors.ticks = 100;
    protocol_result_t torque_on = { .effect = PROTOCOL_EFFECT_WRITE,
        .write = { .start = 40, .accepted_count = 1, .any_changed = true } };
    command_service_apply(&torque_on, &lease);
    assert(lease.drive_lease_valid && lease.drive_lease_deadline == 300);
    lease.output.phase = OUTPUT_READY;
    lease.sensors.ticks = 200;
    torque_on.write.any_changed = false;
    command_service_apply(&torque_on, &lease);
    assert(lease.drive_lease_valid && lease.drive_lease_deadline == 400);
    assert(lease.output.phase == OUTPUT_READY); /* Heartbeat does not revoke. */
    lease.sensors.ticks = 400;
    app_runtime_service_control_pair(&lease);
    assert(!lease.drive_lease_valid && lease.device.registers.byte[40] == 0);
    assert(lease.output.phase == OUTPUT_REQUALIFYING);
    lease.device.registers.byte[40] = 1;
    torque_on.write.any_changed = true;
    command_service_apply(&torque_on, &lease);
    assert(lease.drive_lease_valid);
    protocol_result_t calibrate = { .effect = PROTOCOL_EFFECT_CALIBRATE,
        .calibration_target = 2048 };
    lease.control_initialized = false;
    command_service_apply(&calibrate, &lease);
    assert(!lease.drive_lease_valid && lease.device.registers.byte[40] == 0);
    lease.device.registers.byte[40] = 1;
    command_service_apply(&torque_on, &lease);
    protocol_result_t maintenance = { .effect = PROTOCOL_EFFECT_WRITE,
        .write = { .start = 21, .accepted_count = 1, .any_changed = true } };
    lease.device.registers.byte[55] = 0;
    lease.device.registers.byte[21] ^= 1;
    event_count = 0;
    command_service_apply(&maintenance, &lease);
    assert(!lease.drive_lease_valid);
#endif
    /* A failed target application latches board capability off until reset.
     * An expected coast result is successful and must not take this path. */
    state.output.phase = OUTPUT_READY;
    state.output.fresh_pairs = 10;
    bridge_accept = false;
    app_runtime_service_control_pair(&state);
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
