#ifndef APP_RUNTIME_H
#define APP_RUNTIME_H

#include "control_pipeline.h"
#include "device.h"
#include "bus_service.h"
#include "sensor_driver.h"
#include "sensor_service.h"
#include "storage.h"
#include "output_safety.h"
#include "status_led.h"
#include "arm_control.h"
#include "arm_extension.h"

#include <stdbool.h>
#include <stdint.h>

/* Coalesced foreground command effects, consumed by one fresh control pair.
 * A repeated position write still establishes a new relative-mode origin. */
typedef struct {
    bool pending;
    bool position_goal;
    bool auto_torque;
} pending_motion_t;

typedef struct app_state {
    device_t device;
    bus_service_t bus;
    sensor_driver_t sensors;
    sensor_service_t sensor_service;
    bool sensor_active;
    control_pipeline_t control;
    arm_control_t arm;
    arm_result_t arm_result;
    bool arm_selected;
    uint16_t arm_pending_session; /* Consumed by the next torque-enable attempt. */
    int16_t arm_applied_effort;
    uint32_t arm_sample_tick;
    bool arm_drive_enabled;
    uint16_t arm_feedback_sequence;
    uint8_t arm_feedback[ARM_TUNING_BYTES];
    bool control_initialized;
    pending_motion_t motion;
    bool motion_rejected;
    uint32_t last_good_tick;
    bool stale_reported;
    status_led_t status_led;
    output_safety_t output;
    uint8_t bridge_config;
    storage_mirror_t storage_mirror;
    storage_source_t storage_source;
} app_state_t;


void app_runtime_queue_motion(app_state_t *state, bool position_goal, bool auto_torque);
void app_runtime_reanchor(app_state_t *state, int32_t position);
void app_runtime_service_sensors(app_state_t *state);
void app_runtime_poll(app_state_t *state);
void app_runtime_service_control_pair(app_state_t *state, uint32_t sample_tick);
void app_runtime_revoke_output(app_state_t *state);
/* Coordinates safe flash maintenance and acquisition restart. */
bool app_runtime_commit_storage(app_state_t *state);

#endif
