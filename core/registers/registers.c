#include "registers.h"

#include <stddef.h>

static uint8_t permissions(uint8_t address)
{
    if (address <= 3u) return 5u;
    if (address <= 39u) return 7u;
    if (address <= 55u) return 3u;
    if (address <= 77u) return 1u;
    if (address <= 86u) return 7u;
    return 0u;
}

bool registers_persistent_writable(uint8_t address)
{
    return (permissions(address) & 6u) == 6u;
}

uint16_t registers_u16(const register_table_t *table, uint8_t start)
{
    return (uint16_t)table->byte[start] |
           ((uint16_t)table->byte[start + 1u] << 8);
}

void registers_set_u16(register_table_t *table, uint8_t start, uint16_t value)
{
    table->byte[start] = (uint8_t)value;
    table->byte[start + 1u] = (uint8_t)(value >> 8);
}

void registers_factory_defaults(register_table_t *table)
{
    /* Preserve opaque bytes. The caller owns the initial image. */
    table->byte[REG_REPORTED_MODEL_MINOR] = 0;
    table->byte[REG_ID] = 1;
    table->byte[REG_BAUD_RATE] = 0;
    table->byte[REG_RESPONSE_STATUS_LEVEL] = 1;
    registers_set_u16(table, REG_MIN_ANGLE_LIMIT, 0);
    registers_set_u16(table, REG_MAX_ANGLE_LIMIT, 0);
    table->byte[REG_MAX_TEMPERATURE] = 80;
    table->byte[REG_MAX_VOLTAGE] = 80;
    table->byte[REG_MIN_VOLTAGE] = 40;
    registers_set_u16(table, REG_MAX_TORQUE, 1000);
    table->byte[REG_CONFIGURATION_FLAGS] = 32;
    table->byte[REG_PROTECTION_SHUTDOWN_MASK] = 39;
    table->byte[REG_LED_ALARM_MASK] = 39;
    table->byte[REG_POSITION_P_GAIN] = 32;
    table->byte[REG_POSITION_D_GAIN] = 32;
    table->byte[REG_POSITION_I_GAIN] = 4;
    table->byte[REG_POSITION_PUNCH] = 16;
    table->byte[REG_POSITION_INTEGRAL_CLAMP] = 0;
    table->byte[REG_CLOCKWISE_DEAD_ZONE] = 2;
    table->byte[REG_COUNTERCLOCKWISE_DEAD_ZONE] = 2;
    registers_set_u16(table, REG_CURRENT_OR_OVERLOAD_THRESHOLD, 0);
    table->byte[REG_POSITION_SCALING_DIVISOR] = 1;
    registers_set_u16(table, REG_POSITION_CORRECTION, 0);
    table->byte[REG_OPERATION_MODE] = 0;
    table->byte[REG_PROTECTIVE_TORQUE] = 40;
    table->byte[REG_PROTECTION_TIME] = 80;
    table->byte[REG_OVERLOAD_TORQUE] = 80;
    table->byte[REG_SPEED_P_GAIN] = 25;
    table->byte[REG_OVERCURRENT_TIME] = 0;
    table->byte[REG_SPEED_I_GAIN] = 50;
    table->byte[REG_DERIVATIVE_AND_MOVING_DEADBAND] = 2;
    table->byte[REG_DERIVATIVE_SAMPLE_COUNT] = 20;
    table->byte[REG_MOTION_RATE_SCALE] = 50;
    table->byte[REG_MINIMUM_VELOCITY] = 1;
    table->byte[REG_MAXIMUM_VELOCITY] = 150;
    table->byte[REG_MAXIMUM_ACCELERATION] = 100;
    table->byte[REG_ACCELERATION_COEFFICIENT] = 1;
}

static int bounded_count(uint8_t start, uint8_t requested)
{
    if (start > REGISTER_LAST_READABLE) return -1;
    /* Factory's zero-length read at address zero returns the whole table. */
    if (start == 0u && requested == 0u) return 87;
    unsigned available = 87u - (unsigned)start;
    return (int)((unsigned)requested < available ? requested : available);
}

int registers_read(const register_table_t *table, uint8_t start,
                   uint8_t requested, uint8_t *out)
{
    int count = bounded_count(start, requested);
    if (count < 0) return -1;
    for (int i = 0; i < count; ++i) out[i] = table->byte[(unsigned)start + (unsigned)i];
    return count;
}

int registers_write(register_table_t *table, uint8_t start,
                    uint8_t requested, const uint8_t *data,
                    register_write_result_t *result)
{
    int count = bounded_count(start, requested);
    if (count < 0) return -1;
    if (result != NULL) {
        result->start = start;
        result->accepted_count = (uint8_t)count;
        result->any_changed = false;
    }
    for (int i = 0; i < count; ++i) {
        unsigned address = (unsigned)start + (unsigned)i;
        if ((permissions((uint8_t)address) & 2u) == 0u) continue;
        if (result != NULL && table->byte[address] != data[i]) result->any_changed = true;
        table->byte[address] = data[i];
    }
    return count;
}

/* Sign-magnitude values and the factory calibration-offset encoding are
 * distinct wire formats; neither is a two's-complement integer cast. */
bool register_encode_signed(int32_t value, unsigned sign_bit, uint16_t *raw)
{
    if (raw == 0 || (sign_bit != 10u && sign_bit != 15u)) return false;
    int32_t limit = (1 << sign_bit) - 1;
    if (value < -limit || value > limit) return false;
    *raw = (uint16_t)((value < 0 ? -value : value) |
                      (value < 0 ? (1 << sign_bit) : 0));
    return true;
}

int32_t register_decode_signed(uint16_t raw, unsigned sign_bit)
{
    if (sign_bit != 10u && sign_bit != 15u) return 0;
    int32_t magnitude = raw & ((1u << sign_bit) - 1u);
    return (raw & (1u << sign_bit)) != 0u ? -magnitude : magnitude;
}

bool register_encode_position_offset(int32_t value, uint16_t *raw)
{
    if (raw == 0 || value < -4095 || value > 4095) return false;
    int32_t encoded;
    if (value < -2047) encoded = 0x1000 - value;
    else if (value < 0) encoded = 0x0800 - value;
    else if (value < 0x0800) encoded = value;
    else encoded = value + 0x0800;
    *raw = (uint16_t)encoded;
    return true;
}

int32_t register_decode_position_offset(uint16_t raw)
{
    if (raw < 0x0800u) return raw;
    if (raw == 0x0800u) return 0;
    if (raw < 0x1000u) return 0x0800 - (int32_t)raw;
    if (raw < 0x1800u) return (int32_t)raw - 0x0800;
    if (raw < 0x2000u) return 0x1000 - (int32_t)raw;
    return 0;
}
