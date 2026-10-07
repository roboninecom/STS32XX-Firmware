#include "arm_control.h"
#include "elapsed_clock.h"
#include <assert.h>
#include <stdio.h>

static arm_control_t setup(uint16_t kp, uint16_t kd, uint16_t ki,
                           uint16_t integral, uint16_t effort)
{
    arm_control_t s;
    arm_control_init(&s,1000,0);
    assert(arm_control_configure(&s,(arm_config_t){.kp_q8=kp,.kd_q8=kd,
        .ki_q8=ki,.integral_limit=integral,.effort_limit=effort,
        .velocity_limit=1000,.acceleration_limit=1000,.timeout_ms=2000,
        .velocity_filter_q8=64,.position_min_q8=0,.position_max_q8=4095*256}));
    assert(arm_control_arm(&s,1,1000,0));
    return s;
}

static arm_result_t sample(arm_control_t *s,int q,uint32_t t)
{
    s->last_command_tick=t; /* authenticated heartbeat */
    arm_result_t r=arm_control_step(s,q,t,true,false);
    arm_control_applied(s,r.requested_effort,true);
    return r;
}

static void integral_is_bounded_and_unwinds(void)
{
    arm_control_t s=setup(0,0,256,40,300);
    arm_result_t r={0};
    for(unsigned t=1;t<=20000;t++) r=sample(&s,990,t);
    assert(r.i_term==40 && s.integral_effort_q16_ms==40LL*65536000);
    r=sample(&s,1010,20001);
    assert(r.i_term==39); /* no invisible 16-second backlog */
    for(unsigned t=20002;t<=24000;t++) r=sample(&s,1010,t);
    assert(r.i_term==0);
}

static void final_output_antiwindup_preserves_bias(void)
{
    arm_control_t s=setup(256,0,256,40,150);
    for(unsigned t=1;t<=5000;t++) (void)sample(&s,990,t);
    int64_t bias=s.integral_effort_q16_ms;
    arm_result_t r=sample(&s,800,5001);
    assert(r.saturated && r.requested_effort==150);
    assert(s.integral_effort_q16_ms==bias);
    /* A protection clamp below the controller limit must also freeze only
     * outward integration, even if the controller itself isn't saturated. */
    for(unsigned t=5002;t<5102;t++) {
        s.last_command_tick=t;
        r=arm_control_step(&s,990,t,true,false);
        arm_control_applied(&s,20,true);
        assert(s.integral_effort_q16_ms==bias);
    }
    r=sample(&s,1001,5102);
    assert(s.integral_effort_q16_ms<bias);
    arm_control_applied(&s,0,false);
    assert(s.integral_effort_q16_ms==0);
}

static void quantization_does_not_create_large_damping_impulses(void)
{
    arm_control_t s=setup(3584,32,0,0,300);
    arm_result_t r=sample(&s,1001,1);
    assert(r.measured_velocity_q8_s==8000); /* 31.25, previously 250 */
    assert(r.d_term==-3); /* previously -31 */
    for(unsigned t=2;t<1000;t++) {
        r=sample(&s,1000+(int)(t%2),t);
        assert(r.d_term>=-15 && r.d_term<=15);
        if(t>100) assert(r.measured_velocity_q8_s<4 && r.measured_velocity_q8_s>-4);
    }
    /* Both intervals use elapsed time, including the accepted 2 ms case. */
    r=sample(&s,1000,1001);
    assert(r.fresh && s.velocity_window_ms==9);
}

