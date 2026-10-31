#include "control_adapter.h"

#include <limits.h>

/* Motion requests and cached limits. */
enum { POSITION_ABSOLUTE_LIMIT = 0x7fffff };

static int32_t clamp_i64(int64_t value, int32_t low, int32_t high)
{
    if (value < low) return low;
    if (value > high) return high;
    return (int32_t)value;
}

static int32_t signed_limit(int64_t value, int32_t minimum, int32_t maximum)
{
    if (value == 0) return 0;
    if (value < 0) return -clamp_i64(-value, minimum, maximum);
    return clamp_i64(value, minimum, maximum);
}

motion_limits_t motion_limits_capture(const register_table_t *registers)
{
    motion_limits_t limits = {0};
    if (registers != 0) {
        limits.rate = registers->byte[REG_MOTION_RATE_SCALE];
        limits.minimum_velocity = registers->byte[REG_MINIMUM_VELOCITY];
        limits.maximum_velocity = registers->byte[REG_MAXIMUM_VELOCITY];
    }
    return limits;
}

bool motion_request_decode_cached(register_table_t *registers,
                                  int32_t relative_origin,
                                  const motion_limits_t *limits,
                                  motion_request_t *request)
{
    if (registers == 0 || limits == 0 || request == 0 ||
        registers->byte[REG_OPERATION_MODE] > 3u) return false;
    motion_request_t result = {0};
    result.mode = (motion_mode_t)registers->byte[REG_OPERATION_MODE];
    uint8_t rate = limits->rate == 0u ? 1u : limits->rate;
    int32_t minimum = (int32_t)limits->minimum_velocity * rate * 10;
    int32_t maximum = (int32_t)limits->maximum_velocity * 500;
    if (maximum == 0 || minimum > maximum) return false;
    result.minimum_velocity_x10 = minimum;
    uint8_t limit = registers->byte[REG_MAXIMUM_ACCELERATION];
    uint8_t acceleration = registers->byte[REG_ACCELERATION];
    if (acceleration == 0u) {
        result.acceleration_step = (int32_t)registers->byte[REG_ACCELERATION_COEFFICIENT] * limit;
    } else {
        if (limit != 0u && acceleration > limit) {
            acceleration = limit;
            registers->byte[REG_ACCELERATION] = acceleration;
        }
        result.acceleration_step = acceleration;
    }
    result.normalized_acceleration = acceleration;
    result.normalized_divisor = registers->byte[REG_POSITION_SCALING_DIVISOR] == 0u ? 1u : registers->byte[REG_POSITION_SCALING_DIVISOR];

    int32_t signed_position = register_decode_signed(
        registers_u16(registers, REG_TARGET_POSITION), 15u);
    int64_t position = (int64_t)signed_position * result.normalized_divisor;
    if (result.mode == MOTION_MODE_RELATIVE) position += relative_origin;
    result.position_goal = clamp_i64(position,
                                     -POSITION_ABSOLUTE_LIMIT,
                                     POSITION_ABSOLUTE_LIMIT);
    uint16_t low = registers_u16(registers, REG_MIN_ANGLE_LIMIT);
    uint16_t high = registers_u16(registers, REG_MAX_ANGLE_LIMIT);
    if (low != high) {
        if (low > high) return false;
        result.position_goal = clamp_i64(result.position_goal, low, high);
    }

    int32_t signed_velocity = register_decode_signed(
        registers_u16(registers, REG_GOAL_VELOCITY), 15u);
    int64_t scale = (registers->byte[REG_CONFIGURATION_FLAGS] & 4u) != 0u ? 10 : (int64_t)rate * 10;
    result.velocity_goal_x10 = signed_limit((int64_t)signed_velocity * scale,
                                             minimum, maximum);
    if (signed_velocity == 0) {
        result.velocity_limit_x10 = (registers->byte[REG_CONFIGURATION_FLAGS] & 8u) != 0u
            ? maximum : 0;
    } else {
        int64_t magnitude = signed_velocity < 0
            ? -(int64_t)signed_velocity : signed_velocity;
        result.velocity_limit_x10 = clamp_i64(magnitude * scale,
                                                minimum, maximum);
    }
    result.pwm_goal = (int16_t)register_decode_signed(
        registers_u16(registers, REG_GOAL_PWM), 10u);
    *request = result;
    return true;
}

bool motion_request_decode(register_table_t *registers,
                           int32_t relative_origin,
                           motion_request_t *request)
{
    motion_limits_t limits = motion_limits_capture(registers);
    return motion_request_decode_cached(registers, relative_origin,
                                        &limits, request);
}

