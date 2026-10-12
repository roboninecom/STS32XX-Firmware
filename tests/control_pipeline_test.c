#include "control_pipeline.h"
#include "control_adapter.h"
#include "bridge_output.h"

#include <assert.h>
#include <stdio.h>

static register_table_t settings(void)
{
    register_table_t registers = {0};
    registers_factory_defaults(&registers);
    registers.byte[40] = 1;
    registers.byte[18] = 1; /* Standard bridge, positive motor polarity. */
    registers.byte[33] = MOTION_MODE_PWM;
    registers.byte[19] = 0x3fu;
    registers.byte[13] = 80;
    registers.byte[14] = 160;
    registers.byte[15] = 40;
    registers.byte[62] = 120;
    registers.byte[63] = 30;
    registers_set_u16(&registers, 48, 970);
    registers_set_u16(&registers, 44, 100);
    return registers;
}

static bool accept(control_pipeline_t *pipeline, register_table_t *registers,
                   const motion_limits_t *limits, bool goal_changed)
{
    motion_request_t request;
    return motion_request_decode_cached(registers, pipeline->relative_origin,
                                        limits, &request) &&
        control_pipeline_accept(pipeline, &request, limits, goal_changed);
}

static control_result_t step(control_pipeline_t *pipeline,
                             register_table_t *registers,
                             control_sample_t sample, bool permit)
{
    controller_settings_t controllers;
    protection_config_t protection;
    controller_settings_decode(registers, &controllers);
    protection_settings_decode(registers, &protection);
    sample.voltage = registers->byte[62];
    sample.temperature = registers->byte[63];
    control_result_t result = control_pipeline_step(
        pipeline, &controllers, &protection, registers->byte[33],
        (registers->byte[18] & 0x20u) != 0u,
        sample, permit);
    protection_result_publish(registers, (protection_result_t){
        .torque = result.torque, .errors = result.errors,
        .output = result.protected_output});
    return result;
}

static void torque_enable_holds_position(void)
{
    /* The shaft is at 2000 after torque-off. Limits must apply to new goals,
     * not to the hold anchor, in both absolute and relative position modes. */
    const struct { uint16_t low, high; int32_t goal; } cases[] = {
        {2064, 2160, 2160}, {1840, 1936, 1840},
        {1936, 2064, 2064}, {0, 0, 2400},
    };
    const uint8_t modes[] = {MOTION_MODE_POSITION, MOTION_MODE_RELATIVE};
    const uint8_t disabled_states[] = {0, 2};
    for (unsigned m = 0; m < sizeof(modes); ++m) {
        for (unsigned d = 0; d < sizeof(disabled_states); ++d) {
            for (unsigned n = 0; n < sizeof(cases) / sizeof(cases[0]); ++n) {
                register_table_t registers = settings();
                registers.byte[33] = modes[m];
                registers.byte[41] = 30;
                registers_set_u16(&registers, 9, 0);
                registers_set_u16(&registers, 11, 0);
                registers_set_u16(&registers, 46, 600);
                motion_limits_t limits = motion_limits_capture(&registers);
                control_pipeline_t pipeline;
                control_pipeline_reanchor(&pipeline, 1997);
                control_sample_t sample = {.position = 1997, .fresh = true};
                registers_set_u16(&registers, 42,
                    modes[m] == MOTION_MODE_POSITION ? 2500 : 503);
                assert(accept(&pipeline, &registers, &limits, true));
                assert(pipeline.request.position_goal == 2500);
                (void)step(&pipeline, &registers, sample, true);

                registers.byte[40] = disabled_states[d];
                (void)step(&pipeline, &registers, sample, true);
                sample.position = 2000; /* Hand movement while disabled. */
                (void)step(&pipeline, &registers, sample, true);
                assert(!pipeline.request_valid);
                assert(pipeline.relative_origin == 2000);
                registers_set_u16(&registers, 9, cases[n].low);
                registers_set_u16(&registers, 11, cases[n].high);

                /* A speed/acceleration update while disabled must not bring
                 * the old position goal back on the subsequent enable. */
                registers.byte[41] = 40;
                registers_set_u16(&registers, 46, 700);
                assert(accept(&pipeline, &registers, &limits, false));
                (void)step(&pipeline, &registers, sample, true);
                registers.byte[40] = 1;
                assert(accept(&pipeline, &registers, &limits, false));
                for (unsigned tick = 0; tick < 600; ++tick) {
                    control_result_t result = step(&pipeline, &registers, sample, true);
                    assert(result.target_position == 2000);
                    assert(result.target_speed == 0);
                    assert(result.requested_output == 0);
                }
                assert(pipeline.relative_origin == 2000);

                /* Limit and speed changes while holding also preserve the
                 * anchor, even when decoding the old register would clamp it. */
                assert(accept(&pipeline, &registers, &limits, false));
                assert(pipeline.request.position_goal == 2000);

                /* A new goal still moves and clamps; relative mode uses the
                 * measured hold origin, not the discarded old goal. */
                int32_t desired = n == 1 ? 1600 : 2400;
                int32_t value = modes[m] == MOTION_MODE_RELATIVE ? desired - 2000 : desired;
                uint16_t encoded;
                assert(register_encode_signed(value, 15, &encoded));
                registers_set_u16(&registers, 42, encoded);
                assert(accept(&pipeline, &registers, &limits, true));
                assert(pipeline.request.position_goal == cases[n].goal);
                assert(pipeline.relative_origin == cases[n].goal);
                for (unsigned tick = 0; tick < 1000; ++tick)
                    (void)step(&pipeline, &registers, sample, true);
                assert(trajectory_position(&pipeline.trajectory) == cases[n].goal);
            }
        }
    }
}

