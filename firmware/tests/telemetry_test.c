#include "control_adapter.h"

#include <assert.h>
#include <stdio.h>

int main(void)
{
    register_table_t registers = {0};
    registers_factory_defaults(&registers);
    telemetry_input_t input = {
        .position = 200, .speed = -3, .current = -12, .pwm = -250,
        .active_position = 230, .active_speed = 2,
        .relative_origin = 230, .profile_active = true,
    };
    registers.byte[18] = 0x14; /* Signed position, direct velocity units. */
    telemetry_publish_control(&registers, input);
    assert(registers_u16(&registers, 56) == 200);
    assert(registers_u16(&registers, 58) == (0x8000u | 150u));
    assert(registers_u16(&registers, 60) == (0x0400u | 250u));
    assert(registers_u16(&registers, 67) == 230);
    assert(registers_u16(&registers, 69) == (0x8000u | 12u));
    assert(registers_u16(&registers, 71) == 100);
    assert(registers.byte[66] == 1);

    registers.byte[30] = 0;
    telemetry_publish_control(&registers, input);
    assert(registers.byte[30] == 1);

    registers.byte[33] = 3;
    telemetry_publish_control(&registers, input);
    assert(registers_u16(&registers, 56) == 30);
    input.position = 231;
    input.profile_active = false;
    telemetry_publish_control(&registers, input);
    assert(registers_u16(&registers, 56) == (0x8000u | 1u));
    assert(registers.byte[66] == 0);

    /* Mode 3 applies the factory's explicit signed-position bound to both
     * present and active position telemetry. */
    input.active_position = 40000;
    telemetry_publish_control(&registers, input);
    assert(registers_u16(&registers, 67) == 0x7ffeu);

    registers.byte[33] = 0;
    registers.byte[18] = 0;
    input.position = 4097;
    input.active_position = 4098;
    input.speed = 3;
    input.measured_moving = true;
    telemetry_publish_control(&registers, input);
    assert(registers_u16(&registers, 56) == 1);
    assert(registers_u16(&registers, 67) == 2);
    assert(registers_u16(&registers, 58) == 3);
    assert(registers.byte[66] == 1);
    puts("Factory-style control telemetry encoding: OK");
}
