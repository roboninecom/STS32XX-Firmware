#include "acquisition.h"

#include <assert.h>
#include <stdio.h>

int main(void)
{
    acquisition_t state;
    uint16_t adc[3] = {100, 200, 300};
    uint16_t result[3];
    uint16_t angle;
    acquisition_init(&state);
    uint32_t first = acquisition_begin(&state);
    assert(acquisition_adc_done(&state, first, true, adc));
    assert(!acquisition_take_pair(&state, &angle, result));
    uint32_t second = acquisition_begin(&state);
    assert(state.fault && state.missed_pairs == 1);
    assert(!acquisition_encoder_done(&state, first, true, 200));
    assert(acquisition_encoder_done(&state, second, true, 201));
    assert(!acquisition_encoder_done(&state, second, true, 202));
    assert(acquisition_adc_done(&state, second, true, adc));
    assert(acquisition_take_pair(&state, &angle, result));
    assert(angle == 201 && result[2] == 300);
    assert(!state.fault && state.completed_pairs == 1);
    assert(!acquisition_take_pair(&state, &angle, result));
    state.generation = UINT32_MAX;
    uint32_t wrapped = acquisition_begin(&state);
    assert(wrapped == 0);
    assert(!acquisition_encoder_done(&state, UINT32_MAX, true, 1));
    assert(!acquisition_encoder_done(&state, wrapped, true, 4096));
    assert(state.fault);
    puts("Acquisition rendezvous tests: OK");
}
