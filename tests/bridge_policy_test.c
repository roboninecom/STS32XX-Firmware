#include "bridge_policy.h"
#include "bridge_output.h"

#include <assert.h>
#include <stdio.h>

static bridge_output_t mapped(bridge_request_t request, bool polarity)
{
    bridge_output_t output;
    assert(bridge_output_map_standard(request, polarity, &output));
    return output;
}

int main(void)
{
    const int16_t efforts[] = {-1000, -970, -969, 0, 969, 970, 1000};
    for (unsigned i = 0; i < sizeof(efforts) / sizeof(efforts[0]); ++i) {
        int16_t expected = efforts[i] < -970 ? -970 :
            efforts[i] > 970 ? 970 : efforts[i];
        bridge_request_t drive = {.action = BRIDGE_DRIVE, .effort = efforts[i]};
        assert(mapped(drive, false).applied_effort == expected);
        assert(mapped(drive, true).applied_effort == expected);
    }
    assert(mapped((bridge_request_t){.action = BRIDGE_COAST}, true).applied_effort == 0);
    assert(mapped((bridge_request_t){.action = BRIDGE_BRAKE}, true).applied_effort == 0);
    bridge_policy_t state;
    bridge_policy_init(&state);
    bridge_request_t request = bridge_policy_apply(&state, 500, 1, false, false);
    assert(request.action == BRIDGE_COAST && !mapped(request, true).gate_enabled);
    request = bridge_policy_apply(&state, 500, 1, true, false);
    assert(request.action == BRIDGE_BRAKE);
    bridge_output_t output = mapped(request, true);
    assert(output.gate_enabled && output.channel_0 == 970 && output.channel_2 == 970);
    request = bridge_policy_apply(&state, -500, 1, true, false);
    assert(request.action == BRIDGE_DRIVE && request.effort == -500);
    output = mapped(request, true);
    assert(output.channel_0 == 500 && output.channel_2 == 0);
    output = mapped(request, false);
    assert(output.channel_0 == 0 && output.channel_2 == 500);
    request = bridge_policy_apply(&state, 2000, 1, true, false);
    assert(mapped(request, true).channel_2 == 970);
    request = bridge_policy_apply(&state, 500, 0, true, false);
    assert(request.action == BRIDGE_COAST);
    request = bridge_policy_apply(&state, 500, 2, true, false);
    assert(request.action == BRIDGE_BRAKE);
    request = bridge_policy_apply(&state, 500, 2, true, false);
    assert(request.action == BRIDGE_DRIVE && request.effort == 0);

    bridge_policy_init(&state);
    request = bridge_policy_apply(&state, 500, 0, true, true);
    assert(request.action == BRIDGE_BRAKE);
    request = bridge_policy_apply(&state, 2000, 1, true, true);
    assert(request.action == BRIDGE_DRIVE && request.effort == 2000);
    request = bridge_policy_apply(&state, 500, 1, false, true);
    assert(request.action == BRIDGE_COAST);
    assert(!bridge_output_map_standard((bridge_request_t){.action = 99}, true, &output));
    puts("Semantic bridge policy and target mapping: OK");
}
