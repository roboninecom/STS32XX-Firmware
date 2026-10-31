#ifndef PROTECTION_H
#define PROTECTION_H

#include <stdbool.h>
#include <stdint.h>

typedef struct {
    uint8_t torque;
    uint8_t errors;
    uint8_t shutdown_mask;
    uint8_t voltage_high, voltage_low, temperature_limit;
    uint16_t current_threshold;
    uint8_t current_duration;
    uint8_t stall_start, stall_duration, stall_release;
    uint16_t output_limit;
} protection_config_t;

typedef struct {
    uint8_t torque;
    uint8_t errors;
    int16_t output;
} protection_result_t;

typedef struct {
    uint16_t overvoltage_samples;
    uint16_t overtemperature_samples;
    uint16_t overcurrent_samples;
    uint16_t stall_samples;
    int32_t last_position;
    int32_t accumulated_motion;
    int16_t stall_start_output;
    bool position_initialized;
    bool stall_active;
} protection_state_t;

typedef struct {
    int32_t position;
    int16_t current;
    int16_t requested_output;
    uint8_t voltage;
    uint8_t temperature;
    bool fresh_sensors;
} protection_input_t;

void protection_init(protection_state_t *state);
/* Returns the torque/error changes and only output allowed past protection.
 * The register adapter applies visible bytes at the established control phase. */
protection_result_t protection_step(protection_state_t *state,
                                    const protection_config_t *config,
                                    protection_input_t input);

#endif
