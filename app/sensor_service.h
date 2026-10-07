#ifndef SENSOR_SERVICE_H
#define SENSOR_SERVICE_H

#include "sensor_sample.h"
#include "registers.h"
#include "sensing.h"

/* Last accepted pair, in controller units before wire encoding. */
typedef struct {
    int32_t position;
    /* Same validated encoder samples, fractional filter state for arm only. */
    int32_t arm_position;
    int32_t speed;
    int16_t current;
    uint8_t voltage;
    uint8_t temperature;
    bool moving;
} sensor_measurement_t;

typedef struct {
    uint32_t completed_pairs;
    uint16_t encoder_raw;
    encoder_tracker_t encoder;
    speed_tracker_t speed;
    adc_tracker_t adc;
    sensor_measurement_t measurement;
    /* Arm-only validated telemetry. Raw temperature remains authoritative for
     * protection and all legacy register semantics. */
    uint8_t temperature_validated;
    uint8_t temperature_candidate;
    uint8_t temperature_candidate_count;
    bool temperature_valid;
    uint16_t temperature_spikes;
    int32_t runtime_calibration_offset;
    bool runtime_calibration_offset_valid;
} sensor_service_t;

/* Consume a complete driver mailbox; there is no asynchronous app-level join. */
bool sensor_service_accept_pair(sensor_service_t *service, register_table_t *registers,
                                const sensor_pair_t *pair, uint8_t motion_rate_scale);
/* Cold boot clears calibration; maintenance restart preserves it. */
void sensor_service_init(sensor_service_t *service);
void sensor_service_restart(sensor_service_t *service);
bool sensor_service_calibrate(sensor_service_t *service,
                              register_table_t *registers,
                              int16_t desired_position);
void sensor_service_offset_written(sensor_service_t *service);

#endif