static void stationary_one_count_error_does_not_pump_integral(void)
{
    arm_control_t s=setup(8*256,32,3*256,80,240);
    s.integral_effort_q16_ms=38LL*65536000;
    for(unsigned t=1;t<=100;t++) (void)sample(&s,999,t);
    int64_t learned=s.integral_effort_q16_ms;
    for(unsigned t=101;t<=10000;t++) {
        arm_result_t r=sample(&s,999,t);
        assert(s.integral_effort_q16_ms==learned);
        assert(r.p_term==8 && r.i_term>=38); /* keep load support and P */
    }
    /* A real displacement beyond the one-count band still gets correction. */
    (void)sample(&s,998,10001);
    assert(s.integral_effort_q16_ms>learned);
    s=setup(8*256,32,3*256,80,240);
    s.integral_effort_q16_ms=-38LL*65536000;
    for(unsigned t=1;t<=100;t++) (void)sample(&s,1001,t);
    learned=s.integral_effort_q16_ms;
    for(unsigned t=101;t<=10000;t++) {
        (void)sample(&s,1001,t);
        assert(s.integral_effort_q16_ms==learned);
    }
    s.config.ki_q8=0;
    (void)sample(&s,1001,10001);
    assert(s.integral_effort_q16_ms==0);
}

static void expiry_preserves_hold_and_braking(void)
{
    arm_control_t s=setup(0,0,256,40,300);
    arm_target_t target={.sequence=1,.position_q8=1000*256,
        .speed_limit=100,.acceleration=1000,.braking=150,.feedforward=80};
    assert(arm_control_target(&s,1,target,0));
    assert(arm_control_start(&s,1,0));
    for(unsigned t=1;t<=5000;t++) (void)sample(&s,990,t);
    arm_result_t r=sample(&s,1000,5001);
    assert(r.requested_effort==120);
    for(unsigned t=5002;t<=7002;t++) {
        r=arm_control_step(&s,1000,t,true,false);
        arm_control_applied(&s,r.requested_effort,true);
    }
    assert(s.expired && r.holding && r.requested_effort==120);
    assert(r.feedforward==80 && r.i_term==40);
    target.sequence=2;
    assert(!arm_control_target(&s,1,target,7002)); /* no silent replay */
    int64_t bias=s.integral_effort_q16_ms;
    assert(!arm_control_takeover(&s,1,1,1,7002));
    assert(!arm_control_takeover(&s,1,0,2,7002));
    assert(arm_control_takeover(&s,1,1,2,7002));
    assert(s.integral_effort_q16_ms==bias && s.last_feedforward==80);
    target.sequence=1;
    assert(!arm_control_target(&s,1,target,7002));
    assert(arm_control_target(&s,2,target,7002));
    assert(arm_control_stop(&s,2,7002));
    assert(!s.target_pending && s.armed && s.accepted_sequence==1);
    assert(!arm_control_start(&s,2,7002)); /* canceled pending start */

    s=setup(0,0,0,0,300);
    target.sequence=1;target.position_q8=2000*256;
    assert(arm_control_target(&s,1,target,0));
    assert(arm_control_start(&s,1,0));
    for(unsigned t=1;t<=100;t++) r=sample(&s,1000,t);
    int32_t v=r.reference_velocity_q8_s;
    s.last_command_tick=(uint32_t)(101u-2001u);
    r=arm_control_step(&s,1000,101,true,false);
    assert(v-r.reference_velocity_q8_s<=150*256/1000+1);
}

static void terminal_references_and_segment_bias(void)
{
    arm_control_t s=setup(0,0,0,0,300);
    arm_target_t target={.sequence=1,.position_q8=1010*256,
        .speed_limit=200,.acceleration=1000,.braking=1000};
    assert(arm_control_target(&s,1,target,0));
    assert(arm_control_start(&s,1,0));
    bool done=false;
    for(unsigned t=1;t<2000;t++) {
        arm_result_t r=sample(&s,1000,t);
        if(r.reference_position_q8==target.position_q8) {
            assert(r.reference_velocity_q8_s==0);
            assert(r.holding);done=true;break;
        }
    }
    assert(done);
    s=setup(0,0,0,0,300);
    assert(arm_control_submit(&s,1,(arm_segment_t){.sequence=1,.duration_ms=100,
        .position_q8=1000*256,.feedforward=80},0));
    /* Old segment contents must not leak into a newly armed trajectory. */
    s.current.feedforward=-200;
    s.current.acceleration_q8_s2=1000*256;
    assert(arm_control_start(&s,1,0));
    for(unsigned t=1;t<200;t++) {
        arm_result_t r=sample(&s,1000,t);
        assert(r.reference_position_q8==1000*256);
        if(t==1) assert(r.feedforward==0);
        if(t>=100) assert(r.feedforward==80 && r.reference_velocity_q8_s==0);
    }
}

