#ifndef REGISTERS_H
#define REGISTERS_H

#include <stdbool.h>
#include <stdint.h>

enum { REGISTER_COUNT = 88, REGISTER_LAST_READABLE = 86 };

/* Factory wire addresses. Multi-byte names denote their first byte. */
enum {
    REG_FIRMWARE_MAJOR = 0,
    REG_FIRMWARE_MINOR = 1,
    REG_IDENTITY_BYTE2 = 2,
    REG_MODEL_MAJOR = 3,
    REG_REPORTED_MODEL_MINOR = 4,
    REG_ID = 5,
    REG_BAUD_RATE = 6,
    REG_RESERVED7 = 7,
    REG_RESPONSE_STATUS_LEVEL = 8,
    REG_MIN_ANGLE_LIMIT = 9,
    REG_MAX_ANGLE_LIMIT = 11,
    REG_MAX_TEMPERATURE = 13,
    REG_MAX_VOLTAGE = 14,
    REG_MIN_VOLTAGE = 15,
    REG_MAX_TORQUE = 16,
    REG_CONFIGURATION_FLAGS = 18,
    REG_PROTECTION_SHUTDOWN_MASK = 19,
    REG_LED_ALARM_MASK = 20,
    REG_POSITION_P_GAIN = 21,
    REG_POSITION_D_GAIN = 22,
    REG_POSITION_I_GAIN = 23,
    REG_POSITION_PUNCH = 24,
    REG_POSITION_INTEGRAL_CLAMP = 25,
    REG_CLOCKWISE_DEAD_ZONE = 26,
    REG_COUNTERCLOCKWISE_DEAD_ZONE = 27,
    REG_CURRENT_OR_OVERLOAD_THRESHOLD = 28,
    REG_POSITION_SCALING_DIVISOR = 30,
    REG_POSITION_CORRECTION = 31,
    REG_OPERATION_MODE = 33,
    REG_PROTECTIVE_TORQUE = 34,
    REG_PROTECTION_TIME = 35,
    REG_OVERLOAD_TORQUE = 36,
    REG_SPEED_P_GAIN = 37,
    REG_OVERCURRENT_TIME = 38,
    REG_SPEED_I_GAIN = 39,
    REG_TORQUE_ENABLE = 40,
    REG_ACCELERATION = 41,
    REG_TARGET_POSITION = 42,
    REG_GOAL_PWM = 44,
    REG_GOAL_VELOCITY = 46,
    REG_TORQUE_LIMIT = 48,
    REG_UNDOCUMENTED_RUNTIME50 = 50,
    REG_UNDOCUMENTED_RUNTIME51 = 51,
    REG_UNDOCUMENTED_RUNTIME52 = 52,
    REG_UNDOCUMENTED_RUNTIME53 = 53,
    REG_UNDOCUMENTED_RUNTIME54 = 54,
    REG_LOCK = 55,
    REG_PRESENT_POSITION = 56,
    REG_PRESENT_SPEED = 58,
    REG_PRESENT_PWM = 60,
    REG_PRESENT_VOLTAGE = 62,
    REG_PRESENT_TEMPERATURE = 63,
    REG_ASYNC_WRITE_PENDING = 64,
    REG_SERVO_STATUS = 65,
    REG_MOVING = 66,
    REG_ACTIVE_PROFILE_GOAL_POSITION = 67,
    REG_PRESENT_CURRENT = 69,
    REG_ACTIVE_PROFILE_VELOCITY = 71,
    REG_UNDOCUMENTED_STATUS73 = 73,
    REG_UNDOCUMENTED_STATUS74 = 74,
    REG_UNDOCUMENTED_STATUS75 = 75,
    REG_UNDOCUMENTED_STATUS76 = 76,
    REG_UNDOCUMENTED_STATUS77 = 77,
    REG_UNDOCUMENTED_EXTENDED78 = 78,
    REG_UNDOCUMENTED_EXTENDED79 = 79,
    REG_DERIVATIVE_AND_MOVING_DEADBAND = 80,
    REG_DERIVATIVE_SAMPLE_COUNT = 81,
    REG_MOTION_RATE_SCALE = 82,
    REG_MINIMUM_VELOCITY = 83,
    REG_MAXIMUM_VELOCITY = 84,
    REG_MAXIMUM_ACCELERATION = 85,
    REG_ACCELERATION_COEFFICIENT = 86,
    REG_UNDOCUMENTED_87 = 87,
};

typedef struct { uint8_t byte[REGISTER_COUNT]; } register_table_t;

typedef struct {
    uint8_t start;
    uint8_t accepted_count;
    bool any_changed;
} register_write_result_t;

/* Accepted write bytes intersect the inclusive wire-address range. */
static inline bool registers_write_touches(const register_write_result_t *write,
                                           uint8_t first, uint8_t last)
{
    return write->accepted_count != 0u && write->start <= last &&
           (unsigned)write->start + write->accepted_count > first;
}

void registers_factory_defaults(register_table_t *table);
int registers_read(const register_table_t *table, uint8_t start,
                   uint8_t requested, uint8_t *out);
int registers_write(register_table_t *table, uint8_t start,
                    uint8_t requested, const uint8_t *data,
                    register_write_result_t *result);
uint16_t registers_u16(const register_table_t *table, uint8_t start);
void registers_set_u16(register_table_t *table, uint8_t start, uint16_t value);
bool registers_persistent_writable(uint8_t address);

/* Convert values at the control-table boundary; raw wire bytes remain separate. */
bool register_encode_signed(int32_t value, unsigned sign_bit, uint16_t *raw);
int32_t register_decode_signed(uint16_t raw, unsigned sign_bit);
bool register_encode_position_offset(int32_t value, uint16_t *raw);
int32_t register_decode_position_offset(uint16_t raw);

#endif
