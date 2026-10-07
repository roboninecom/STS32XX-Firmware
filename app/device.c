#include "device.h"
#include "control_adapter.h"

void device_init(device_t *device, const register_table_t *initial)
{
    for (unsigned i = 0; i < REGISTER_COUNT; ++i)
        device->registers.byte[i] = initial->byte[i];
    device->cached_motion_limits = motion_limits_capture(initial);
}
