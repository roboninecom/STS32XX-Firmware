#ifndef SENSOR_DRIVER_H
#define SENSOR_DRIVER_H

#include <stdbool.h>
#include <stdint.h>
#include "elapsed_clock.h"

typedef enum { SENSOR_I2C_IDLE, SENSOR_I2C_WRITE_START,
               SENSOR_I2C_WRITE_ADDRESS, SENSOR_I2C_REGISTER_SENT,
               SENSOR_I2C_READ_START, SENSOR_I2C_READ_ADDRESS,
               SENSOR_I2C_READ_BYTES, SENSOR_I2C_READ_LOW } sensor_i2c_phase_t;

typedef struct {
    volatile uint16_t adc_dma[3];
    uint32_t ticks;
    elapsed_clock_t clock;
    uint32_t started_tick;
    uint32_t generation;
    sensor_i2c_phase_t phase;
    uint16_t encoder_raw;
    uint8_t encoder_high;
    bool encoder_ready;
    bool encoder_failed;
    bool adc_ready;
    bool adc_failed;
    bool adc_active;
    uint8_t recovery_cooldown;
} sensor_driver_t;

bool sensor_driver_init(sensor_driver_t *driver, bool complementary_output);
/* Cancel in-flight work and reconfigure I2C/ADC after a flash stall. The
 * elapsed cycle clock and bridge-owned TIMER0 configuration are retained. */
bool sensor_driver_restart(sensor_driver_t *driver, bool complementary_output);
bool sensor_driver_timer_tick(sensor_driver_t *driver);
uint32_t sensor_driver_ticks(const sensor_driver_t *driver);
void sensor_driver_begin(sensor_driver_t *driver, uint32_t generation);
void sensor_driver_poll(sensor_driver_t *driver);
bool sensor_driver_take_encoder(sensor_driver_t *driver, uint32_t *generation,
                                bool *valid, uint16_t *raw_angle);
bool sensor_driver_take_adc(sensor_driver_t *driver, uint32_t *generation,
                            bool *valid, uint16_t samples[3]);

#endif
