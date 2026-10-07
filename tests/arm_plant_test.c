/* Synthetic, uncertain effort-driven joint. Uses the production controller,
 * integer encoder samples, friction and delayed actuation. Parameters are a
 * regression envelope, NOT an identified SO-102 plant or hardware gains. */
#include "arm_control.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>

static void run(double authority, double gravity, double friction, unsigned delay)
{
    arm_control_t s;
    arm_control_init(&s,1000,0);
    assert(arm_control_configure(&s,(arm_config_t){
        .kp_q8=1024,.kd_q8=128,.ki_q8=512,.integral_limit=150,
        .effort_limit=350,.velocity_limit=120,.acceleration_limit=400,
        .timeout_ms=2000,.velocity_filter_q8=64,
        .position_min_q8=500*256,.position_max_q8=1500*256}));
    assert(arm_control_arm(&s,1,1000,0));
    double q=1000, v=0, effort_delay[5]={0};
    unsigned cursor=0,tick=0;
    for (unsigned leg=0;leg<3;leg++) {
        const int target=leg==1?1032:1000;
        assert(arm_control_target(&s,1,(arm_target_t){.sequence=leg*2+1,
            .position_q8=target*256,.speed_limit=120,.acceleration=400,
            .braking=400},tick));
        assert(arm_control_start(&s,1,tick));
        double low=1e9,high=-1e9,absolute_error=0;
        for (unsigned n=0;n<15000;n++) {
            if (n==14000 && leg==0) {
                assert(arm_control_stage_profile(&s,1,1,1,
                    (arm_profile_t){1100,150,512,150,350,64}));
                assert(arm_control_commit_profile(&s,1,2,1,1,tick));
            }
            if (n==14000 && leg==1)
                assert(arm_control_commit_profile(&s,1,4,0,1,tick));
            ++tick;s.last_command_tick=tick;
            int measured=(int)lround(q);
            /* Isolated one-count measurement disturbance. */
            if(tick%257==0) measured++;
            arm_result_t r=arm_control_step(&s,measured,tick,true,false);
            assert(r.active && r.fresh);
            arm_control_applied(&s,r.requested_effort,true);
            effort_delay[cursor]=r.requested_effort;
            double applied=effort_delay[(cursor+5-delay)%5];
            cursor=(cursor+1)%5;
            double net=applied-gravity-0.1*v;
            if(fabs(v)<0.1 && fabs(net)<=friction) v=0;
            else {
                double direction=fabs(v)<0.1 ? (net>0?1:-1) : (v>0?1:-1);
                v+=authority*(net-friction*direction)*0.001;
            }
            q+=v*0.001;
            assert(q>500 && q<1500 && fabs(v)<1000);
            if(n>=14000) {
                if(q<low) low=q;
                if(q>high) high=q;
                absolute_error+=fabs(target-q)/1000;
            }
        }
        if(absolute_error>2 || high-low>3) {
            fprintf(stderr,"plant g=%g load=%g friction=%g delay=%u leg=%u error=%g span=%g\n",
                authority,gravity,friction,delay,leg,absolute_error,high-low);
        }
        assert(absolute_error<=2 && high-low<=3);
    }
}

int main(void)
{
    const double authority[]={60,120,240},gravity[]={-80,0,80},friction[]={0,12};
    unsigned cases=0;
    for(unsigned a=0;a<3;a++) for(unsigned g=0;g<3;g++)
        for(unsigned f=0;f<2;f++) for(unsigned delay=0;delay<=4;delay+=2) {
            run(authority[a],gravity[g],friction[f],delay);cases++;
        }
    printf("arm synthetic plant: %u cases, bidirectional holds OK (not hardware qualification)\n",cases);
}
