#include "protection.h"

#include <limits.h>

enum { VOLTAGE_TRIP_SAMPLES = 50, TEMPERATURE_TRIP_SAMPLES = 50,
       TEMPERATURE_HYSTERESIS = 5, PROTECTION_TIME_SCALE = 10,
       STALL_MOTION_RESET = 50 };
enum { ERROR_VOLTAGE = 1u, ERROR_ENCODER = 2u, ERROR_TEMPERATURE = 4u,
       ERROR_CURRENT = 8u, ERROR_STALL = 32u };

static uint16_t magnitude_i16(int16_t value)
{
    return value < 0 ? (uint16_t)(-(int32_t)value) : (uint16_t)value;
}

static int16_t bound_output(int16_t requested, uint16_t configured)
{
    int32_t limit = configured > 1000u ? 1000 : configured;
    if (requested > limit) return (int16_t)limit;
    if (requested < -limit) return (int16_t)-limit;
    return requested;
}

void protection_init(protection_state_t *state)
{
    *state = (protection_state_t){0};
}

static void voltage_step(protection_state_t *state, const protection_config_t *config,
                         protection_result_t *result, uint8_t voltage)
{
    if (voltage > config->voltage_high) {
        if (state->overvoltage_samples > VOLTAGE_TRIP_SAMPLES)
            result->errors |= ERROR_VOLTAGE;
        else ++state->overvoltage_samples;
        return;
    }
    state->overvoltage_samples = 0;
    if (voltage < config->voltage_low) result->errors |= ERROR_VOLTAGE;
    else result->errors &= (uint8_t)~ERROR_VOLTAGE;
}

static void temperature_step(protection_state_t *state,
                             const protection_config_t *config,
                             protection_result_t *result, uint8_t temperature)
{
    uint8_t limit = config->temperature_limit;
    if ((result->errors & ERROR_TEMPERATURE) != 0u) {
        if ((unsigned)temperature + TEMPERATURE_HYSTERESIS < limit)
            result->errors &= (uint8_t)~ERROR_TEMPERATURE;
        return;
    }
    if (temperature > limit) {
        if (state->overtemperature_samples > TEMPERATURE_TRIP_SAMPLES)
            result->errors |= ERROR_TEMPERATURE;
        else ++state->overtemperature_samples;
    } else state->overtemperature_samples = 0;
}

static void current_step(protection_state_t *state, const protection_config_t *config,
                         protection_result_t *result, int16_t current)
{
    uint16_t threshold = config->current_threshold;
    uint16_t duration = (uint16_t)config->current_duration * PROTECTION_TIME_SCALE;
    if (threshold == 0u || duration == 0u) {
        result->errors &= (uint8_t)~ERROR_CURRENT;
        return;
    }
    if (magnitude_i16(current) < threshold) {
        state->overcurrent_samples = 0;
        if (result->torque == 1u)
            result->errors &= (uint8_t)~ERROR_CURRENT;
        return;
    }
    if (state->overcurrent_samples <= duration) ++state->overcurrent_samples;
    else {
        result->errors |= ERROR_CURRENT;
        if ((config->shutdown_mask & ERROR_CURRENT) != 0u)
            result->torque = 0;
    }
}

static void stall_step(protection_state_t *state, const protection_config_t *config,
                       protection_result_t *result, int32_t position, int16_t output)
{
    if (!state->position_initialized) {
        state->position_initialized = true;
        state->last_position = position;
    }
    int64_t delta = (int64_t)position - state->last_position;
    state->last_position = position;
    int64_t motion = (int64_t)state->accumulated_motion + delta;
    if (motion > INT32_MAX) motion = INT32_MAX;
    if (motion < INT32_MIN) motion = INT32_MIN;
    state->accumulated_motion = (int32_t)motion;

    if (result->torque != 1u) {
        state->stall_active = false;
        state->stall_samples = 0;
        state->accumulated_motion = 0;
        result->errors &= (uint8_t)~ERROR_STALL;
        return;
    }
    int16_t start = (int16_t)((uint16_t)config->stall_start * PROTECTION_TIME_SCALE);
    int16_t release = (int16_t)((uint16_t)config->stall_release * PROTECTION_TIME_SCALE);
    if (!state->stall_active) {
        if (magnitude_i16(output) <= (uint16_t)start) return;
        state->stall_active = true;
        state->stall_samples = 0;
        state->stall_start_output = output;
        state->accumulated_motion = 0;
    }
    if ((result->errors & ERROR_STALL) == 0u) {
        if (state->stall_samples != UINT16_MAX) ++state->stall_samples;
        int64_t traveled = state->accumulated_motion;
        if (traveled < 0) traveled = -traveled;
        if (traveled > STALL_MOTION_RESET) {
            state->stall_samples = 0;
            state->stall_active = false;
        } else if (state->stall_samples >
                   (uint16_t)config->stall_duration * PROTECTION_TIME_SCALE) {
            result->errors |= ERROR_STALL;
        }
    }
    if ((output < release && state->stall_start_output > 0) ||
        (output > -release && state->stall_start_output < 0)) {
        state->stall_active = false;
        state->stall_samples = 0;
        result->errors &= (uint8_t)~ERROR_STALL;
    }
}

protection_result_t protection_step(protection_state_t *state,
                                    const protection_config_t *config,
                                    protection_input_t input)
{
    protection_result_t result = {0};
    if (state == 0 || config == 0) return result;
    result.torque = config->torque;
    result.errors = config->errors;
    voltage_step(state, config, &result, input.voltage);
    temperature_step(state, config, &result, input.temperature);
    if (!input.fresh_sensors) result.errors |= ERROR_ENCODER;
    else result.errors &= (uint8_t)~ERROR_ENCODER;
    current_step(state, config, &result, input.current);
    int16_t output = bound_output(input.requested_output,
                                  config->output_limit);
    stall_step(state, config, &result, input.position, output);
    if (result.torque != 1u || !input.fresh_sensors) return result;
    uint8_t active = config->shutdown_mask & result.errors;
    if ((active & (ERROR_VOLTAGE | ERROR_TEMPERATURE | ERROR_ENCODER)) != 0u)
        return result;
    if ((active & ERROR_STALL) != 0u) {
        int16_t release = (int16_t)((uint16_t)config->stall_release *
                                    PROTECTION_TIME_SCALE);
        if (output > release) output = release;
        if (output < -release) output = (int16_t)-release;
    }
    result.output = output;
    return result;
}
