#include "protocol_service.h"
#include "registers.h"
#include "sensor_service.h"

#include <assert.h>
#include <stdio.h>

static const uint8_t read_telemetry[] = {
    0xff, 0xff, 2, 4, 2, 56, 15, 176
};

static void publish_temperature(sensor_service_t *sensor,
                                register_table_t *registers,
                                uint16_t raw_temperature)
{
    uint16_t adc[3] = {raw_temperature, 400, 1600};
    uint32_t generation = sensor_service_begin(sensor, registers);
    sensor_service_encoder_done(sensor, registers, generation, true, 1800);
    sensor_service_adc_done(sensor, generation, true, adc);
    assert(sensor_service_publish(sensor, registers, 50u));
}

static void temperature_validation_test(void)
{
    register_table_t registers = {0};
    registers_factory_defaults(&registers);
    sensor_service_t sensor;
    sensor_service_init(&sensor);
    publish_temperature(&sensor, &registers, 0x0f9u << 2); /* 35 */
    assert(sensor.measurement.temperature == 35 &&
           sensor.temperature_validated == 35 && sensor.temperature_valid);
    publish_temperature(&sensor, &registers, 0x0a3u << 2); /* 50 */
    assert(sensor.measurement.temperature == 50 &&
           sensor.temperature_validated == 35 &&
           sensor.temperature_candidate_count == 1u);
    publish_temperature(&sensor, &registers, 0x0f9u << 2);
    assert(sensor.temperature_validated == 35 &&
           sensor.temperature_spikes == 1u);
    for (unsigned i=0; i<2; ++i) {
        publish_temperature(&sensor, &registers, 0x0a3u << 2);
        assert(sensor.temperature_validated == 35);
    }
    publish_temperature(&sensor, &registers, 0x0a3u << 2);
    assert(sensor.temperature_validated == 50 &&
           sensor.temperature_candidate_count == 0u);
    /* Reset discards candidate history; raw protection input is never changed. */
    sensor_service_restart(&sensor);
    assert(!sensor.temperature_valid && sensor.temperature_spikes == 0u);
    publish_temperature(&sensor, &registers, 0x0f9u << 2);
    assert(sensor.temperature_validated == 35);
}

static const uint8_t *finish_read(protocol_service_t *bus, uint8_t *length)
{
    uint8_t delay;
    const uint8_t *reply = protocol_service_response(bus, length, &delay);
    assert(reply != NULL && *length == 21 && reply[2] == 2);
    return reply;
}

