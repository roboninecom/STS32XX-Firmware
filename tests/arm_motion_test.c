/* Exercise the production fixed-point engine; double arithmetic below is only
 * an independent test oracle for integration and physical-unit bounds. */
#include "arm_motion.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

/* Count planner search work without timing hooks in the firmware. */
uint16_t arm_motion_iterations;

#define UNIT 68719476736.0
static uint32_t seed = 0x63a271;
static unsigned random_n(unsigned n) { seed = seed * 1664525u + 1013904223u; return seed % n; }

static void check_step(arm_motion_t *m, unsigned dt, unsigned ramp)
{
    double q=m->position/UNIT, v=m->velocity/UNIT, a=m->acceleration/UNIT;
    double bound=m->acceleration_limit/1000000.0;
    arm_motion_step(m,dt);
    double nextq=m->position/UNIT, nextv=m->velocity/UNIT, nexta=m->acceleration/UNIT;
    assert(fabs(nexta)<=bound+1e-9);
    assert(fabs(nexta-a)<=bound/ramp*(dt+2.0/65536)+1e-8);
    assert(fabs(nextv-v)<=bound*dt+0.000002);
    assert(fabs(nextq-q-v*dt)<=bound*dt*dt/2+0.002);
    assert(fabs(nextv)*1000<=m->speed_limit+0.002);
}

static void finish(arm_motion_t *m, unsigned ramp, int32_t low, int32_t high)
{
    for(unsigned t=0;!arm_motion_idle(m)&&t<200000;t++) {
        check_step(m,2,ramp);
        assert(arm_motion_position(m)>=low && arm_motion_position(m)<=high);
    }
    assert(arm_motion_idle(m) && m->velocity==0 && m->acceleration==0);
}

static void analytic_rest_move(void)
{
    /* V=1000, A=2000, T=30 ms: acceleration takes 530 ms, travels
     * 265 counts. 470 ms cruise plus symmetric deceleration => 1530 ms. */
    arm_motion_t m; arm_motion_init(&m,0);
    assert(arm_motion_target(&m,1000*256,1000,2000,30,-100*256,1100*256));
    for(unsigned t=1;t<=1531;t++) {
        check_step(&m,1,30);
        if(t==30) { assert(fabs(m.acceleration/UNIT*1e6-2000)<0.01); assert(fabs(m.velocity/UNIT*1000-30)<0.01); }
        if(t==530) { assert(fabs(m.position/UNIT-265)<0.01); assert(fabs(m.velocity/UNIT*1000-1000)<0.01); }
        if(t<1529) assert(!arm_motion_idle(&m));
    }
    assert(arm_motion_idle(&m) && arm_motion_position(&m)==1000*256);
}

static void random_targets(void)
{
    unsigned accepted=0;
    for(unsigned trial=0;trial<1200;trial++) {
        unsigned ramp=1+random_n(255), a=1+random_n(30000), v=1+random_n(65535);
        int32_t low=-30000*256,high=30000*256;
        arm_motion_t m;arm_motion_init(&m,(int32_t)random_n(60001)*256+low);
        int32_t goal=(int32_t)random_n(60001)*256+low;
        assert(arm_motion_target(&m,goal,v,a,ramp,low,high));
        for(unsigned step=0;step<160;step++) {
            if(step%13==0) {
                arm_motion_t before=m;
                int32_t replacement=(int32_t)random_n(60001)*256+low;
                if(arm_motion_target(&m,replacement,v,a,ramp,low,high)) {
                    accepted++;
                    assert(m.position==before.position && m.velocity==before.velocity && m.acceleration==before.acceleration);
                } else assert(memcmp(&m,&before,sizeof m)==0);
            }
            check_step(&m,1+random_n(2),ramp);
            assert(arm_motion_position(&m)>=low && arm_motion_position(&m)<=high);
        }
    }
    assert(accepted>10000);
}

static void boundaries_short_moves_and_refresh(void)
{
    for(unsigned ramp=1;ramp<=255;ramp+=127) for(int sign=-1;sign<=1;sign+=2)
    for(unsigned distance=1;distance<=10000;distance*=10) {
        arm_motion_t m;arm_motion_init(&m,0);
        assert(arm_motion_target(&m,sign*(int32_t)distance,65535,30000,ramp,-(int32_t)distance,(int32_t)distance));
        for(unsigned t=0;t<2000&&!arm_motion_idle(&m);t++) {
            arm_motion_t before=m;
            assert(arm_motion_target(&m,sign*(int32_t)distance,65535,30000,ramp,-(int32_t)distance,(int32_t)distance));
            assert(memcmp(&m,&before,sizeof m)==0);
            assert(!arm_motion_target(&m,0,500,30000,ramp,-(int32_t)distance,(int32_t)distance));
            assert(memcmp(&m,&before,sizeof m)==0);
            check_step(&m,1,ramp);
        }
        assert(arm_motion_idle(&m) && arm_motion_position(&m)==sign*(int32_t)distance);
    }
    arm_motion_t m;arm_motion_init(&m,0);
    assert(!arm_motion_target(&m,256,100,100,0,0,256));
    assert(arm_motion_target(&m,256,1,1,255,0,256));
    finish(&m,255,0,256);
}

