#include "arm_control.h"

#include <assert.h>
#include <stdio.h>

static arm_config_t config(void)
{
    return (arm_config_t){
        .kp_q8=256, .kd_q8=64, .ki_q8=8,
        .integral_limit=100, .effort_limit=700,
        .velocity_limit=5000, .acceleration_limit=30000,
        .timeout_ms=500, .velocity_filter_q8=64,
        .position_min_q8=-4096*256, .position_max_q8=4096*256,
    };
}

static void provisional_acceleration_cap(void)
{
    arm_control_t state;
    arm_control_init(&state, 0, 0);
    arm_config_t limits = config();
    limits.acceleration_limit = ARM_MAX_ACCELERATION_COUNTS_S2 + 1;
    assert(!arm_control_configure(&state, limits));
    assert(state.config.acceleration_limit == 0);
    limits.acceleration_limit = ARM_MAX_ACCELERATION_COUNTS_S2;
    assert(arm_control_configure(&state, limits));
    assert(arm_control_arm(&state, 1, 0, 0));
    arm_target_t target = {.sequence=1, .position_q8=100*256,
        .speed_limit=100, .acceleration=30000, .braking=30000};
    assert(arm_control_target(&state, 1, target, 0));
    assert(arm_control_start(&state, 1, 0));
    target.sequence=2;
    target.acceleration=30001;
    assert(!arm_control_target(&state, 1, target, 0));
    target.acceleration=30000;
    target.braking=30001;
    assert(!arm_control_target(&state, 1, target, 0));
    assert(state.accepted_sequence == 1);
}

static void trajectory_and_session(void)
{
    arm_control_t state;
    arm_control_init(&state, 0, 0);
    assert(arm_control_configure(&state, config()));
    assert(arm_control_arm(&state, 7, 0, 0));
    arm_segment_t segment = {.position_q8=100*256, .duration_ms=300,
                             .sequence=1};
    assert(!arm_control_submit(&state, 8, segment, 0));
    assert(arm_control_submit(&state, 7, segment, 0));
    assert(!arm_control_submit(&state, 7, segment, 0));
    assert(arm_control_start(&state, 7, 0));
    int32_t previous = 0;
    for (uint32_t tick=1; tick<=300; ++tick) {
        arm_result_t result = arm_control_step(&state, 0, tick, true, false);
        assert(result.active && result.fresh);
        assert(result.reference_position_q8 >= previous);
        assert(result.reference_position_q8 <= 100*256);
        assert(result.requested_effort <= 700);
        previous = result.reference_position_q8;
    }
    assert(previous == 100*256);
    assert(arm_control_step(&state, 0, 301, true, false).holding);
    assert(arm_control_step(&state, 0, 304, true, false).active == false);
    arm_control_disarm(&state);
    assert(!arm_control_start(&state, 7, 305));
    assert(arm_control_arm(&state, 8, 0, 305));
    assert(!arm_control_submit(&state, 7, segment, 305));
}

static void final_output_and_expiry(void)
{
    arm_control_t state;
    arm_control_init(&state, 0, 0);
    arm_config_t gains = config();
    gains.kp_q8 = 0;
    gains.kd_q8 = 0;
    gains.ki_q8 = 256;
    assert(arm_control_configure(&state, gains));
    assert(arm_control_arm(&state, 1, 0, 0));
    arm_segment_t segment = {.position_q8=50*256, .duration_ms=200,
                             .sequence=1, .feedforward=100};
    assert(arm_control_submit(&state, 1, segment, 0));
    assert(arm_control_start(&state, 1, 0));
    for (uint32_t tick=1; tick<50; ++tick) {
        arm_result_t r = arm_control_step(&state, 0, tick, true, false);
        arm_control_applied(&state, 0, false);
        assert(state.integral_effort_q16_ms == 0);
        assert(r.requested_effort <= gains.effort_limit);
    }
    arm_result_t lost = arm_control_step(&state, 0, 501, true, false);
    assert(!lost.active);
    assert(!lost.fresh);
    assert(!arm_control_submit(&state, 2, segment, 501));
}

