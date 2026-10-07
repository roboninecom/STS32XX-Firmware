#include "arm_control.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static arm_config_t config(void)
{
    return (arm_config_t){
        .kp_q8=256, .kd_q8=64, .ki_q8=8,
        .integral_limit=100, .effort_limit=700,
        .velocity_limit=5000, .acceleration_limit=30000,
        .timeout_ms=500, .velocity_filter_q8=64, .ramp_time_ms=30,
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
        .speed_limit=100, .acceleration=30000};
    assert(arm_control_target(&state, 1, target, 0));

    target.sequence=2;
    target.acceleration=30001;
    assert(arm_control_target(&state, 1, target, 0));
    assert(state.motion.acceleration_limit == 30000);
    target.sequence=3;
    target.acceleration=30000;
    target.speed_limit=101;
    assert(!arm_control_target(&state, 1, target, 0));
    assert(state.accepted_sequence == 2);
}

/* Compare clipped requests with explicit boundary requests through the whole
 * trajectory, including same-boundary streaming refreshes and both directions. */
static void clipped_targets(void)
{
    for (int direction = -1; direction <= 1; direction += 2) {
        arm_control_t clipped, explicit;
        arm_control_init(&clipped, 0, 0);
        arm_config_t limits = config();
        limits.position_min_q8 = -100 * 256;
        limits.position_max_q8 = 100 * 256;
        limits.velocity_limit = 500;
        limits.acceleration_limit = 1000;
        assert(arm_control_configure(&clipped, limits));
        assert(arm_control_arm(&clipped, 9, 0, 0));
        explicit = clipped;
        arm_target_t request = {.sequence=1,
            .position_q8=direction < 0 ? INT32_MIN : INT32_MAX,
            .speed_limit=UINT16_MAX, .acceleration=UINT16_MAX};
        arm_target_t boundary = {.sequence=1, .position_q8=direction * 100 * 256,
            .speed_limit=500, .acceleration=1000};
        assert(arm_control_target(&clipped, 9, request, 1));
        assert(arm_control_target(&explicit, 9, boundary, 1));
        assert(memcmp(&clipped, &explicit, sizeof clipped) == 0);
        assert(clipped.accepted_sequence == 1 && clipped.last_command_tick == 1);
        for (unsigned tick = 1; !arm_motion_idle(&clipped.motion); ++tick) {
            assert(tick < 2000);
            arm_motion_step(&clipped.motion, 1);
            arm_motion_step(&explicit.motion, 1);
            if (tick == 50) {
                request.sequence = boundary.sequence = 2;
                assert(arm_control_target(&clipped, 9, request, tick));
                assert(arm_control_target(&explicit, 9, boundary, tick));
            }
            assert(memcmp(&clipped, &explicit, sizeof clipped) == 0);
            int32_t q = arm_motion_position(&clipped.motion);
            assert(q >= limits.position_min_q8 && q <= limits.position_max_q8);
        }
        assert(arm_motion_position(&clipped.motion) == boundary.position_q8);
        arm_control_t before = clipped;
        request.sequence = 3;
        request.speed_limit = 0;
        assert(!arm_control_target(&clipped, 9, request, 2000));
        request.speed_limit = UINT16_MAX;
        request.acceleration = 0;
        assert(!arm_control_target(&clipped, 9, request, 2000));
        request.acceleration = UINT16_MAX;
        assert(!arm_control_target(&clipped, 10, request, 2000));
        request.sequence = 2;
        assert(!arm_control_target(&clipped, 9, request, 2000));
        assert(memcmp(&before, &clipped, sizeof clipped) == 0);
    }
}

