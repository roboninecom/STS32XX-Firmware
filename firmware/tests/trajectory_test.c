#include "trajectory.h"

#include <assert.h>
#include <stdio.h>

static motion_request_t request(motion_mode_t mode, int32_t goal,
                                int32_t velocity, int32_t acceleration)
{
    motion_request_t result = {0};
    result.mode = mode;
    result.position_goal = goal;
    result.velocity_goal_x10 = velocity;
    result.velocity_limit_x10 = velocity < 0 ? -velocity : velocity;
    result.minimum_velocity_x10 = 500;
    result.acceleration_step = acceleration;
    return result;
}

static void test_reconstruction_position_vector(void)
{
    /* Extracted from reconstruction motion_profile_position_step with
     * position 0 -> 100, velocity 6000, acceleration 100, minimum 500. */
    static const struct { unsigned tick; int64_t position; int32_t velocity; } expected[] = {
        {0, 500, 500}, {1, 1100, 600}, {2, 1800, 700},
        {10, 11000, 1500}, {30, 62000, 3500}, {50, 153000, 5500},
        {59, 206000, 6000}, {60, 212000, 6000}, {100, 452000, 6000},
        {150, 752000, 6000}, {199, 975700, 2300},
        {219, 1000000, 0}, {299, 1000000, 0},
    };
    trajectory_t state;
    trajectory_init(&state, 0);
    motion_request_t goal = request(MOTION_MODE_POSITION, 100, 6000, 100);
    assert(trajectory_set_request(&state, &goal));
    unsigned checkpoint = 0;
    for (unsigned tick = 0; tick < 300; ++tick) {
        trajectory_step(&state);
        if (checkpoint < sizeof(expected) / sizeof(expected[0]) &&
            tick == expected[checkpoint].tick) {
            assert(state.position_q == expected[checkpoint].position);
            assert(state.velocity_q == expected[checkpoint].velocity);
            ++checkpoint;
        }
    }
    assert(checkpoint == sizeof(expected) / sizeof(expected[0]));
}

static void test_reconstruction_reversal_vector(void)
{
    static const struct { unsigned tick; int64_t position; int32_t velocity; } expected[] = {
        {19, 29000, 2400}, {20, 31300, 2300}, {37, 55100, 600},
        {38, 55100, 0}, {39, 54600, -500}, {40, 54000, -600},
        {100, -162900, -6000}, {210, -822900, -6000},
        {211, -828900, -6000}, {212, -834800, -5900},
        {250, -984900, -2100}, {260, -1000000, 0},
        {299, -1000000, 0},
    };
    trajectory_t state;
    trajectory_init(&state, 0);
    motion_request_t goal = request(MOTION_MODE_POSITION, 100, 6000, 100);
    assert(trajectory_set_request(&state, &goal));
    unsigned checkpoint = 0;
    for (unsigned tick = 0; tick < 300; ++tick) {
        if (tick == 20) {
            goal.position_goal = -100;
            assert(trajectory_set_request(&state, &goal));
        }
        trajectory_step(&state);
        if (checkpoint < sizeof(expected) / sizeof(expected[0]) &&
            tick == expected[checkpoint].tick) {
            assert(state.position_q == expected[checkpoint].position);
            assert(state.velocity_q == expected[checkpoint].velocity);
            ++checkpoint;
        }
    }
    assert(checkpoint == sizeof(expected) / sizeof(expected[0]));
}

static void test_rapid_goal_reversals_keep_braking_continuity(void)
{
    /* Reconstruction host trace: 8-count goal changes every six control
     * pairs, 0 -> 160 -> 8, with a reversal before reaching each goal. */
    static const struct { unsigned tick; int64_t position; int32_t velocity; } expected[] = {
        {119, 530000, 6000}, {174, 857200, 5300},
        {178, 877400, 4900}, {179, 882200, 4800},
        {180, 886900, 4700}, {200, 959900, 2700},
        {220, 992900, 700}, {230, 986700, -1200},
        {239, 971400, -2100},
    };
    trajectory_t state;
    trajectory_init(&state, 0);
    motion_request_t goal = request(MOTION_MODE_POSITION, 0, 6000, 100);
    unsigned checkpoint = 0;
    for (unsigned tick = 0; tick < 240; ++tick) {
        if (tick % 6 == 0) {
            unsigned sequence = tick / 6;
            goal.position_goal = sequence < 20 ? (int32_t)sequence * 8 :
                (int32_t)(40 - sequence) * 8;
            assert(trajectory_set_request(&state, &goal));
        }
        trajectory_step(&state);
        if (checkpoint < sizeof(expected) / sizeof(expected[0]) &&
            tick == expected[checkpoint].tick) {
            assert(state.position_q == expected[checkpoint].position);
            assert(state.velocity_q == expected[checkpoint].velocity);
            ++checkpoint;
        }
    }
    assert(checkpoint == sizeof(expected) / sizeof(expected[0]));
}