int main(void)
{
    torque_enable_holds_position();
    register_table_t registers = settings();
    motion_limits_t limits = motion_limits_capture(&registers);
    control_pipeline_t pipeline;
    control_pipeline_reanchor(&pipeline, 100);
    control_sample_t sample = {.position = 100, .fresh = true};
    assert(accept(&pipeline, &registers, &limits, false));
    assert(pipeline.limits.rate == 50u);
    assert(pipeline.limits.maximum_velocity == 150u);
    registers.byte[82] = 3u;
    registers.byte[83] = 80u;
    registers.byte[84] = 1u;
    assert(accept(&pipeline, &registers, &limits, false));
    assert(pipeline.limits.rate == 50u);
    assert(pipeline.limits.maximum_velocity == 150u);
    registers.byte[82] = 50u;
    registers.byte[83] = 1u;
    registers.byte[84] = 150u;

    /* A masked voltage/temperature alarm stops the profile at the measured
     * position. The old goal is not resumed until another position write. */
    register_table_t alarm_registers = settings();
    alarm_registers.byte[33] = MOTION_MODE_POSITION;
    alarm_registers.byte[41] = 0;
    registers_set_u16(&alarm_registers, 42, 200);
    registers_set_u16(&alarm_registers, 46, 10);
    motion_limits_t alarm_limits = motion_limits_capture(&alarm_registers);
    control_pipeline_t alarm_pipeline;
    control_pipeline_reanchor(&alarm_pipeline, 100);
    assert(accept(&alarm_pipeline, &alarm_registers, &alarm_limits, true));
    alarm_registers.byte[62] = 20;
    control_result_t alarm_result = step(
        &alarm_pipeline, &alarm_registers, sample, true);
    assert((alarm_result.errors & 1u) != 0u);
    assert(alarm_result.protected_output == 0);
    assert(alarm_result.target_position == sample.position);
    assert(alarm_result.target_speed == 0);
    assert(trajectory_position(&alarm_pipeline.trajectory) == sample.position);
    assert(alarm_pipeline.request.position_goal == sample.position);
    assert(alarm_pipeline.trajectory.velocity_q == 0);
    alarm_registers.byte[62] = 120;
    alarm_result = step(&alarm_pipeline, &alarm_registers, sample, true);
    assert((alarm_result.errors & 1u) == 0u);
    assert(alarm_pipeline.trajectory.position_q ==
           (int64_t)sample.position * TRAJECTORY_POSITION_SCALE);
    registers_set_u16(&alarm_registers, 42, 200);
    assert(accept(&alarm_pipeline, &alarm_registers, &alarm_limits, true));
    assert(alarm_pipeline.request.position_goal == 200);
    assert(alarm_pipeline.trajectory.goal_q ==
           200 * TRAJECTORY_POSITION_SCALE);

    /* A masked alarm suppresses velocity output without restarting its ramp
     * on every sensor pair. Unmasking resumes the already advanced request. */
    register_table_t velocity_registers = settings();
    velocity_registers.byte[33] = MOTION_MODE_VELOCITY;
    velocity_registers.byte[41] = 30;
    registers_set_u16(&velocity_registers, 46, 5000);
    motion_limits_t velocity_limits = motion_limits_capture(&velocity_registers);
    control_pipeline_t velocity_pipeline;
    control_pipeline_reanchor(&velocity_pipeline, 100);
    assert(accept(&velocity_pipeline, &velocity_registers,
                  &velocity_limits, false));
    velocity_registers.byte[62] = 20;
    control_result_t velocity_result = {0};
    for (int i = 0; i < 100; ++i) {
        velocity_result = step(&velocity_pipeline, &velocity_registers,
                               sample, true);
        assert((velocity_result.errors & 1u) != 0u);
        assert(velocity_result.protected_output == 0);
    }
    assert(trajectory_velocity(&velocity_pipeline.trajectory) == 3000);
    velocity_registers.byte[62] = 120;
    velocity_result = step(&velocity_pipeline, &velocity_registers,
                           sample, true);
    assert((velocity_result.errors & 1u) == 0u);
    assert(velocity_result.target_speed > 0);
    assert(velocity_result.protected_output != 0);

    /* A complete control step cannot energize hardware without an explicit
     * platform permit, even when torque and the PWM goal are nonzero. */
    control_result_t result = step(
        &pipeline, &registers, sample, false);
    assert(result.requested_output == 100);
    assert(result.protected_output == 100);
    assert(result.bridge.action == BRIDGE_COAST);

    result = step(&pipeline, &registers, sample, true);
    assert(result.bridge.action != BRIDGE_COAST);
    assert(result.bridge.action == BRIDGE_BRAKE);
    bridge_output_t output;
    assert(bridge_output_map_standard(result.bridge, true, &output));
    assert(output.channel_0 == 970 && output.channel_2 == 970);
    result = step(&pipeline, &registers, sample, true);
    assert(result.bridge.action == BRIDGE_DRIVE);
    assert(bridge_output_map_standard(result.bridge, true, &output));
    assert(output.channel_0 + output.channel_2 == 100);
    uint16_t first_channel = output.channel_0;
    registers.byte[18] ^= 1u;
    result = step(&pipeline, &registers, sample, true);
    assert(bridge_output_map_standard(result.bridge, false, &output));
    assert(output.channel_0 != first_channel);
    registers.byte[18] ^= 1u;

    sample.fresh = false;
    result = step(&pipeline, &registers, sample, true);
    assert(result.protected_output == 0);
    assert(result.bridge.action == BRIDGE_COAST);
    assert((registers.byte[65] & 2u) != 0u);

    sample.fresh = true;
    registers.byte[62] = 20;
    result = step(&pipeline, &registers, sample, true);
    assert(result.protected_output == 0);
    assert((registers.byte[65] & 1u) != 0u);
    registers.byte[62] = 120;
    result = step(&pipeline, &registers, sample, true);
    assert(result.protected_output == 100);
    assert((registers.byte[65] & 1u) == 0u);

    registers.byte[40] = 0;
    result = step(&pipeline, &registers, sample, true);
    assert(result.bridge.action == BRIDGE_COAST);
    assert(!pipeline.request_valid);
    registers.byte[40] = 1;
    result = step(&pipeline, &registers, sample, true);
    assert(result.bridge.action == BRIDGE_COAST);
    assert(accept(&pipeline, &registers, &limits, false));

    /* A mode change needs an accepted new request before any output. */
    registers.byte[33] = MOTION_MODE_VELOCITY;
    result = step(&pipeline, &registers, sample, true);
    assert(result.bridge.action == BRIDGE_COAST);

    registers.byte[33] = MOTION_MODE_RELATIVE;
    registers_set_u16(&registers, 42, 10);
    assert(accept(&pipeline, &registers, &limits, true));
    assert(pipeline.request.position_goal == 110);
    assert(accept(&pipeline, &registers, &limits, false));
    assert(pipeline.request.position_goal == 110);
    assert(accept(&pipeline, &registers, &limits, true));
    assert(pipeline.request.position_goal == 120);

    registers.byte[40] = 2;
    result = step(&pipeline, &registers, sample, true);
    assert(result.bridge.action == BRIDGE_BRAKE);
    assert(bridge_output_map_standard(result.bridge, true, &output));
    assert(output.channel_0 == 970 && output.channel_2 == 970);
    result = step(&pipeline, &registers, sample, true);
    assert(result.bridge.action == BRIDGE_DRIVE && result.bridge.effort == 0);

    puts("Portable control pipeline and final gate: OK");
}
