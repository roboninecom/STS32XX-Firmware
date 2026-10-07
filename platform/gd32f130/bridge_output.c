#include "bridge_output.h"

/* Factory duty cap leaves 30 counts below the 1000-count PWM period. */
enum { STANDARD_DUTY_LIMIT = 970 };

bool bridge_output_map_standard(bridge_request_t request, bool motor_polarity,
                                bridge_output_t *output)
{
    if (output == 0) return false;
    *output = (bridge_output_t){0};
    switch (request.action) {
    case BRIDGE_COAST:
        return true;
    case BRIDGE_BRAKE:
        output->gate_enabled = true;
        output->channel_0 = STANDARD_DUTY_LIMIT;
        output->channel_2 = STANDARD_DUTY_LIMIT;
        return true;
    case BRIDGE_DRIVE: {
        output->gate_enabled = true;
        int32_t effort = request.effort;
        if (effort > STANDARD_DUTY_LIMIT) effort = STANDARD_DUTY_LIMIT;
        if (effort < -STANDARD_DUTY_LIMIT) effort = -STANDARD_DUTY_LIMIT;
        output->applied_effort = (int16_t)effort;
        int32_t duty = motor_polarity ? effort : -effort;
        if (duty < 0) output->channel_0 = (uint16_t)-duty;
        else output->channel_2 = (uint16_t)duty;
        return true;
    }
    default:
        return false;
    }
}