int main(void)
{
    temperature_validation_test();
    register_table_t initial = {0};
    registers_factory_defaults(&initial);
    initial.byte[5] = 2;
    initial.byte[8] = 1;
    initial.byte[18] = 0x5c;
    device_t device;
    device_init(&device, &initial);
    protocol_service_t bus;
    protocol_service_init(&bus, &device, 0, 0);
    sensor_service_t sensor;
    sensor_service_init(&sensor);
    const uint16_t adc[3] = {0x250u << 2, 400, 1600};

    uint32_t generation = sensor_service_begin(&sensor, &device.registers);
    sensor_service_adc_done(&sensor, generation, true, adc);
    assert(!sensor_service_publish(&sensor, &device.registers, 50u));
    for (unsigned i = 0; i < sizeof(read_telemetry); ++i) {
        assert(protocol_service_feed(&bus, read_telemetry[i]));
    }
    uint8_t length;
    const uint8_t *reply = finish_read(&bus, &length);
    assert(reply[5] == 0 && reply[11] == 0); /* No partial telemetry. */
    protocol_service_transmit_complete(&bus);

    sensor_service_encoder_done(&sensor, &device.registers, generation, true, 1800);
    assert(sensor_service_publish(&sensor, &device.registers, 50u));
    assert(registers_u16(&device.registers, 56) == 0);
    assert(sensor.measurement.position == 1800 && sensor.measurement.current == 0);
    assert(sensor.measurement.voltage == 100 && sensor.measurement.temperature == 0);
    assert(device.registers.byte[62] == 0 && device.registers.byte[63] == 0);
    assert(device.registers.byte[65] == 0);

    /* A failed encoder completion must not publish the ADC-only half. */
    generation = sensor_service_begin(&sensor, &device.registers);
    sensor_service_encoder_done(&sensor, &device.registers, generation, false, 0);
    sensor_service_adc_done(&sensor, generation, true, adc);
    assert(!sensor_service_publish(&sensor, &device.registers, 50u));
    assert(device.registers.byte[65] == 2 && registers_u16(&device.registers, 56) == 0);
    assert(sensor.measurement.position == 1800); /* Rejected pair is never consumed. */
    generation = sensor_service_begin(&sensor, &device.registers);
    assert(sensor.acquisition.missed_pairs == 1);
    sensor_service_encoder_done(&sensor, &device.registers, generation, true, 1801);
    sensor_service_adc_done(&sensor, generation, false, 0);
    assert(!sensor_service_publish(&sensor, &device.registers, 50u));
    generation = sensor_service_begin(&sensor, &device.registers);
    assert(sensor.acquisition.missed_pairs == 2);
    /* A completion from the prior period cannot mark the new period valid or
     * set an encoder fault. The driver passes the originating generation. */
    device.registers.byte[65] &= (uint8_t)~0x02u;
    sensor_service_encoder_done(&sensor, &device.registers, generation - 1u,
                                false, 0);
    sensor_service_adc_done(&sensor, generation - 1u, true, adc);
    assert(!sensor.acquisition.encoder_ready && !sensor.acquisition.adc_ready);
    assert((device.registers.byte[65] & 0x02u) == 0u);

    /* Sensor service owns typed measurements. The application control cycle is
     * the sole normal telemetry publisher, so a concurrent wire read still
     * sees the previous register snapshot here. */
    for (unsigned i = 0; i + 1 < sizeof(read_telemetry); ++i) {
        assert(protocol_service_feed(&bus, read_telemetry[i]));
    }
    sensor_service_encoder_done(&sensor, &device.registers, generation, true, 1802);
    sensor_service_adc_done(&sensor, generation, true, adc);
    assert(sensor_service_publish(&sensor, &device.registers, 50u));
    assert(protocol_service_feed(&bus, read_telemetry[sizeof(read_telemetry) - 1]));
    reply = finish_read(&bus, &length);
    assert(reply[4] == 0 && reply[5] == 0 && reply[6] == 0);
    assert(reply[11] == 0 && reply[12] == 0);
    protocol_service_transmit_complete(&bus);
    assert(!sensor_service_calibrate(&sensor, &device.registers, 4096));
    assert(sensor_service_calibrate(&sensor, &device.registers, 2048));
    assert(register_decode_position_offset(registers_u16(&device.registers, 31)) ==
           1802 - 2048);
    assert(sensor.encoder.position == 2048);
    assert(sensor.measurement.position == 2048 && sensor.measurement.speed == 0);
    assert(registers_u16(&device.registers, 56) == 2048);
    assert(sensor_service_calibrate(&sensor, &device.registers, -4095));
    assert(registers_u16(&device.registers, 31) == 0);
    assert(sensor.measurement.position == 1);
    generation = sensor_service_begin(&sensor, &device.registers);
    sensor_service_encoder_done(&sensor, &device.registers, generation, true, 1802);
    sensor_service_adc_done(&sensor, generation, true, adc);
    assert(sensor_service_publish(&sensor, &device.registers, 50u));
    assert(sensor.measurement.position == 1);
    /* Maintenance cancels partial acquisition, but not runtime calibration. */
    generation = sensor_service_begin(&sensor, &device.registers);
    sensor_service_adc_done(&sensor, generation, true, adc);
    sensor_service_restart(&sensor);
    assert(!sensor_service_publish(&sensor, &device.registers, 50u));
    assert(sensor.runtime_calibration_offset_valid);
    generation = sensor_service_begin(&sensor, &device.registers);
    sensor_service_encoder_done(&sensor, &device.registers, generation, true, 1802);
    sensor_service_adc_done(&sensor, generation, true, adc);
    assert(sensor_service_publish(&sensor, &device.registers, 50u));
    assert(sensor.measurement.position == 1);
    sensor_service_init(&sensor);
    assert(!sensor.runtime_calibration_offset_valid);
    generation = sensor_service_begin(&sensor, &device.registers);
    sensor_service_encoder_done(&sensor, &device.registers, generation, true, 1802);
    sensor_service_adc_done(&sensor, generation, true, adc);
    assert(sensor_service_publish(&sensor, &device.registers, 50u));
    assert(sensor.measurement.position == 1802);
    assert(sensor_service_calibrate(&sensor, &device.registers, -4095));
    sensor_service_offset_written(&sensor);
    generation = sensor_service_begin(&sensor, &device.registers);
    sensor_service_encoder_done(&sensor, &device.registers, generation, true, 1802);
    sensor_service_adc_done(&sensor, generation, true, adc);
    assert(sensor_service_publish(&sensor, &device.registers, 50u));
    assert(sensor.measurement.position == 1802);
    puts("Sensor service event/traffic tests: OK");
}
