#include "protection.h"
#include "control_adapter.h"

#include <assert.h>
#include <stdio.h>

static register_table_t settings(void)
{
    register_table_t registers = {0};
    registers_factory_defaults(&registers);
    registers.byte[40] = 1;
    registers.byte[19] = 0x3fu;
    registers.byte[13] = 80;
    registers.byte[14] = 160;
    registers.byte[15] = 40;
    registers.byte[62] = 120;
    registers.byte[63] = 30;
    registers_set_u16(&registers, 48, 1000);
    return registers;
}

static int16_t step(protection_state_t *state, register_table_t *registers,
                    protection_input_t input)
{
    protection_config_t config;
    protection_settings_decode(registers, &config);
    input.voltage = registers->byte[62];
    input.temperature = registers->byte[63];
    protection_result_t result = protection_step(state, &config, input);
    protection_result_publish(registers, result);
    return result.output;
}

int main(void)
{
    protection_state_t state;
    protection_input_t input = {.position = 100, .current = 0,
                                .requested_output = 100, .fresh_sensors = true};
    register_table_t registers = settings();
    protection_init(&state);
    assert(step(&state, &registers, input) == 100);
    input.fresh_sensors = false;
    assert(step(&state, &registers, input) == 0);
    assert((registers.byte[65] & 2u) != 0u);

    registers = settings(); protection_init(&state);
    registers.byte[62] = 20;
    assert(step(&state, &registers, input) == 0);
    assert((registers.byte[65] & 1u) != 0u);
    input.fresh_sensors = true;
    registers.byte[62] = 120;
    assert(step(&state, &registers, input) == 100);
    assert((registers.byte[65] & 1u) == 0u);

    registers = settings(); protection_init(&state);
    registers.byte[63] = 90;
    for (unsigned i = 0; i < 54; ++i)
        (void)step(&state, &registers, input);
    assert((registers.byte[65] & 4u) != 0u);
    assert(step(&state, &registers, input) == 0);
    registers.byte[63] = 70;
    assert(step(&state, &registers, input) == 100);

    registers = settings(); protection_init(&state);
    registers_set_u16(&registers, 28, 50);
    registers.byte[38] = 1;
    input.current = 100;
    for (unsigned i = 0; i < 14; ++i)
        (void)step(&state, &registers, input);
    assert((registers.byte[65] & 8u) != 0u);
    assert(registers.byte[40] == 0);
    assert(step(&state, &registers, input) == 0);

    /* The factory keeps its current-trip history while protection is
     * temporarily disabled; re-enabling resumes the same counter. */
    registers = settings(); protection_init(&state);
    registers_set_u16(&registers, 28, 50);
    registers.byte[38] = 1;
    input.current = 100;
    for (unsigned i = 0; i < 10; ++i)
        (void)step(&state, &registers, input);
    assert(state.overcurrent_samples == 10);
    registers_set_u16(&registers, 28, 0);
    (void)step(&state, &registers, input);
    assert(state.overcurrent_samples == 10);
    registers_set_u16(&registers, 28, 50);
    for (unsigned i = 0; i < 3; ++i)
        (void)step(&state, &registers, input);
    assert((registers.byte[65] & 8u) != 0u);

    registers = settings(); protection_init(&state);
    input.current = 0;
    input.requested_output = 100;
    registers.byte[34] = 2;
    registers.byte[35] = 1;
    registers.byte[36] = 1;
    for (unsigned i = 0; i < 13; ++i)
        (void)step(&state, &registers, input);
    assert((registers.byte[65] & 32u) != 0u);
    assert(step(&state, &registers, input) == 20);
    input.position += 60;
    (void)step(&state, &registers, input);
    registers.byte[40] = 0;
    assert(step(&state, &registers, input) == 0);
    assert((registers.byte[65] & 32u) == 0u);
    puts("Portable protection gate: OK");
}