/* Sample each phase in long and short moves, including deceleration, and
 * independently integrate the initial seven-phase schedule in floating point. */
static void phase_oracle_and_reversals(void)
{
    const unsigned accelerations[] = {1, 100, 10000, 30000};
    for (unsigned c=0;c<4;c++) for (unsigned ramp=1;ramp<=255;ramp+=127) {
        arm_motion_t original; arm_motion_init(&original,-1000*256);
        assert(arm_motion_target(&original,1000*256,2000,accelerations[c],ramp,
                                 -1000*256,1000*256));
        double q=original.position/UNIT,v=0,a=0,time=0;
        for (unsigned phase=0;phase<ARM_MOTION_PHASES;phase++) {
            double dt=original.phase[phase].remaining/65536.0;
            double j=original.phase[phase].jerk/UNIT;
            q+=v*dt+a*dt*dt/2+j*dt*dt*dt/6;
            v+=a*dt+j*dt*dt/2; a+=j*dt;
            for(unsigned sample=0;sample<3;sample++) {
                arm_motion_t m=original;
                arm_motion_step(&m,(uint32_t)(time+dt*sample/3));
                arm_motion_t before=m;
                bool ok=arm_motion_target(&m,-1000*256,2000,accelerations[c],ramp,
                                         -1000*256,1000*256);
                if(!ok) fprintf(stderr,"reversal A%u T%u phase%u sample%u q%f v%f a%f\n",accelerations[c],ramp,phase,sample,m.position/UNIT,m.velocity/UNIT*1000,m.acceleration/UNIT*1e6);
                assert(ok);
                assert(m.position==before.position && m.velocity==before.velocity && m.acceleration==before.acceleration);
                finish(&m,ramp,-1000*256,1000*256);
            }
            /* The evaluator pins phase endpoints within integer-jerk/time
             * quantization. Bound those corrections before applying them. */
            double end_a=original.phase[phase].end_acceleration/UNIT;
            assert(fabs(a-end_a)<fabs(j)/65536+2/UNIT);
            a=end_a;
            if(phase==2) {
                assert(fabs(v-original.cruise_velocity/UNIT)*1000<0.001);
                v=original.cruise_velocity/UNIT;
            }
            time+=dt;
        }
        if(fabs(q-1000)>=0.002 || fabs(v)*1000>=0.002 || fabs(a)*1e6>=0.002) { fprintf(stderr,"oracle A%u T%u q%.9f v%.9f a%.9f\n",accelerations[c],ramp,q,v*1000,a*1e6); }
        assert(fabs(q-1000)<0.002 && fabs(v)*1000<0.002 && fabs(a)*1e6<0.002);
    }
}

static void same_direction_search_regressions(void)
{
    const struct { int64_t q, v; int32_t a, goal; uint8_t ramp; } cases[] = {
        {145279869083935LL, 247736270233LL, -166845017, 2548, 30},
        {139732816436676LL, -244793250067LL, 320690874, 1548, 60},
        {110548522461872LL, -175828370599LL, 1374389534, 1248, 90},
    };
    for (unsigned i = 0; i < sizeof cases / sizeof cases[0]; ++i) {
        arm_motion_t motion;
        arm_motion_init(&motion, 2048 * 256);
        motion.position = cases[i].q;
        motion.velocity = cases[i].v;
        motion.acceleration = cases[i].a;
        motion.cursor = 0;
        motion.speed_limit = 65535;
        motion.acceleration_limit = 20000;
        assert(arm_motion_target(&motion, cases[i].goal * 256, 65535, 20000,
                                 cases[i].ramp, 23 * 256, 4041 * 256));
        assert(motion.position == cases[i].q && motion.velocity == cases[i].v &&
               motion.acceleration == cases[i].a);
        assert((arm_motion_iterations >> 8) > 0 && (arm_motion_iterations >> 8) <= 6);
        finish(&motion, cases[i].ramp, 23 * 256, 4041 * 256);
        assert(arm_motion_position(&motion) == cases[i].goal * 256);
    }
}

int main(void)
{
    same_direction_search_regressions();
    analytic_rest_move();
    phase_oracle_and_reversals();
    boundaries_short_moves_and_refresh();
    random_targets();
    puts("arm S-curve: analytic, bounds, refresh and retarget checks OK");
}
