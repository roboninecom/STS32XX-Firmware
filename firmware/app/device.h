#ifndef DEVICE_H
#define DEVICE_H

#include "registers.h"
#include "motion_request.h"

/* Foreground-owned device state. The wire image remains the authoritative
 * backing for unknown bytes and protocol readback during migration. */
typedef struct {
    register_table_t registers;
    motion_limits_t cached_motion_limits;
} device_t;

void device_init(device_t *device, const register_table_t *initial);

#endif
