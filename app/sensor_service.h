#ifndef SENSOR_SERVICE_H
#define SENSOR_SERVICE_H

#include "acquisition.h"
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
    acquisition_t acquisition;
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
    uint32_t generation;
    int32_t runtime_calibration_offset;
    bool runtime_calibration_offset_valid;
} sensor_service_t;

/* Cold boot discards runtime-only calibration. Maintenance restart clears
 * acquisition/history after the driver has cancelled all in-flight work,
 * preserving the calibration that remains authoritative until a real reset. */
void sensor_service_init(sensor_service_t *service);
void sensor_service_restart(sensor_service_t *service);
uint32_t sensor_service_begin(sensor_service_t *service, register_table_t *registers);
void sensor_service_encoder_done(sensor_service_t *service,
                                 register_table_t *registers,
                                 uint32_t generation, bool valid, uint16_t raw_angle);
void sensor_service_adc_done(sensor_service_t *service,
                             uint32_t generation, bool valid,
                             const uint16_t samples[3]);
bool sensor_service_publish(sensor_service_t *service,
                            register_table_t *registers,
                            uint8_t motion_rate_scale);
bool sensor_service_calibrate(sensor_service_t *service,
                              register_table_t *registers,
                              int16_t desired_position);
void sensor_service_offset_written(sensor_service_t *service);

#endif