static void sparse_host_target_planning(void)
{
    arm_control_t state;
    arm_control_init(&state, 0, 0);
    arm_config_t limits = config();
    limits.timeout_ms = 1000;
    assert(arm_control_configure(&state, limits));
    assert(arm_control_arm(&state, 9, 0, 0));
    arm_target_t target = {.position_q8=100*256, .speed_limit=1000,
        .acceleration=2000, .braking=2000, .feedforward=70, .sequence=1};
    assert(arm_control_target(&state, 9, target, 0));
    assert(!arm_control_target(&state, 9, target, 0));
    assert(arm_control_start(&state, 9, 0));
    int32_t previous_position = 0, previous_speed = 0;
    bool saw_braking = false;
    bool reached = false;
    for (uint32_t tick=1; tick<900; ++tick) {
        if (tick == 50) {
            int32_t before = state.start_position_q8;
            int32_t speed = state.start_velocity_q8_s;
            target.position_q8 = 150*256;
            target.sequence = 2;
            assert(arm_control_target(&state, 9, target, tick-1));
            assert(arm_control_start(&state, 9, tick-1));
            assert(state.start_position_q8 == before);
            assert(state.start_velocity_q8_s == speed);
        }
        arm_result_t r = arm_control_step(&state, 0, tick, true, false);
        assert(r.fresh && r.active);
        assert(r.reference_position_q8 >= previous_position);
        assert(r.reference_position_q8 <= 150*256);
        assert(r.reference_velocity_q8_s >= 0);
        assert(r.reference_velocity_q8_s <= 1000*256);
        assert(r.reference_velocity_q8_s - previous_speed <= 2000*256/1000);
        if (previous_speed - r.reference_velocity_q8_s > 2000*256/1000)
            fprintf(stderr, "braking discontinuity tick=%u pos=%ld speed=%ld previous=%ld target=%ld\n",
                tick, (long)r.reference_position_q8, (long)r.reference_velocity_q8_s,
                (long)previous_speed, (long)target.position_q8);
        assert(previous_speed - r.reference_velocity_q8_s <= 2000*256/1000);
        if (r.reference_velocity_q8_s < previous_speed) saw_braking = true;
        previous_position = r.reference_position_q8;
        previous_speed = r.reference_velocity_q8_s;
        if (r.holding && previous_position == 150*256) {
            reached = true;
            assert(r.reference_velocity_q8_s == 0);
            assert(r.feedforward == 70);
            break;
        }
    }
    assert(saw_braking && reached);
    assert(!arm_control_submit(&state, 9, (arm_segment_t){.sequence=3,
        .duration_ms=100}, 900));
}

static void target_reversal_and_timeout(void)
{
    arm_control_t state;
    arm_control_init(&state, 0, 0);
    arm_config_t limits = config();
    limits.timeout_ms = 300;
    assert(arm_control_configure(&state, limits));
    assert(arm_control_arm(&state, 12, 0, 0));
    arm_target_t target = {.position_q8=100*256, .speed_limit=500,
        .acceleration=2000, .braking=2000, .sequence=1};
    assert(arm_control_target(&state, 12, target, 0));
    assert(arm_control_start(&state, 12, 0));
    int32_t previous_velocity = 0;
    for (uint32_t tick=1; tick<300; ++tick) {
        if (tick == 70) {
            target.position_q8 = -20*256;
            target.sequence = 2;
            assert(arm_control_target(&state, 12, target, tick-1));
            assert(arm_control_start(&state, 12, tick-1));
        }
        arm_result_t r = arm_control_step(&state, 0, tick, true, false);
        assert(r.active && r.fresh);
        assert(r.reference_position_q8 >= limits.position_min_q8);
        assert(r.reference_position_q8 <= limits.position_max_q8);
        assert(r.reference_velocity_q8_s - previous_velocity <= 2000*256/1000);
        assert(previous_velocity - r.reference_velocity_q8_s <= 2000*256/1000);
        previous_velocity = r.reference_velocity_q8_s;
    }
    for (uint32_t tick=300; tick<372; ++tick) {
        arm_result_t r = arm_control_step(&state, 0, tick, true, false);
        assert(r.active && r.fresh);
    }
    assert(state.expired && !state.target_active);
    arm_result_t held = arm_control_step(&state, 0, 372, true, false);
    assert(state.armed && held.active && held.holding && held.fresh);
    assert(!arm_control_target(&state, 12, target, 372));
}

static void target_updates_at_sixty_frames(void)
{
    arm_control_t state;
    arm_control_init(&state, 0, 0);
    arm_config_t limits = config();
    limits.timeout_ms = 1000;
    assert(arm_control_configure(&state, limits));
    assert(arm_control_arm(&state, 19, 0, 0));
    arm_target_t target = {.speed_limit=400, .acceleration=1800,
        .braking=1800};
    int32_t previous_velocity = 0;
    for (uint32_t tick=1; tick<=510; ++tick) {
        if (tick == 1 || tick % 17 == 0) {
            target.sequence++;
            target.position_q8 = (int32_t)((tick/17+1)*8*256);
            assert(arm_control_target(&state, 19, target, tick-1));
            assert(arm_control_start(&state, 19, tick-1));
        }
        arm_result_t r = arm_control_step(&state, 0, tick, true, false);
        assert(r.active && r.fresh && !state.expired);
        assert(r.reference_velocity_q8_s <= 400*256);
        assert(r.reference_velocity_q8_s - previous_velocity <= 1800*256/1000+1);
        assert(previous_velocity - r.reference_velocity_q8_s <= 1800*256/1000+1);
        previous_velocity = r.reference_velocity_q8_s;
    }
    assert(state.accepted_sequence >= 29);
}

