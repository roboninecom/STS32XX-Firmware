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
        .velocity_filter_q8=64, .ramp_time_ms=30,.position_min_q8=0,.position_max_q8=4095*256}));
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
    assert(arm_control_gravity(&s,1,1,80,10000,100,0));
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
        .speed_limit=100,.acceleration=1000};
    assert(arm_control_target(&s,1,target,0));

    assert(arm_control_gravity(&s,1,1,80,10000,100,0));
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
    assert(arm_control_stop(&s,1,7002));
    assert(s.expired && s.integral_effort_q16_ms==bias && s.last_feedforward==80);
    /* A new session requires disarm/rearm; stop cannot revive an expired one. */
    arm_control_disarm(&s);
    assert(arm_control_arm(&s,2,1000,7002));
    assert(!s.expired && s.integral_effort_q16_ms==0 && s.last_feedforward==0);
    target.sequence=1;
    assert(!arm_control_target(&s,1,target,7002));
    assert(arm_control_target(&s,2,target,7002));
    assert(arm_control_stop(&s,2,7002));
    assert(s.armed && s.accepted_sequence==1 && s.holding);

    s=setup(0,0,0,0,300);
    target.sequence=1;target.position_q8=2000*256;
    assert(arm_control_target(&s,1,target,0));

    for(unsigned t=1;t<=100;t++) r=sample(&s,1000,t);
    int32_t v=r.reference_velocity_q8_s;
    s.last_command_tick=(uint32_t)(101u-2001u);
    r=arm_control_step(&s,1000,101,true,false);
    assert(v-r.reference_velocity_q8_s<=1000*256/1000+1);
}

