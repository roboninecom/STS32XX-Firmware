#include "arm_control.h"
#include "elapsed_clock.h"
#include <assert.h>
#include <string.h>
#include <stdio.h>

static arm_control_t setup(uint16_t kp, uint16_t kd, uint16_t ki,
                           uint16_t integral, uint16_t effort)
{
    arm_control_t s;
    arm_control_init(&s,1000,0);
    assert(arm_control_configure(&s,(arm_config_t){.kp_q8=kp,.kd_q8=kd,
        .ki_q8=ki,.integral_limit=integral,.effort_limit=effort,
        .velocity_limit=1000,.acceleration_limit=1000,.gravity_slew=1000,.velocity_filter_q8=64, .ramp_time_ms=30}));
    assert(arm_control_arm(&s,1,1000,0,0,4095));
    return s;
}

static arm_result_t sample(arm_control_t *s,int q,uint32_t t)
{
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
    assert(arm_control_gravity(&s,1,1,80,0));
    for(unsigned t=1;t<=5000;t++) (void)sample(&s,990,t);
    int64_t bias=s.integral_effort_q16_ms;
    arm_result_t r=sample(&s,800,5001);
    assert(r.saturated && r.requested_effort==150);
    assert(s.integral_effort_q16_ms==bias);
    /* A protection clamp below the controller limit must also freeze only
     * outward integration, even if the controller itself isn't saturated. */
    for(unsigned t=5002;t<5102;t++) {
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

static void silence_finishes_motion_and_keeps_position_control(void)
{
    arm_control_t s=setup(256,0,0,0,300);
    arm_control_disarm(&s);
    arm_config_t slow=s.config;slow.gravity_slew=10;
    assert(arm_control_configure(&s,slow));
    assert(arm_control_arm(&s,1,1000,0,0,4095));
    arm_target_t target={.sequence=1,.position_q8=2000*256,
        .speed_limit=100};
    assert(arm_control_target(&s,1,target));
    /* Slewing takes seven seconds: it must finish even without another update. */
    assert(arm_control_gravity(&s,1,1,70,0));
    int measured=1000;
    arm_result_t r={0};
    for(uint32_t t=1;t<=60000;t++) {
        r=sample(&s,measured,t);
        assert(s.armed && r.active && r.fresh);
        measured=r.reference_position_q8/256;
        if(t==3000) assert(!r.holding && r.gravity_feedforward>=29 &&
                          r.gravity_feedforward<=30);
        if(t>=12000) {
            assert(r.holding && r.reference_position_q8==2000*256);
            assert(r.reference_velocity_q8_s==0 && r.velocity_feedforward==0);
            assert(r.gravity_feedforward==70);
        }
    }
    assert(s.accepted_sequence==1 && s.gravity_sequence==1);
    assert(r.requested_effort==70);
    assert(sample(&s,1990,60001).requested_effort==80);
    assert(sample(&s,2010,60002).requested_effort==60); /* Hold is feedback, not fixed PWM. */
    target.sequence=2;target.position_q8=1500*256;
    assert(arm_control_target(&s,1,target));
    assert(arm_control_gravity(&s,1,2,-30,60002));
    arm_control_disarm(&s);
    assert(!s.armed && s.gravity_effort_q16==0 && !s.gravity_received);
    assert(!arm_control_step(&s,2010,60003,true,false).active);
}

static void terminal_references_and_hold_bias(void)
{
    arm_control_t s=setup(0,0,0,0,300);
    arm_target_t target={.sequence=1,.position_q8=1010*256,
        .speed_limit=200};
    assert(arm_control_target(&s,1,target));

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
    assert(arm_control_gravity(&s,1,1,80,0));
    for(unsigned t=1;t<200;t++) {
        arm_result_t r=sample(&s,1000,t);
        assert(r.reference_position_q8==1000*256);
        if(t==1) assert(r.feedforward==1);
        if(t>=100) assert(r.feedforward==80 && r.reference_velocity_q8_s==0);
    }
}

static void configuration_changes_require_disarm(void)
{
    arm_control_t s=setup(256,0,256,100,300);
    for(unsigned t=1;t<=1000;t++) (void)sample(&s,990,t);
    arm_control_t before=s;
    arm_config_t replacement=s.config;
    replacement.kp_q8=512;
    replacement.effort_limit=200;
    assert(!arm_control_configure(&s,replacement));
    assert(memcmp(&s,&before,sizeof s)==0);

    arm_control_disarm(&s);
    assert(arm_control_configure(&s,replacement));
    assert(s.config.kp_q8==512 && s.config.effort_limit==200);
    assert(arm_control_arm(&s,2,990,1000,0,4095));
    assert(s.accepted_sequence==0 && s.gravity_sequence==0);
    assert(s.integral_effort_q16_ms==0);
    assert(arm_control_target(&s,2,(arm_target_t){.sequence=1,
        .position_q8=1010*256,.speed_limit=100}));
    assert(!arm_control_target(&s,1,(arm_target_t){.sequence=2,
        .position_q8=1020*256,.speed_limit=100}));
}

static void gravity_lifecycle(void)
{
    arm_control_t s=setup(0,0,0,0,300);
    assert(!arm_control_gravity(&s,2,1,100,0));
    assert(!arm_control_gravity(&s,1,1,301,0));
    assert(arm_control_gravity(&s,1,1,100,0));
    assert(!arm_control_gravity(&s,1,1,-100,0));
    assert(s.gravity_target==100 && s.accepted_sequence==0);
    for(unsigned t=1;t<=50;t++) assert(sample(&s,1000,t).feedforward==(int)t);
    assert(arm_control_gravity(&s,1,2,200,50));
    for(unsigned t=51;t<=100;t++) (void)sample(&s,1000,t);
    assert(s.gravity_effort_q16==100*65536);
    for(unsigned t=101;t<=10000;t++) (void)sample(&s,1000,t);
    assert(s.gravity_effort_q16==200*65536 && s.gravity_sequence==2);
    arm_control_disarm(&s);
    assert(arm_control_arm(&s,2,1000,10000,0,4095));
    assert(s.gravity_sequence==0 && !s.gravity_received && s.gravity_effort_q16==0);
    assert(!arm_control_gravity(&s,1,3,0,10000));
    assert(arm_control_gravity(&s,2,1,0,10000));
    for(unsigned t=10001;t<=10100;t++) (void)sample(&s,1000,t);
    assert(s.gravity_effort_q16==0);
    arm_control_disarm(&s);
    arm_config_t slow=s.config;slow.gravity_slew=1;
    assert(arm_control_configure(&s,slow));
    assert(arm_control_arm(&s,3,1000,10100,0,4095));
    assert(!s.gravity_received && s.last_feedforward==0);
    s.last_tick=UINT32_MAX-5;
    assert(arm_control_gravity(&s,3,1,-100,UINT32_MAX-5));
    for(unsigned t=1;t<=20;t++) (void)sample(&s,1000,(UINT32_MAX-5)+t);
    assert(s.gravity_effort_q16<0 && s.gravity_effort_q16>-65536);
}

/* Exercise FF changes through the only production configuration entry point. */
static bool configure_ff(arm_control_t *state, arm_velocity_ff_t gains)
{
    arm_config_t config=state->config;
    config.velocity_ff=gains;
    return arm_control_configure(state,config);
}

static void local_velocity_feedforward_lifecycle(void)
{
    for(int direction=-1;direction<=1;direction+=2) {
        arm_control_t s=setup(0,0,0,0,300);
        arm_velocity_ff_t gains={256,512,120};
        assert(!configure_ff(&s,gains));
        arm_control_disarm(&s);
        assert(!configure_ff(&s,(arm_velocity_ff_t){1,1,301}));
        assert(!configure_ff(&s,(arm_velocity_ff_t){1,0,0}));
        assert(configure_ff(&s,gains));
        assert(arm_control_arm(&s,2,1000,0,0,4095));
        arm_target_t target={.sequence=1,.position_q8=(1000+direction*100)*256,
            .speed_limit=200};
        assert(arm_control_target(&s,2,target));

        arm_result_t r={0};
        bool reached=false, saw_cap=false;
        for(unsigned t=1;t<=1200;t++) {
            r=sample(&s,1000,t);
            int expected=(int)((int64_t)(direction>0?256:512)*r.reference_velocity_q8_s/65536);
            if(expected>120) expected=120;
            if(expected< -120) expected=-120;
            assert(r.velocity_feedforward==expected);
            assert(r.feedforward==r.gravity_feedforward+expected);
            assert(r.requested_effort==r.feedforward);
            if(expected==direction*120) saw_cap=true;
            /* Gravity may start while local compensation is already active. */
            if(t==50) assert(arm_control_gravity(&s,2,1,30,50));
            if(t>100) assert(r.gravity_feedforward==30);
            if(t>101 && r.reference_velocity_q8_s==0) reached=true;
        }
        assert(reached && r.velocity_feedforward==0 && r.feedforward==30);
        assert(saw_cap && r.reference_position_q8==target.position_q8);
        arm_control_disarm(&s);
        assert(s.config.velocity_ff.effort_limit==120 && !s.gravity_received);
        assert(arm_control_arm(&s,3,1000,1200,0,4095));
        assert(sample(&s,1000,1201).feedforward==0);
        arm_control_disarm(&s);
        assert(arm_control_configure(&s,s.config));
        assert(s.config.velocity_ff.effort_limit==120);
    }
    /* Combined gravity and local velocity FF obey the final effort cap. */
    arm_control_t s=setup(0,0,0,0,300);
    arm_control_disarm(&s);
    assert(configure_ff(&s,(arm_velocity_ff_t){65535,65535,100}));
    assert(arm_control_arm(&s,2,1000,0,0,4095));
    assert(arm_control_gravity(&s,2,1,250,0));
    assert(arm_control_target(&s,2,(arm_target_t){.sequence=1,
        .position_q8=1010*256,.speed_limit=100}));

    bool clipped=false;
    for(unsigned t=1;t<=600;t++) {
        arm_result_t r=sample(&s,1000,t);
        assert(r.velocity_feedforward>=0 && r.velocity_feedforward<=100);
        if(r.saturated) { clipped=true;assert(r.requested_effort==300); }
    }
    assert(clipped && s.last_feedforward==250);
    /* A lower output limit requires disarmed configuration and fresh FF settings. */
    arm_control_disarm(&s);
    arm_config_t config=s.config;
    config.effort_limit=60;
    assert(!arm_control_configure(&s,config)); /* Reject the entire inconsistent block. */
    assert(s.config.effort_limit==300 && s.config.velocity_ff.effort_limit==100);
    config.velocity_ff=(arm_velocity_ff_t){0};
    assert(arm_control_configure(&s,config));
    assert(s.config.velocity_ff.effort_limit==0);
    assert(!configure_ff(&s,(arm_velocity_ff_t){256,512,120}));
    assert(configure_ff(&s,(arm_velocity_ff_t){256,512,60}));
    assert(arm_control_arm(&s,3,1000,0,0,4095));
    assert(arm_control_target(&s,3,(arm_target_t){.sequence=1,.position_q8=2000*256,
        .speed_limit=200}));
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
    configuration_changes_require_disarm();
    integral_is_bounded_and_unwinds();
    final_output_antiwindup_preserves_bias();
    quantization_does_not_create_large_damping_impulses();
    stationary_one_count_error_does_not_pump_integral();
    silence_finishes_motion_and_keeps_position_control();
    terminal_references_and_hold_bias();
    puts("arm feedback regressions OK");
}
