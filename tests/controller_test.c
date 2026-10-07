#include "controller.h"
#include "control_adapter.h"

#include <assert.h>
#include <stdio.h>

static int16_t position_step(position_controller_t *state,
                             const register_table_t *registers,
                             int32_t measured, int32_t target, bool limited)
{
    controller_settings_t settings;
    controller_settings_decode(registers, &settings);
    return position_controller_step(state, &settings.position,
                                    measured, target, limited);
}

static int16_t velocity_step(velocity_controller_t *state,
                             const register_table_t *registers,
                             int32_t measured, int32_t target)
{
    controller_settings_t settings;
    controller_settings_decode(registers, &settings);
    return velocity_controller_step(state, &settings.velocity,
                                    measured, target);
}

static void test_reconstruction_vectors(void)
{
    static const struct {
        unsigned tick;
        int16_t position_output, velocity_output;
        int32_t position_integrator, velocity_integrator;
    } expected[] = {
        {0, -970, -170, -198, -80},
        {1, -970, -157, 132, -153},
        {4, -970, -117, 1029, -330},
        {49, -731, 46, 1772, -1065},
        {99, 16, 15, -678, -2150},
        {149, 758, -36, 1674, -3255},
        {150, 774, -22, 1772, -3245},
        {199, 39, -66, 4124, -4260},
        {299, -970, -127, 3131, -6330},
    };
    register_table_t registers = {0};
    registers.byte[40] = 1;
    registers.byte[21] = 30;
    registers.byte[22] = 10;
    registers.byte[23] = 5;
    registers.byte[24] = 10;
    registers.byte[25] = 50;
    registers.byte[26] = 2;
    registers.byte[27] = 2;
    registers.byte[80] = 2;
    registers.byte[81] = 5;
    registers.byte[37] = 20;
    registers.byte[39] = 10;
    registers_set_u16(&registers, 48, 970);
    position_controller_t position = {0};
    velocity_controller_t velocity = {0};
    unsigned checkpoint = 0;
    for (unsigned tick = 0; tick < 300; ++tick) {
        int32_t measured = tick < 150 ? (int32_t)tick * 2 :
            300 - ((int32_t)tick - 150) * 2;
        int16_t p = position_step(&position, &registers,
                                             measured, 200, false);
        int16_t v = velocity_step(&velocity, &registers,
                                             (int32_t)(tick * 7u % 120u) - 60,
                                             20);
        if (checkpoint < sizeof(expected) / sizeof(expected[0]) &&
            tick == expected[checkpoint].tick) {
            assert(p == expected[checkpoint].position_output);
            assert(v == expected[checkpoint].velocity_output);
            assert(position.integrator == expected[checkpoint].position_integrator);
            assert(velocity.integrator == expected[checkpoint].velocity_integrator);
            ++checkpoint;
        }
    }
    assert(checkpoint == sizeof(expected) / sizeof(expected[0]));
}

int main(void)
{
    test_reconstruction_vectors();
    register_table_t registers = {0};
    registers_factory_defaults(&registers);
    registers.byte[40] = 1;
    registers_set_u16(&registers, 48, 1000);
    registers.byte[21] = 20;
    registers.byte[22] = 0;
    registers.byte[23] = 0;
    registers.byte[24] = 16;
    registers.byte[26] = 2;
    registers.byte[27] = 2;
    registers.byte[80] = 0;
    registers.byte[81] = 1;

    position_controller_t position;
    position_controller_reset(&position);
    assert(position_step(&position, &registers, 100, 90, false) == 56);
    assert(position_step(&position, &registers, 90, 100, false) == -56);
    assert(position_step(&position, &registers, 91, 90, false) == 0);
    registers.byte[22] = 8;
    assert(position_step(&position, &registers, 100, 90, false) > 56);
    registers.byte[22] = 0;
    registers.byte[21] = 255;
    assert(position_step(&position, &registers, 1000, 0, false) == 1000);
    assert(position.output_residual > 0);
    registers.byte[40] = 0;
    assert(position_step(&position, &registers, 1000, 0, false) == 0);
    assert(position.integrator == 0 && position.output_residual == 0);

    registers.byte[40] = 1;
    registers.byte[37] = 20;
    registers.byte[39] = 0;
    velocity_controller_t velocity;
    velocity_controller_reset(&velocity);
    assert(velocity_step(&velocity, &registers, 100, 90) == 36);
    assert(velocity_step(&velocity, &registers, 90, 100) == -36);
    registers.byte[39] = 100;
    assert(velocity_step(&velocity, &registers, 100, 90) > 36);
    registers_set_u16(&registers, 48, 10);
    assert(velocity_step(&velocity, &registers, 1000, 0) == 10);
    registers.byte[40] = 0;
    assert(velocity_step(&velocity, &registers, 100, 0) == 0);
    assert(velocity.integrator == 0 && velocity.output_residual == 0);

    puts("Portable position PID and velocity PI: OK");
}
