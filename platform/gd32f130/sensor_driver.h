#ifndef SENSOR_DRIVER_H
#define SENSOR_DRIVER_H

#include <stdbool.h>
#include <stdint.h>
#include "elapsed_clock.h"
#include "sensor_sample.h"

typedef enum { SENSOR_I2C_IDLE, SENSOR_I2C_WRITE_START,
               SENSOR_I2C_WRITE_ADDRESS, SENSOR_I2C_REGISTER_SENT,
               SENSOR_I2C_READ_START, SENSOR_I2C_READ_ADDRESS,
               SENSOR_I2C_RECEIVE } sensor_i2c_phase_t;

/* IRQs share one priority and own in-flight state. Foreground only consumes a
 * completed mailbox under a short interrupt mask, or stops/restarts the driver.
 * DMA buffers are never the foreground-visible sample. No sample queue. */
typedef struct {
    volatile uint16_t adc_dma[3];
    volatile uint8_t encoder_dma[2];
    volatile uint32_t ticks;
    elapsed_clock_t clock;
    uint32_t started_tick;
#ifdef FW_TIMING_PROBE
    uint32_t started_cycles;
    uint16_t tick_late_us;
#endif
    sensor_i2c_phase_t phase;
    volatile bool enabled;
    bool in_flight, encoder_done, adc_done;
    volatile bool recovery_pending;
    uint8_t recovery_cooldown;
    sensor_pair_t completed;
    bool ready;
} sensor_driver_t;

bool sensor_driver_init(sensor_driver_t *driver, bool complementary_output);
/* Stop IRQ/DMA ownership before flash or peripheral reconfiguration. */
void sensor_driver_stop(sensor_driver_t *driver);
bool sensor_driver_restart(sensor_driver_t *driver, bool complementary_output);
uint32_t sensor_driver_ticks(const sensor_driver_t *driver);
/* Foreground-only bus recovery. IRQ error paths just stop and publish failure. */
void sensor_driver_service(sensor_driver_t *driver);
bool sensor_driver_take_pair(sensor_driver_t *driver, sensor_pair_t *pair);

#endif