static void powered_profile_rollback(void)
{
    arm_control_t s=setup(256,0,256,100,300);
    for(unsigned t=1;t<=1000;t++) (void)sample(&s,990,t);
    int16_t before=s.last_requested_effort;
    arm_profile_t p={512,0,256,100,300,64};
    assert(!arm_control_stage_profile(&s,2,1,1,p));
    assert(!arm_control_stage_profile(&s,1,0,2,p));
    assert(arm_control_stage_profile(&s,1,1,1,p));
    assert(!arm_control_stage_profile(&s,1,1,1,p));
    assert(!arm_control_commit_profile(&s,1,2,1,1,1000));
    assert(arm_control_commit_profile(&s,1,1,1,1,1000));
    assert(s.transition_bias==-10 && s.active_profile==1);
    assert(sample(&s,990,1001).requested_effort==before);
    assert(!arm_control_stage_profile(&s,1,1,2,p));
    before=s.last_requested_effort;
    assert(arm_control_commit_profile(&s,1,2,0,1,1001));
    assert(sample(&s,990,1002).requested_effort==before);
    assert(s.armed && s.active_profile==0);
    assert(!arm_control_commit_profile(&s,1,1,1,1,1002)); /* delayed commit */
    p.effort_limit=5;p.integral_limit=5;
    assert(arm_control_stage_profile(&s,1,1,2,p));
    assert(!arm_control_commit_profile(&s,1,3,1,2,1002));
    assert(s.active_profile==0 && s.config.effort_limit==300);
    p.effort_limit=300;p.integral_limit=100;
    assert(arm_control_stage_profile(&s,1,1,3,p));
    s.target_pending=true;
    assert(!arm_control_commit_profile(&s,1,3,1,3,1002));
    s.target_pending=false;s.expired=true;
    assert(arm_control_commit_profile(&s,1,3,1,3,1002));
    assert(s.expired); /* profile commit doesn't rearm an expired session */
    s=setup(256,0,256,100,300);
    assert(arm_control_stage_profile(&s,1,1,1,p));
    assert(arm_control_commit_profile(&s,1,1,1,1,0));
    assert(arm_control_target(&s,1,(arm_target_t){.sequence=2,
        .position_q8=1010*256,.speed_limit=100,.acceleration=100,.braking=100},0));
    assert(arm_control_start(&s,1,0));
}

