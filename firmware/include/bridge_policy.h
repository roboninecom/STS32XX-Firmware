#ifndef BRIDGE_POLICY_H
#define BRIDGE_POLICY_H

#include <stdbool.h>
#include <stdint.h>

typedef struct {
    uint8_t previous_torque;
    bool previous_permit;
    bool initialized;
} bridge_policy_t;

typedef enum {
    BRIDGE_COAST = 0,
    BRIDGE_BRAKE,
    BRIDGE_DRIVE,
} bridge_action_t;

/* Electrical period, channel routing and motor polarity belong to the target. */
typedef struct {
    bridge_action_t action;
    int16_t effort;
} bridge_request_t;

void bridge_policy_init(bridge_policy_t *state);
/* Caller must pass the result of the final protection gate, never a raw PID
 * or PWM register. The platform driver alone applies the returned request. */
bridge_request_t bridge_policy_apply(bridge_policy_t *state,
                                     int16_t protected_output,
                                     uint8_t torque,
                                     bool safety_permit,
                                     bool complementary);

#endif