static void same_tick_fresh_pair_does_not_revoke_control(void)
{
    arm_control_t state;
    arm_control_init(&state, 20, 100);
    assert(arm_control_configure(&state, config()));
    assert(arm_control_arm(&state, 23, 20, 100));
    arm_result_t first = arm_control_step(&state, 20, 100, true, false);
    assert(first.fresh && first.active && first.holding);
    assert(first.reference_position_q8 == 20*256);
    assert(first.requested_effort == 0);
    assert(state.armed && state.overrun_count == 0);
    arm_result_t next = arm_control_step(&state, 20, 101, true, false);
    assert(next.fresh && next.active && state.armed);
    assert(state.overrun_count == 0);
    assert(!arm_control_step(&state, 20, 101, false, false).fresh);
}

static void bridge_effort_matches_encoder_direction(void)
{
    assert(arm_control_flip_effort_polarity(100) == -100);
    assert(arm_control_flip_effort_polarity(-100) == 100);
    assert(arm_control_flip_effort_polarity(0) == 0);
}

static void high_speed_sweep_reference_stays_bounded(void)
{
    static const uint16_t speed[] = {3000, 3000, 6000, 6000};
    static const uint16_t acceleration[] = {15000, 30000, 15000, 30000};
    arm_control_t state;
    arm_control_init(&state, 512, 0);
    arm_config_t limits = config();
    limits.kp_q8 = 2048;
    limits.kd_q8 = 32;
    limits.ki_q8 = 0;
    limits.integral_limit = 0;
    limits.effort_limit = 1000;
    limits.velocity_limit = 6000;
    limits.acceleration_limit = 30000;
    limits.timeout_ms = 2000;
    limits.position_min_q8 = 480*256;
    limits.position_max_q8 = 3616*256;
    assert(arm_control_configure(&state, limits));
    assert(arm_control_arm(&state, 31, 512, 0));
    uint32_t tick = 0;
    int32_t measured = 512;
    uint16_t sequence = 0;
    for (unsigned profile=0; profile<4; ++profile) {
        for (unsigned direction=0; direction<2; ++direction) {
            const int32_t destination = direction == 0 ? 3584 : 512;
            arm_target_t target = {.sequence=++sequence,
                .position_q8=destination*256, .speed_limit=speed[profile],
                .acceleration=acceleration[profile],
                .braking=acceleration[profile]};
            assert(arm_control_target(&state, 31, target, tick));
            assert(arm_control_start(&state, 31, tick));
            int32_t previous_speed = 0;
            bool reached = false;
            for (unsigned step=0; step<1900; ++step) {
                arm_result_t r = arm_control_step(&state, measured, ++tick,
                                                  true, false);
                assert(r.active && r.fresh);
                assert(r.reference_position_q8 >= 480*256);
                assert(r.reference_position_q8 <= 3616*256);
                assert(r.reference_velocity_q8_s <= (int32_t)speed[profile]*256);
                assert(r.reference_velocity_q8_s >= -(int32_t)speed[profile]*256);
                int32_t change = r.reference_velocity_q8_s-previous_speed;
                assert(change <= (int32_t)acceleration[profile]*256/1000+1);
                assert(change >= -(int32_t)acceleration[profile]*256/1000-1);
                previous_speed = r.reference_velocity_q8_s;
                measured = (r.reference_position_q8+128)/256;
                if (r.holding && r.reference_position_q8 == destination*256) {
                    reached = true;
                    assert(r.reference_velocity_q8_s == 0);
                    break;
                }
            }
            assert(reached);
        }
    }
}

int main(void)
{
    provisional_acceleration_cap();
    trajectory_and_session();
    final_output_and_expiry();
    sparse_host_target_planning();
    target_reversal_and_timeout();
    target_updates_at_sixty_frames();
    same_tick_fresh_pair_does_not_revoke_control();
    bridge_effort_matches_encoder_direction();
    high_speed_sweep_reference_stays_bounded();
    puts("arm control OK");
}
