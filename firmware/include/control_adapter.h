#ifndef CONTROL_ADAPTER_H
#define CONTROL_ADAPTER_H

#include "controller.h"
#include "motion_request.h"
#include "protection.h"
#include "registers.h"

/* Wire layout stays here; portable control code consumes typed values only. */

/* Motion requests and cached limits. */
/* Wire to typed motion boundary. Normalization writes live readback bytes at
 * the same acceptance phase as the prior implementation. */
motion_limits_t motion_limits_capture(const register_table_t *registers);
bool motion_request_decode_cached(register_table_t *registers,
                                  int32_t relative_origin,
                                  const motion_limits_t *limits,
                                  motion_request_t *request);
bool motion_request_decode(register_table_t *registers,
                           int32_t relative_origin,
                           motion_request_t *request);

/* Legacy controller settings. */
void controller_settings_decode(const register_table_t *registers,
                                controller_settings_t *settings);

/* Protection settings and fault publication. */
void protection_settings_decode(const register_table_t *registers,
                                protection_config_t *config);
void protection_result_publish(register_table_t *registers,
                               protection_result_t result);

/* Legacy telemetry publication. */
typedef struct {
    int32_t position;
    int32_t speed;
    int16_t current;
    int16_t pwm;
    int32_t active_position;
    int32_t active_speed;
    int32_t relative_origin;
    bool profile_active;
    bool measured_moving;
} telemetry_input_t;

void telemetry_publish_control(register_table_t *registers,
                               telemetry_input_t input);

#endif