static void independent_feedforward_lifecycle(void)
{
    arm_control_t s=setup(0,0,0,0,300);
    assert(!arm_control_feedforward(&s,2,1,100,0,1000,100,0));
    assert(!arm_control_feedforward(&s,1,1,100,1,1000,100,0));
    assert(!arm_control_feedforward(&s,1,1,301,0,1000,100,0));
    assert(!arm_control_feedforward(&s,1,1,100,0,0,100,0));
    assert(!arm_control_feedforward(&s,1,1,100,0,1000,501,0));
    assert(arm_control_feedforward(&s,1,1,100,0,1000,100,0));
    assert(!arm_control_feedforward(&s,1,1,-100,0,1000,100,0));
    assert(s.gravity_target==100 && s.accepted_sequence==0);
    for(unsigned t=1;t<=50;t++) assert(sample(&s,1000,t).feedforward==(int)t);
    assert(arm_control_target(&s,1,(arm_target_t){.sequence=1,
        .position_q8=2000*256,.speed_limit=1000,.acceleration=1000,.braking=1000},50));
    assert(arm_control_start(&s,1,50));
    assert(arm_control_feedforward(&s,1,2,100,100,1000,100,50));
    int32_t previous=s.start_position_q8;
    for(unsigned t=51;t<=100;t++) (void)sample(&s,1000,t);
    assert(s.start_position_q8>previous && s.accepted_sequence==1);
    assert(s.gravity_effort_q16==100*65536 && s.dynamic_effort_q16==50*65536);
    assert(arm_control_feedforward(&s,1,3,200,100,1000,20,100));
    for(unsigned t=101;t<=120;t++) (void)sample(&s,1000,t);
    assert(s.gravity_effort_q16==120*65536);
    for(unsigned t=121;t<=140;t++) (void)sample(&s,1000,t);
    assert(s.feedforward_stale && s.gravity_effort_q16==120*65536);
    assert(s.dynamic_effort_q16==0 && s.target_active); /* heartbeat isn't FF freshness */
    assert(arm_control_feedforward(&s,1,4,50,100,1000,100,140));
    for(unsigned t=141;t<=150;t++) (void)sample(&s,1000,t);
    assert(arm_control_stop(&s,1,150));
    for(unsigned t=151;t<=160;t++) (void)sample(&s,1000,t);
    assert(s.dynamic_effort_q16==0);
    assert(!arm_control_target(&s,1,(arm_target_t){.sequence=2,
        .position_q8=2000*256,.speed_limit=1000,.acceleration=1000,.braking=1000,.feedforward=1},160));
    s.start_velocity_q8_s=0;s.last_reference_velocity_q8_s=0;s.stationary_ms=50;
    assert(arm_control_takeover(&s,1,1,2,160));
    assert(s.feedforward_sequence==0 && s.feedforward_stale);
    assert(!arm_control_feedforward(&s,1,5,0,0,1000,100,160));
    assert(arm_control_feedforward(&s,2,1,0,0,1000,100,160));
    for(unsigned t=161;t<=300;t++) (void)sample(&s,1000,t);
    assert(!s.gravity_effort_q16 && !s.dynamic_effort_q16);
    arm_control_disarm(&s);assert(!s.feedforward_enabled);
    assert(arm_control_arm(&s,3,1000,300));
    assert(!s.feedforward_enabled && s.last_feedforward==0);
    /* Millisecond rollover and small fractional slew remain bounded. */
    s.last_tick=s.last_command_tick=UINT32_MAX-5;
    assert(arm_control_feedforward(&s,3,1,-100,0,1,100,UINT32_MAX-5));
    for(unsigned t=1;t<=20;t++) (void)sample(&s,1000,(UINT32_MAX-5)+t);
    assert(s.gravity_effort_q16<0 && s.gravity_effort_q16>-65536);
}

int main(void)
{
    elapsed_clock_t clock={.last_cycles=UINT32_MAX-23999u};
    elapsed_clock_update(&clock,24000); /* 48,000 cycles across wrap */
    assert(clock.milliseconds==1 && clock.remainder_cycles==0);
    elapsed_clock_update(&clock,24000+5*48000+123);
    assert(clock.milliseconds==6 && clock.remainder_cycles==123);
    clock.milliseconds=UINT32_MAX;
    elapsed_clock_update(&clock,clock.last_cycles+48000);
    assert(clock.milliseconds==0 && clock.remainder_cycles==123);
    arm_control_t stalled=setup(256,0,0,0,100);
    assert(!arm_control_step(&stalled,1000,6,true,false).fresh);
    assert(stalled.overrun_count==5);
    independent_feedforward_lifecycle();
    powered_profile_rollback();
    integral_is_bounded_and_unwinds();
    final_output_antiwindup_preserves_bias();
    quantization_does_not_create_large_damping_impulses();
    stationary_one_count_error_does_not_pump_integral();
    expiry_preserves_hold_and_braking();
    terminal_references_and_segment_bias();
    puts("arm feedback regressions OK");
}
