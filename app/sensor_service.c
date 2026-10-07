#include "sensor_service.h"

#include "registers.h"

static unsigned temperature_distance(uint8_t left, uint8_t right)
{
    return left > right ? (unsigned)(left - right) : (unsigned)(right - left);
}

static void validate_temperature(sensor_service_t *service, uint8_t raw)
{
    enum { TEMPERATURE_JUMP = 5u, CONFIRM_PAIRS = 3u };
    if (!service->temperature_valid) {
        service->temperature_validated = raw;
        service->temperature_valid = true;
        return;
    }
    if (temperature_distance(raw, service->temperature_validated) <
        TEMPERATURE_JUMP) {
        if (service->temperature_candidate_count != 0u &&
            service->temperature_spikes != UINT16_MAX)
            ++service->temperature_spikes;
        service->temperature_candidate_count = 0u;
        service->temperature_validated = raw;
        return;
    }
    if (service->temperature_candidate_count != 0u &&
        temperature_distance(raw, service->temperature_candidate) <
            TEMPERATURE_JUMP) {
        if (++service->temperature_candidate_count >= CONFIRM_PAIRS) {
            service->temperature_validated = raw;
            service->temperature_candidate_count = 0u;
        }
        return;
    }
    if (service->temperature_candidate_count != 0u &&
        service->temperature_spikes != UINT16_MAX)
        ++service->temperature_spikes;
    service->temperature_candidate = raw;
    service->temperature_candidate_count = 1u;
}

void sensor_service_restart(sensor_service_t *service)
{
    service->completed_pairs = 0;
    service->encoder_raw = 0;
    encoder_tracker_init(&service->encoder);
    speed_tracker_init(&service->speed);
    adc_tracker_init(&service->adc);
    service->measurement = (sensor_measurement_t){0};
    service->temperature_validated = 0u;
    service->temperature_candidate = 0u;
    service->temperature_candidate_count = 0u;
    service->temperature_valid = false;
    service->temperature_spikes = 0u;
}

void sensor_service_init(sensor_service_t *service)
{
    sensor_service_restart(service);
    service->runtime_calibration_offset = 0;
    service->runtime_calibration_offset_valid = false;
}

/* Keep filter scratch separate from the subsequent control/planning stack. */
__attribute__((noinline)) bool sensor_service_accept_pair(sensor_service_t *service, register_table_t *registers,
                                const sensor_pair_t *pair, uint8_t motion_rate_scale)
{
    /* Every input is unsigned 12-bit; one combined mask validates all four. */
    uint16_t raw_bits = pair->encoder_raw | pair->adc_raw[0] |
                        pair->adc_raw[1] | pair->adc_raw[2];
    if (!pair->valid || raw_bits > 4095u) {
        registers->byte[REG_SERVO_STATUS] |= 0x02u;
        return false;
    }
    uint16_t raw = pair->encoder_raw;
    const uint16_t *samples = pair->adc_raw;
    int32_t position;
    uint16_t encoded_position;
    bool mode_changed = service->encoder.mode_valid &&
        service->encoder.previous_mode != registers->byte[REG_OPERATION_MODE];
    int32_t offset = service->runtime_calibration_offset_valid
        ? service->runtime_calibration_offset
        : register_decode_position_offset(registers_u16(registers, REG_POSITION_CORRECTION));
    if (!encoder_tracker_sample(&service->encoder, raw,
                                (registers->byte[REG_CONFIGURATION_FLAGS] & 0x80u) != 0u,
                                offset, registers->byte[REG_OPERATION_MODE], &position) ||
        !register_encode_signed(position, 15u, &encoded_position)) {
        registers->byte[REG_SERVO_STATUS] |= 0x02u;
        return false;
    }
    adc_reading_t reading;
    bool complementary = (registers->byte[REG_CONFIGURATION_FLAGS] & 0x20u) != 0u;
    if (!adc_tracker_sample(&service->adc, samples, complementary, &reading)) {
        return false;
    }
    service->encoder_raw = raw;
    ++service->completed_pairs;
    validate_temperature(service, reading.temperature);
    registers->byte[REG_SERVO_STATUS] &= (uint8_t)~0x02u;
    if (mode_changed) speed_tracker_init(&service->speed);
    speed_tracker_sample(&service->speed, position,
                         motion_rate_scale, registers->byte[REG_DERIVATIVE_AND_MOVING_DEADBAND]);
    service->measurement = (sensor_measurement_t){
        .position = position,
        .arm_position = encoder_arm_position(&service->encoder),
        .speed = service->speed.measured_delta,
        .current = reading.current,
        .voltage = reading.voltage,
        .temperature = reading.temperature,
        .moving = service->speed.moving,
    };
    return true;
}

bool sensor_service_calibrate(sensor_service_t *service,
                              register_table_t *registers,
                              int16_t desired_position)
{
    if (service->completed_pairs == 0u ||
        (registers->byte[REG_SERVO_STATUS] & 0x02u) != 0u) return false;
    bool reverse = (registers->byte[REG_CONFIGURATION_FLAGS] & 0x80u) != 0u;
    int32_t offset;
    if (!encoder_calibration_offset(service->encoder_raw,
                                    reverse, desired_position, &offset)) return false;
    uint16_t encoded;
    /* The factory offset codec stores zero for an unencodable positive
     * calibration difference. RAM tracking still uses the full difference;
     * reset decodes the stored zero, matching the observed edge behavior. */
    if (offset >= 4096) encoded = 0;
    else if (!register_encode_position_offset(offset, &encoded)) return false;
    registers_set_u16(registers, REG_POSITION_CORRECTION, encoded);
    service->runtime_calibration_offset = offset;
    service->runtime_calibration_offset_valid = offset >= 4096;
    encoder_tracker_init(&service->encoder);
    speed_tracker_init(&service->speed);
    int32_t position;
    if (!encoder_tracker_sample(&service->encoder,
                                service->encoder_raw,
                                reverse,
                                offset, registers->byte[REG_OPERATION_MODE], &position)) return false;
    if (register_encode_signed(position, 15u, &encoded))
        registers_set_u16(registers, REG_PRESENT_POSITION, encoded);
    service->measurement.position = position;
    service->measurement.arm_position = encoder_arm_position(&service->encoder);
    service->measurement.speed = 0;
    service->measurement.moving = false;
    return true;
}

void sensor_service_offset_written(sensor_service_t *service)
{
    service->runtime_calibration_offset_valid = false;
    encoder_tracker_init(&service->encoder);
    speed_tracker_init(&service->speed);
}