static void terminal_references_and_hold_bias(void)
{
    arm_control_t s=setup(0,0,0,0,300);
    arm_target_t target={.sequence=1,.position_q8=1010*256,
        .speed_limit=200,.acceleration=1000};
    assert(arm_control_target(&s,1,target,0));

    bool done=false;
    for(unsigned t=1;t<2000;t++) {
        arm_result_t r=sample(&s,1000,t);
        if(r.holding) {
            assert(r.reference_velocity_q8_s==0);
            assert(r.holding);done=true;break;
        }
    }
    assert(done);
    s=setup(0,0,0,0,300);
    assert(arm_control_gravity(&s,1,1,80,1000,100,0));
    for(unsigned t=1;t<200;t++) {
        arm_result_t r=sample(&s,1000,t);
        assert(r.reference_position_q8==1000*256);
        if(t==1) assert(r.feedforward==1);
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
    s.target_active=true;
    assert(!arm_control_commit_profile(&s,1,3,1,3,1002));
    s.target_active=false;s.expired=true;
    assert(arm_control_commit_profile(&s,1,3,1,3,1002));
    assert(s.expired); /* profile commit doesn't rearm an expired session */
    s=setup(256,0,256,100,300);
    assert(arm_control_stage_profile(&s,1,1,1,p));
    assert(arm_control_commit_profile(&s,1,1,1,1,0));
    assert(arm_control_target(&s,1,(arm_target_t){.sequence=2,
        .position_q8=1010*256,.speed_limit=100,.acceleration=100},0));

}

static void gravity_lifecycle(void)
{
    arm_control_t s=setup(0,0,0,0,300);
    assert(!arm_control_gravity(&s,2,1,100,1000,100,0));
    assert(!arm_control_gravity(&s,1,1,301,1000,100,0));
    assert(!arm_control_gravity(&s,1,1,100,0,100,0));
    assert(!arm_control_gravity(&s,1,1,100,1000,501,0));
    assert(arm_control_gravity(&s,1,1,100,1000,100,0));
    assert(!arm_control_gravity(&s,1,1,-100,1000,100,0));
    assert(s.gravity_target==100 && s.accepted_sequence==0);
    for(unsigned t=1;t<=50;t++) assert(sample(&s,1000,t).feedforward==(int)t);
    assert(arm_control_gravity(&s,1,2,200,1000,20,50));
    for(unsigned t=51;t<=100;t++) (void)sample(&s,1000,t);
    assert(s.gravity_stale && s.gravity_effort_q16==70*65536);
    /* Motion heartbeat does not renew gravity; stopping retains load support. */
    assert(arm_control_stop(&s,1,100));
    assert(sample(&s,1000,101).feedforward==70);
    arm_control_disarm(&s);
    assert(arm_control_arm(&s,2,1000,101));
    assert(s.gravity_sequence==0 && !s.gravity_received && s.gravity_effort_q16==0);
    assert(!arm_control_gravity(&s,1,3,0,1000,100,101));
    assert(arm_control_gravity(&s,2,1,0,1000,100,101));
    for(unsigned t=102;t<=200;t++) (void)sample(&s,1000,t);
    assert(s.gravity_effort_q16==0);
    arm_control_disarm(&s);
    assert(arm_control_arm(&s,3,1000,200));
    assert(!s.gravity_received && s.last_feedforward==0);
    s.last_tick=s.last_command_tick=UINT32_MAX-5;
    assert(arm_control_gravity(&s,3,1,-100,1,100,UINT32_MAX-5));
    for(unsigned t=1;t<=20;t++) (void)sample(&s,1000,(UINT32_MAX-5)+t);
    assert(s.gravity_effort_q16<0 && s.gravity_effort_q16>-65536);
}

static void local_velocity_feedforward_lifecycle(void)
{
    for(int direction=-1;direction<=1;direction+=2) {
        for(unsigned stop_kind=0;stop_kind<3;stop_kind++) {
            arm_control_t s=setup(0,0,0,0,300);
            arm_velocity_ff_t gains={256,512,120};
            assert(!arm_control_configure_velocity_ff(&s,gains));
            arm_control_disarm(&s);
            assert(!arm_control_configure_velocity_ff(&s,(arm_velocity_ff_t){1,1,301}));
            assert(!arm_control_configure_velocity_ff(&s,(arm_velocity_ff_t){1,0,0}));
            assert(arm_control_configure_velocity_ff(&s,gains));
            assert(arm_control_arm(&s,2,1000,0));
            arm_target_t target={.sequence=1,.position_q8=(1000+direction*100)*256,
                .speed_limit=200,.acceleration=1000};
            assert(arm_control_target(&s,2,target,0));

            arm_result_t r={0};
            bool reached=false, saw_cap=false;
            for(unsigned t=1;t<=1200;t++) {
                if(t==101 && stop_kind==1) assert(arm_control_stop(&s,2,100));
                if(t==101 && stop_kind==2) s.last_command_tick=101u-2001u;
                if(stop_kind==2 && t>=101) r=arm_control_step(&s,1000,t,true,false);
                else r=sample(&s,1000,t);
                int expected=(int)((int64_t)(direction>0?256:512)*r.reference_velocity_q8_s/65536);
                if(expected>120) expected=120;
                if(expected< -120) expected=-120;
                assert(r.velocity_feedforward==expected);
                assert(r.feedforward==r.gravity_feedforward+expected);
                assert(r.requested_effort==r.feedforward);
                if(expected==direction*120) saw_cap=true;
                /* Gravity may start while local compensation is already active. */
                if(t==50) assert(arm_control_gravity(&s,2,1,30,10000,100,50));
                if(t>100) assert(r.gravity_feedforward==30);
                if(t>101 && r.reference_velocity_q8_s==0) reached=true;
            }
            assert(reached && r.velocity_feedforward==0 && r.feedforward==30);
            if(stop_kind==0) assert(saw_cap && r.reference_position_q8==target.position_q8);
            if(stop_kind==2) assert(s.expired);
            arm_control_disarm(&s);
            assert(s.velocity_ff.effort_limit==120 && !s.gravity_received);
            assert(arm_control_arm(&s,3,1000,1200));
            assert(sample(&s,1000,1201).feedforward==0);
            arm_control_disarm(&s);
            assert(arm_control_configure(&s,s.config));
            assert(s.velocity_ff.effort_limit==0);
        }
    }
    /* Combined gravity and local velocity FF obey the final effort cap. */
    arm_control_t s=setup(0,0,0,0,300);
    arm_control_disarm(&s);
    assert(arm_control_configure_velocity_ff(&s,(arm_velocity_ff_t){65535,65535,100}));
    assert(arm_control_arm(&s,2,1000,0));
    assert(arm_control_gravity(&s,2,1,250,10000,500,0));
    assert(arm_control_target(&s,2,(arm_target_t){.sequence=1,
        .position_q8=1010*256,.speed_limit=100,.acceleration=1000},0));

    bool clipped=false;
    for(unsigned t=1;t<=600;t++) {
        arm_result_t r=sample(&s,1000,t);
        assert(r.velocity_feedforward>=0 && r.velocity_feedforward<=100);
        if(r.saturated) { clipped=true;assert(r.requested_effort==300); }
    }
    assert(clipped && s.last_feedforward==250);
    /* A powered lower-cap profile also bounds local FF without changing gains. */
    s=setup(0,0,0,0,300);
    arm_control_disarm(&s);
    assert(arm_control_configure_velocity_ff(&s,(arm_velocity_ff_t){256,512,120}));
    assert(arm_control_arm(&s,2,1000,0));
    assert(arm_control_stage_profile(&s,2,1,1,(arm_profile_t){0,0,0,0,60,64}));
    assert(arm_control_commit_profile(&s,2,1,1,1,0));
    assert(s.velocity_ff.effort_limit==120 && s.config.effort_limit==60);
    assert(arm_control_target(&s,2,(arm_target_t){.sequence=2,.position_q8=2000*256,
        .speed_limit=200,.acceleration=1000},0));

    for(unsigned t=1;t<=200;t++) {
        arm_result_t r=sample(&s,1000,t);
        assert(r.velocity_feedforward<=60);
        if(t>=80) assert(r.velocity_feedforward==60 && r.requested_effort==60);
    }
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
    gravity_lifecycle();
    local_velocity_feedforward_lifecycle();
    powered_profile_rollback();
    integral_is_bounded_and_unwinds();
    final_output_antiwindup_preserves_bias();
    quantization_does_not_create_large_damping_impulses();
    stationary_one_count_error_does_not_pump_integral();
    expiry_preserves_hold_and_braking();
    terminal_references_and_hold_bias();
    puts("arm feedback regressions OK");
}
