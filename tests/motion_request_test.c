#include "control_adapter.h"

#include <assert.h>
#include <stdio.h>

int main(void)
{
    register_table_t registers = {0};
    registers_factory_defaults(&registers);
    registers.byte[18] = 8u; /* Zero velocity requests configured maximum. */
    registers.byte[30] = 2u;
    registers.byte[82] = 50u;
    registers.byte[83] = 1u;
    registers.byte[84] = 130u;
    registers.byte[85] = 250u;
    registers.byte[86] = 20u;
    registers_set_u16(&registers, 9, 0);
    registers_set_u16(&registers, 11, 0);
    registers_set_u16(&registers, 42, 0x800au);
    motion_request_t request;
    assert(motion_request_decode(&registers, 100, &request));
    assert(request.mode == MOTION_MODE_POSITION);
    assert(request.position_goal == -20);
    assert(request.velocity_limit_x10 == 65000);
    assert(request.minimum_velocity_x10 == 500);
    assert(request.acceleration_step == 5000);

    registers.byte[33] = 3;
    assert(motion_request_decode(&registers, 100, &request));
    assert(request.position_goal == 80);
    registers_set_u16(&registers, 9, 100);
    registers_set_u16(&registers, 11, 200);
    assert(motion_request_decode(&registers, 100, &request));
    assert(request.position_goal == 100);

    registers.byte[33] = 1;
    registers.byte[18] = 4u; /* Direct velocity units. */
    registers_set_u16(&registers, 46, 0x8005u);
    assert(motion_request_decode(&registers, 0, &request));
    assert(request.velocity_goal_x10 == -500);
    assert(request.velocity_limit_x10 == 500);
    registers_set_u16(&registers, 46, 32767u);
    assert(motion_request_decode(&registers, 0, &request));
    assert(request.velocity_goal_x10 == 65000);

    registers.byte[33] = 2;
    registers.byte[41] = 200u;
    registers.byte[85] = 100u;
    registers_set_u16(&registers, 44, 0x040au);
    assert(motion_request_decode(&registers, 0, &request));
    assert(request.pwm_goal == -10);
    assert(request.acceleration_step == 100);
    assert(request.normalized_acceleration == 100);
    assert(registers.byte[41] == 100u);
    registers.byte[85] = 250u;
    registers.byte[41] = 255u;
    assert(motion_request_decode(&registers, 0, &request));
    assert(registers.byte[41] == 250u);
    assert(request.acceleration_step == 250);
    registers.byte[30] = 0;
    assert(motion_request_decode(&registers, 0, &request));
    assert(request.normalized_divisor == 1);

    registers.byte[33] = 4;
    assert(!motion_request_decode(&registers, 0, &request));
    registers.byte[33] = 0;
    registers_set_u16(&registers, 9, 200);
    registers_set_u16(&registers, 11, 100);
    assert(!motion_request_decode(&registers, 0, &request));
    puts("Portable motion request decoding: OK");
}