static void trajectory_and_session(void)
{
    arm_control_t state;
    arm_control_init(&state, 0, 0);
    assert(arm_control_configure(&state, config()));
    assert(arm_control_arm(&state, 7, 0, 0));
    arm_target_t target = {.position_q8=100*256, .speed_limit=1000,
        .acceleration=30000, .sequence=1};
    assert(!arm_control_target(&state, 8, target, 0));
    assert(arm_control_target(&state, 7, target, 0));
    assert(!arm_control_target(&state, 7, target, 0));

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
    assert(!arm_control_target(&state, 7, target, 305));
    assert(arm_control_arm(&state, 8, 0, 305));
    assert(!arm_control_target(&state, 7, target, 305));
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
    arm_target_t target = {.position_q8=50*256, .speed_limit=500,
        .acceleration=1000, .sequence=1};
    assert(arm_control_target(&state, 1, target, 0));

    for (uint32_t tick=1; tick<50; ++tick) {
        arm_result_t r = arm_control_step(&state, 0, tick, true, false);
        arm_control_applied(&state, 0, false);
        assert(state.integral_effort_q16_ms == 0);
        assert(r.requested_effort <= gains.effort_limit);
    }
    arm_result_t lost = arm_control_step(&state, 0, 501, true, false);
    assert(!lost.active);
    assert(!lost.fresh);
    assert(!arm_control_target(&state, 2, target, 501));
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
        .acceleration=2000, .sequence=1};
    assert(arm_control_target(&state, 9, target, 0));
    assert(!arm_control_target(&state, 9, target, 0));

    assert(arm_control_gravity(&state, 9, 1, 70, 10000, 500, 0));
    int32_t previous_position = 0, previous_speed = 0;
    bool saw_braking = false;
    bool reached = false;
    for (uint32_t tick=1; tick<900; ++tick) {
        if (tick == 50) {
            int32_t before = arm_motion_position(&state.motion);
            int32_t speed = arm_motion_velocity(&state.motion);
            target.position_q8 = 150*256;
            target.sequence = 2;
            assert(arm_control_target(&state, 9, target, tick-1));

            assert(arm_motion_position(&state.motion) == before);
            assert(arm_motion_velocity(&state.motion) == speed);
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
        .acceleration=2000, .sequence=1};
    assert(arm_control_target(&state, 12, target, 0));

    int32_t previous_velocity = 0;
    for (uint32_t tick=1; tick<300; ++tick) {
        if (tick == 70) {
            target.position_q8 = -20*256;
            target.sequence = 2;
            assert(arm_control_target(&state, 12, target, tick-1));
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
    assert(state.expired);
    for (uint32_t tick=372; tick<600; ++tick)
        (void)arm_control_step(&state, 0, tick, true, false);
    arm_result_t held = arm_control_step(&state, 0, 600, true, false);
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
    arm_target_t target = {.speed_limit=400, .acceleration=1800};
    int32_t previous_velocity = 0;
    for (uint32_t tick=1; tick<=510; ++tick) {
        if (tick == 1 || tick % 17 == 0) {
            target.sequence++;
            target.position_q8 = (int32_t)((tick/17+1)*8*256);
            assert(arm_control_target(&state, 19, target, tick-1));
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
                .acceleration=acceleration[profile]};
            assert(arm_control_target(&state, 31, target, tick));

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

static void target_rejection_preserves_motion_and_sequence(void)
{
    arm_control_t state;
    arm_control_init(&state, 0, 0);
    arm_config_t limits=config();
    limits.position_max_q8=100*256;
    assert(arm_control_configure(&state, limits));
    assert(arm_control_arm(&state, 1, 0, 0));
    /* Feasibility includes travel needed to remove the current acceleration. */
    state.motion.position=99LL*((int64_t)1<<36);
    state.motion.velocity=((int64_t)1<<36)/10; /* 100 counts/s */
    arm_motion_t before=state.motion;
    assert(!arm_control_target(&state, 1, (arm_target_t){.sequence=1,
        .position_q8=100*256,.speed_limit=1000,.acceleration=1000},1));
    assert(state.accepted_sequence==0 && state.last_command_tick==0);
    assert(memcmp(&before,&state.motion,sizeof before)==0);
}

static void velocity_arithmetic_extremes(void)
{
    arm_control_t state;
    arm_control_init(&state, -32767, 0);
    arm_config_t limits = config();
    limits.position_min_q8 = -32767 * 256;
    limits.position_max_q8 = 32767 * 256;
    limits.velocity_filter_q8 = 255;
    assert(arm_control_configure(&state, limits));
    assert(arm_control_arm(&state, 1, -32767, 0));
    uint32_t tick = 0;
    for (unsigned n = 0; n < 32; ++n) {
        uint32_t dt = 1 + (n % 2);
        int32_t measured = (n % 3 ? -32767 : 32767) * 256;
        unsigned slot = state.velocity_cursor;
        uint32_t window = state.velocity_window_ms - state.velocity_intervals_ms[slot] + dt;
        int64_t raw = ((int64_t)measured - state.velocity_positions_q8[slot]) * 1000 / window;
        int64_t expected = state.filtered_velocity_q8_s;
        for (unsigned i = 0; i < dt; ++i) {
            int64_t blend = 255 * (raw - expected);
            expected += (blend + (blend > 0 ? 128 : blend < 0 ? -128 : 0)) / 256;
        }
        tick += dt;
        arm_result_t result = arm_control_step(&state, measured / 256, tick, true, false);
        assert(result.fresh && result.measured_velocity_q8_s == expected);
    }
}

int main(void)
{
    velocity_arithmetic_extremes();
    target_rejection_preserves_motion_and_sequence();
    provisional_acceleration_cap();
    clipped_targets();
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
