#include "output_safety.h"

#include <assert.h>
#include <stdio.h>

static bool permit(output_safety_t *state)
{
    return output_safety_permit(state, true, true, true);
}

int main(void)
{
    output_safety_t state;
    output_safety_init(&state, false);
    assert(state.phase == OUTPUT_FAILED && !permit(&state));
    output_safety_pair_accepted(&state);
    assert(!permit(&state));

    output_safety_init(&state, true);
    for (unsigned i = 0; i < 9; ++i) {
        output_safety_pair_accepted(&state);
        assert(!permit(&state));
    }
    output_safety_pair_accepted(&state);
    assert(permit(&state));
    assert(!output_safety_permit(&state, false, true, true));
    assert(!output_safety_permit(&state, true, false, true));
    assert(!output_safety_permit(&state, true, true, false));

    output_safety_revoke(&state);
    assert(state.phase == OUTPUT_REQUALIFYING && !permit(&state));
    output_safety_begin_maintenance(&state);
    assert(state.phase == OUTPUT_MAINTENANCE && !permit(&state));
    output_safety_pair_accepted(&state);
    assert(state.fresh_pairs == 0);
    output_safety_end_maintenance(&state, true);
    for (unsigned i = 0; i < 10; ++i) output_safety_pair_accepted(&state);
    assert(permit(&state));
    output_safety_begin_maintenance(&state);
    output_safety_end_maintenance(&state, false);
    assert(state.phase == OUTPUT_FAILED);
    output_safety_revoke(&state);
    assert(state.phase == OUTPUT_FAILED);
    output_safety_init(&state, true);
    output_safety_fail(&state);
    for (unsigned i = 0; i < 20; ++i) output_safety_pair_accepted(&state);
    assert(!permit(&state));
    puts("Output lifecycle and requalification: OK");
}
