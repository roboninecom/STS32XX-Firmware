#ifndef BRIDGE_DRIVER_H
#define BRIDGE_DRIVER_H

#include "bridge_policy.h"

#include <stdbool.h>
#include <stdint.h>

/* Standard-output board wiring only. Initialization and every failure leave
 * PA6 low and TIMER0 main output disabled. Complementary wiring requires a
 * separate physical qualification before it may be enabled. */
bool bridge_driver_init(uint8_t configuration);
void bridge_driver_disarm(void);
/* Returns the mapped PWM command, not measured torque. The effort is zero on
 * failure, coast or brake and uses the incoming request's sign convention. */
bool bridge_driver_apply(bridge_request_t request, bool motor_polarity,
                         int16_t *applied_effort);

#endif
