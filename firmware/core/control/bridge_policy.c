#include "bridge_policy.h"

void bridge_policy_init(bridge_policy_t *state)
{
    *state = (bridge_policy_t){0};
}

bridge_request_t bridge_policy_apply(bridge_policy_t *state,
                                     int16_t protected_output,
                                     uint8_t torque,
                                     bool safety_permit,
                                     bool complementary)
{
    bridge_request_t request = {0};
    bool changed = !state->initialized || state->previous_torque != torque ||
                   state->previous_permit != safety_permit;
    state->initialized = true;
    state->previous_torque = torque;
    state->previous_permit = safety_permit;

    if (!safety_permit) return request;
    if (complementary) {
        /* This remains a policy representation only. The target driver rejects
         * complementary configuration until physical qualification. */
        request.action = torque == 0u ? BRIDGE_BRAKE : BRIDGE_DRIVE;
    }
    else {
        if (torque != 1u && torque != 2u) return request;
        request.action = changed ? BRIDGE_BRAKE : BRIDGE_DRIVE;
    }
    if (request.action == BRIDGE_DRIVE && torque == 1u)
        request.effort = protected_output;
    return request;
}