/* Legacy controller settings. */
void controller_settings_decode(const register_table_t *registers,
                                controller_settings_t *settings)
{
    settings->position = (position_controller_config_t){
        .torque_enabled = registers->byte[REG_TORQUE_ENABLE] == 1u,
        .integrator_allowed =
            (registers->byte[REG_PROTECTION_SHUTDOWN_MASK] & registers->byte[REG_SERVO_STATUS]) == 0u,
        .kp = registers->byte[REG_POSITION_P_GAIN],
        .kd = registers->byte[REG_POSITION_D_GAIN],
        .ki = registers->byte[REG_POSITION_I_GAIN],
        .bias = registers->byte[REG_POSITION_PUNCH],
        .integral_limit = registers->byte[REG_POSITION_INTEGRAL_CLAMP],
        .positive_deadband = registers->byte[REG_CLOCKWISE_DEAD_ZONE],
        .negative_deadband = registers->byte[REG_COUNTERCLOCKWISE_DEAD_ZONE],
        .derivative_deadband = registers->byte[REG_DERIVATIVE_AND_MOVING_DEADBAND],
        .derivative_period = registers->byte[REG_DERIVATIVE_SAMPLE_COUNT],
        .output_limit = registers_u16(registers, REG_TORQUE_LIMIT),
    };
    settings->velocity = (velocity_controller_config_t){
        .torque_enabled = registers->byte[REG_TORQUE_ENABLE] == 1u,
        .kp = registers->byte[REG_SPEED_P_GAIN],
        .ki = registers->byte[REG_SPEED_I_GAIN],
        .bias = registers->byte[REG_POSITION_PUNCH],
        .output_limit = registers_u16(registers, REG_TORQUE_LIMIT),
    };
}

/* Protection settings and fault publication. */
void protection_settings_decode(const register_table_t *registers,
                                protection_config_t *config)
{
    *config = (protection_config_t){
        .torque = registers->byte[REG_TORQUE_ENABLE],
        .errors = registers->byte[REG_SERVO_STATUS],
        .shutdown_mask = registers->byte[REG_PROTECTION_SHUTDOWN_MASK],
        .voltage_high = registers->byte[REG_MAX_VOLTAGE],
        .voltage_low = registers->byte[REG_MIN_VOLTAGE],
        .temperature_limit = registers->byte[REG_MAX_TEMPERATURE],
        .current_threshold = registers_u16(registers, REG_CURRENT_OR_OVERLOAD_THRESHOLD),
        .current_duration = registers->byte[REG_OVERCURRENT_TIME],
        .stall_start = registers->byte[REG_OVERLOAD_TORQUE],
        .stall_duration = registers->byte[REG_PROTECTION_TIME],
        .stall_release = registers->byte[REG_PROTECTIVE_TORQUE],
        .output_limit = registers_u16(registers, REG_TORQUE_LIMIT),
    };
}

void protection_result_publish(register_table_t *registers,
                               protection_result_t result)
{
    registers->byte[REG_SERVO_STATUS] = result.errors;
    registers->byte[REG_TORQUE_ENABLE] = result.torque;
}

/* Legacy telemetry publication. */
static void put_signed(register_table_t *registers, uint8_t address,
                       int64_t value, unsigned sign_bit)
{
    int32_t limit = (1 << sign_bit) - 1;
    uint16_t encoded = 0;
    (void)register_encode_signed(clamp_i64(value, -limit, limit),
                                 sign_bit, &encoded);
    registers_set_u16(registers, address, encoded);
}

void telemetry_publish_control(register_table_t *registers,
                               telemetry_input_t input)
{
    if (registers == 0) return;
    uint8_t divisor = registers->byte[REG_POSITION_SCALING_DIVISOR] == 0u ? 1u : registers->byte[REG_POSITION_SCALING_DIVISOR];
    registers->byte[REG_POSITION_SCALING_DIVISOR] = divisor;
    uint8_t mode = registers->byte[REG_OPERATION_MODE];
    uint8_t flags = registers->byte[REG_CONFIGURATION_FLAGS];
    if (mode == 3u) {
        int64_t relative = (int64_t)input.relative_origin - input.position;
        put_signed(registers, 56, clamp_i64(relative / divisor,
                                            -32766, 32766), 15u);
        put_signed(registers, 67, clamp_i64(input.active_position / divisor,
                                            -32766, 32766), 15u);
    } else if ((flags & 0x10u) != 0u) {
        put_signed(registers, 56, input.position / divisor, 15u);
        put_signed(registers, 67, input.active_position / divisor, 15u);
    } else {
        registers_set_u16(registers, REG_PRESENT_POSITION, (uint16_t)input.position & 0x0fffu);
        registers_set_u16(registers, REG_ACTIVE_PROFILE_GOAL_POSITION,
                          (uint16_t)input.active_position & 0x0fffu);
    }
    int64_t speed_scale = (flags & 0x04u) != 0u ? 50 : 1;
    put_signed(registers, 58, (int64_t)input.speed * speed_scale, 15u);
    put_signed(registers, 71, (int64_t)input.active_speed * speed_scale, 15u);
    put_signed(registers, 60, input.pwm, 10u);
    put_signed(registers, 69, input.current, 15u);
    registers->byte[REG_MOVING] =
        (mode == 0u || mode == 3u) && input.profile_active ? 1u :
        input.measured_moving ? 1u : 0u;
}