int main(void)
{
    test_reconstruction_position_vector();
    test_reconstruction_reversal_vector();
    test_rapid_goal_reversals_keep_braking_continuity();
    trajectory_t state;
    trajectory_init(&state, 0);
    motion_request_t goal = request(MOTION_MODE_POSITION, 100, 6000, 100);
    assert(trajectory_set_request(&state, &goal));
    int32_t previous = 0;
    unsigned steps = 0;
    while (state.active && steps < 10000) {
        trajectory_step(&state);
        assert(trajectory_position(&state) >= previous);
        assert(trajectory_position(&state) <= 100);
        assert(trajectory_velocity(&state) >= 0 &&
               trajectory_velocity(&state) <= 6000);
        previous = trajectory_position(&state);
        ++steps;
    }
    assert(steps < 10000 && trajectory_position(&state) == 100);
    assert(trajectory_velocity(&state) == 0);

    goal.position_goal = -20;
    assert(trajectory_set_request(&state, &goal));
    for (steps = 0; state.active && steps < 10000; ++steps) trajectory_step(&state);
    assert(steps < 10000 && trajectory_position(&state) == -20);
    assert(trajectory_velocity(&state) == 0);

    trajectory_init(&state, 0);
    goal.position_goal = 100;
    assert(trajectory_set_request(&state, &goal));
    for (unsigned i = 0; i < 20; ++i) trajectory_step(&state);
    assert(trajectory_velocity(&state) > 0);
    goal.position_goal = -20;
    assert(trajectory_set_request(&state, &goal));
    for (steps = 0; state.active && steps < 10000; ++steps) trajectory_step(&state);
    assert(steps < 10000 && trajectory_position(&state) == -20);
    assert(trajectory_velocity(&state) == 0);

    trajectory_init(&state, 0);
    goal = request(MOTION_MODE_POSITION, 10, 3000, 0);
    assert(trajectory_set_request(&state, &goal));
    for (steps = 0; state.active && steps < 100; ++steps) trajectory_step(&state);
    assert(steps < 100 && trajectory_position(&state) == 10);

    goal = request(MOTION_MODE_POSITION, 20, 0, 100);
    assert(trajectory_set_request(&state, &goal));
    trajectory_step(&state);
    assert(trajectory_position(&state) == 10 && state.active);

    goal = request(MOTION_MODE_VELOCITY, 0, -3000, 100);
    assert(trajectory_set_request(&state, &goal));
    for (steps = 0; state.active && steps < 100; ++steps) trajectory_step(&state);
    assert(steps < 100 && trajectory_velocity(&state) == -3000);
    goal.velocity_goal_x10 = 3000;
    assert(trajectory_set_request(&state, &goal));
    for (steps = 0; state.active && steps < 100; ++steps) trajectory_step(&state);
    assert(steps < 100 && trajectory_velocity(&state) == 3000);

    trajectory_alarm_reanchor(&state, 42);
    assert(trajectory_position(&state) == 42);
    assert(state.goal_q == 42 * TRAJECTORY_POSITION_SCALE);
    assert(trajectory_velocity(&state) == 3000);
    assert(!state.active);

    goal = request(MOTION_MODE_POSITION, 100, 0, 100);
    assert(trajectory_set_request(&state, &goal));
    trajectory_alarm_reanchor(&state, 42);
    assert(trajectory_velocity(&state) == 0);
    assert(state.goal_q == 42 * TRAJECTORY_POSITION_SCALE);

    goal = request(MOTION_MODE_PWM, 0, 0, 0);
    assert(trajectory_set_request(&state, &goal));
    trajectory_step(&state);
    assert(!state.active && trajectory_velocity(&state) == 0);
    goal.mode = (motion_mode_t)4;
    assert(!trajectory_set_request(&state, &goal));
    puts("Portable trajectory stepping: OK");
}
