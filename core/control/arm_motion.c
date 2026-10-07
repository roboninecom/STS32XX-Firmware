#include "arm_motion.h"

#define UNIT ((int64_t)1 << 36)
#define TIME_UNIT 65536u
#define POSITION_UNIT ((int64_t)1 << 28)
/* Endpoint quantization is below the existing Q8 wire position quantum. */
#define POSITION_ERROR (UNIT / 512)

static int64_t magnitude(int64_t value) { return value < 0 ? -value : value; }

/* Direction is ±1. A sign change avoids a general wide multiply. */
static __attribute__((noinline)) int64_t orient(int64_t value, int direction)
{
    return direction < 0 ? -value : value;
}

/* Split the product before multiplying. Admissible velocity transitions have
 * |a| <= 30000 counts/s²; the travel-derived peak-speed bound keeps displacement
 * products within int64_t even for the slowest supported acceleration. */
/* Keep this shared: inlining its wide multiply at every polynomial term
 * wastes flash on the small MCU without removing the arithmetic cost. */
static __attribute__((noinline)) int64_t times(int64_t value, uint64_t time)
{
    if (!time) return 0;
    /* Acquisition steps are exactly 1 or 2 ms except at a phase boundary. */
    if (time == TIME_UNIT) return value;
    if (time == 2u * TIME_UNIT) return value * 2;
    return value * (int64_t)(time / TIME_UNIT) +
        value * (int64_t)(time % TIME_UNIT) / TIME_UNIT;
}

/* Base-2^16 long division with a normalized two-digit divisor. Each quotient
 * estimate needs at most two corrections; all divisions are native 32-bit.
 * Unsigned wrap in the remainder subtraction is intentional: its true result
 * is less than the normalized divisor and therefore fits one word. */
static uint64_t divide_u64_u32(uint64_t value, uint32_t divisor)
{
    uint32_t high = (uint32_t)(value >> 32), low = (uint32_t)value;
    uint32_t top = high / divisor;
    high -= top * divisor;
    if (!high) return ((uint64_t)top << 32) | (low / divisor);
    unsigned shift = (unsigned)__builtin_clz(divisor);
    uint32_t normalized = divisor << shift;
    uint32_t digit = normalized >> 16, tail = normalized & 65535u;
    uint32_t remainder = shift ? (high << shift) | (low >> (32 - shift)) : high;
    uint32_t lower = low << shift;
    uint32_t quotient = 0;
    for (unsigned i = 0; i < 2; ++i) {
        uint32_t next = lower >> 16;
        lower <<= 16;
        uint32_t estimate = remainder / digit;
        uint32_t residual = remainder - estimate * digit;
        while (estimate >= 65536u || estimate * tail > (residual << 16) + next) {
            --estimate;
            residual += digit;
            if (residual >= 65536u) break;
        }
        remainder = (remainder << 16) + next - estimate * normalized;
        quotient = (quotient << 16) | estimate;
    }
    return ((uint64_t)top << 32) | quotient;
}

/* Integer Newton iteration starts at an upper bound and decreases to floor
 * sqrt(value). Native-word quotient estimates replace 32 wide bit trials. */
static uint32_t square_root(uint64_t value)
{
    if (!value) return 0;
    uint32_t high = (uint32_t)(value >> 32);
    unsigned bits = high ? 64u - (unsigned)__builtin_clz(high) :
        32u - (unsigned)__builtin_clz((uint32_t)value);
    unsigned shift = (bits + 1u) / 2u;
    uint32_t root = shift == 32u ? UINT32_MAX : (uint32_t)1u << shift;
    for (unsigned i = 0; i < 8; ++i) {
        uint64_t next = ((uint64_t)root + divide_u64_u32(value, root)) / 2u;
        if (next >= root) return root;
        root = (uint32_t)next;
    }
    return root;
}

static int64_t positive_ratio(int64_t numerator, int32_t denominator)
{
    return (int64_t)divide_u64_u32((uint64_t)numerator, (uint32_t)denominator);
}

static uint64_t duration(int64_t distance, int64_t rate)
{
    if ((uint64_t)rate <= UINT32_MAX && (uint64_t)distance <= UINT64_MAX / TIME_UNIT)
        return divide_u64_u32((uint64_t)distance * TIME_UNIT, (uint32_t)rate);
    return (uint64_t)(distance / rate) * TIME_UNIT +
        (uint64_t)(distance % rate) * TIME_UNIT / (uint64_t)rate;
}

/* The shared native-word divider is also exact for signed division by six.
 * Per-tick J*t fits one unsigned word, taking its short path. */
static int64_t sixth(int64_t value)
{
    int64_t quotient = (int64_t)divide_u64_u32((uint64_t)magnitude(value), 6);
    return value < 0 ? -quotient : quotient;
}

typedef struct { int64_t q, v; int32_t a; } state_t;
/* Construction already evaluates every endpoint. Retain only q/v on the
 * caller's stack so validation need not integrate all seven phases again. */
typedef struct { int64_t q, v; } endpoint_state_t;

static void advance(state_t *state, int32_t jerk, uint64_t time)
{
    if (!time) return;
    if (jerk) {
        int64_t jh = times(jerk, time);
        /* Horner form shares J*t and avoids separately forming t² and t³.
         * Jerk phases last <512 ms (including quantized J), so inner truncations
         * contribute <0.00001 count. Long constant-A phases retain the full
         * products below instead of rounding A/2 before a potentially long t². */
        state->q += times(state->v + times(state->a / 2 + sixth(jh), time), time);
        state->v += times(state->a + jh / 2, time);
        state->a = (int32_t)((int64_t)state->a + jh);
    } else {
        state->q += times(state->v, time);
        if (state->a) {
            int64_t ah = times(state->a, time);
            state->q += times(ah, time) / 2;
            state->v += ah;
        }
    }
}

static void append(arm_motion_phase_t *phase, state_t *state,
                       int32_t end_acceleration, int32_t jerk_limit)
{
    int64_t difference = (int64_t)end_acceleration - state->a;
    phase->remaining = duration(magnitude(difference), jerk_limit);
    /* Keep the same quantized J across replans. Rounding jerk down again
     * would enlarge stopping distance at a boundary, especially at low A.
     * Time truncates by <1/65536 ms; pin the endpoint acceleration by at most
     * J/65536. This is <0.46 counts/s² at the maximum A and minimum T. */
    phase->jerk = difference > 0 ? jerk_limit : difference < 0 ? -jerk_limit : 0;
    phase->end_acceleration = end_acceleration;
    advance(state, phase->jerk, phase->remaining);
    state->a = end_acceleration;
}

/* Reach a prescribed velocity with zero final acceleration. The direction is
 * chosen relative to the velocity reached by removing the initial acceleration.
 * This covers wrong-way acceleration and reversals without a separate pre-stop.
 * The triangular peak follows P² = J*delta_v + a0²/2; a plateau caps it at A. */
static void transition(arm_motion_phase_t *phase, endpoint_state_t *ends, state_t *state,
                       int64_t velocity, int32_t limit, int32_t jerk)
{
    int64_t change = velocity - state->v;
    int64_t a2 = (int64_t)state->a * state->a / 2;
    int64_t neutral = (state->a < 0 ? -1 : 1) * positive_ratio(a2, jerk);
    int direction = change >= neutral ? 1 : -1;
    int64_t delta = orient(change, direction);
    int64_t threshold = positive_ratio((int64_t)limit * limit - a2, jerk);
    int32_t peak = delta >= threshold ? limit :
        (int32_t)square_root((uint64_t)(delta * jerk + a2));
    append(&phase[0], state, direction * peak, jerk);
    ends[0] = (endpoint_state_t){state->q, state->v};
    uint64_t time = duration(peak, jerk);
    phase[2] = (arm_motion_phase_t){.remaining=time, .jerk=-direction * jerk};
    /* Only the final ramp's velocity change is needed to size the plateau.
     * Integrate its position once, after the plateau has been inserted. */
    int64_t end_velocity = state->v + times(state->a, time) +
        times(times(phase[2].jerk, time), time) / 2;
    int64_t gap = orient((velocity - end_velocity), direction);
    phase[1] = (arm_motion_phase_t){.end_acceleration = direction * peak};
    if (peak != 0 && gap > 0) {
        phase[1].remaining = duration(gap, peak);
        advance(state, 0, phase[1].remaining);
    }
    ends[1] = (endpoint_state_t){state->q, state->v};
    advance(state, phase[2].jerk, time);
    ends[2] = (endpoint_state_t){state->q, state->v};
    state->v = velocity;
    state->a = 0;
}

static int64_t construct(arm_motion_t *plan, endpoint_state_t *ends, state_t state, int64_t cruise,
                          int32_t acceleration, int32_t jerk)
{
    transition(plan->phase, ends, &state, cruise, acceleration, jerk);
    plan->phase[3] = (arm_motion_phase_t){0};
    ends[3] = (endpoint_state_t){state.q, state.v};
    transition(plan->phase + 4, ends + 4, &state, 0, acceleration, jerk);
    plan->cruise_velocity = cruise;
    return state.q;
}

/* Search only the transition endpoint, not a complete seven-phase plan.
 * Extend the first ramp backwards to zero acceleration. That virtual transition
 * is symmetric, so its distance is average velocity times duration. Subtract
 * the virtual prefix to recover the actual initial q/v/a. The derivative with
 * respect to terminal velocity supplies a safeguarded Newton step. */
typedef struct { int64_t distance, slope; } endpoint_t;
typedef struct {
    state_t initial;
    int64_t neutral_velocity, offset_velocity, prefix[2], limit_delta;
    uint64_t ramp_time;
    int32_t acceleration, jerk;
} search_t;

static search_t search_setup(state_t initial, int32_t acceleration, int32_t jerk)
{
    int64_t offset = positive_ratio((int64_t)initial.a * initial.a / 2, jerk);
    search_t search = {.initial=initial, .acceleration=acceleration, .jerk=jerk,
        .offset_velocity=offset,
        .neutral_velocity=initial.v + (initial.a < 0 ? -offset : offset),
        .limit_delta=positive_ratio((int64_t)acceleration * acceleration, jerk),
        .ramp_time=duration(acceleration, jerk)};
    if (!initial.a) return search;
    uint64_t t = duration(magnitude(initial.a), jerk);
    int64_t cubic = sixth(times(times(times(jerk, t), t), t));
    for (unsigned i = 0; i < 2; ++i) {
        int direction = i ? 1 : -1;
        int64_t v = initial.v - orient(offset, direction);
        search.prefix[i] = times(v, t) + orient(cubic, direction);
        if (direction * initial.a < 0) search.prefix[i] = -search.prefix[i];
    }
    return search;
}

static endpoint_t transition_endpoint(const search_t *search, int64_t initial_velocity,
                                       int64_t velocity, int direction)
{
    int64_t delta = orient((velocity - initial_velocity), direction);
    int32_t peak;
    uint64_t time;
    if (delta >= search->limit_delta) {
        peak = search->acceleration;
        time = 2 * search->ramp_time + duration(delta - search->limit_delta, peak);
    } else {
        peak = (int32_t)square_root((uint64_t)(delta * search->jerk));
        time = peak ? 2 * duration(peak, search->jerk) : 0;
    }
    int64_t sum = initial_velocity + velocity;
    int64_t derivative = orient(sum, direction);
    int64_t slope = (int64_t)time / 2;
    if (peak) slope += (derivative < 0 ? -1 : 1) *
        (int64_t)duration(magnitude(derivative), peak) / 2;
    return (endpoint_t){times(sum / 2, time), slope};
}

static endpoint_t endpoint(const search_t *search, int64_t cruise)
{
    int direction = cruise >= search->neutral_velocity ? 1 : -1;
    int64_t v = search->initial.v - orient(search->offset_velocity, direction);
    endpoint_t first = transition_endpoint(search, v, cruise, direction);
    endpoint_t second = v == 0 ? first :
        transition_endpoint(search, 0, cruise, cruise < 0 ? -1 : 1);
    return (endpoint_t){search->initial.q + first.distance + second.distance -
                            search->prefix[direction > 0],
                        first.slope + second.slope};
}

/* The acceleration-limited distance equation is quadratic in peak velocity.
 * Use its positive root to seed the same safeguarded search, including moves
 * that ultimately need triangular ramps. Q24 velocity / Q12 position keeps
 * the discriminant within uint64_t; final construction still uses Q36. */
static int64_t peak_seed(const search_t *search, int64_t goal, int direction, int64_t high)
{
    int32_t v = (int32_t)(orient(search->initial.v -
        orient(search->offset_velocity, direction), direction) / 4096);
    int32_t b = (int32_t)(search->limit_delta / 4096);
    int32_t distance = (int32_t)(orient(goal - search->initial.q +
        search->prefix[direction > 0], direction) / (1 << 24));
    int64_t c = (int64_t)distance * search->acceleration + (int64_t)v * (v - b) / 2;
    if (c <= 0) return high / 2;
    uint32_t root = square_root((uint64_t)b * b + 4u * (uint64_t)c);
    uint64_t denominator = (uint64_t)b + root;
    if (!denominator || denominator > UINT32_MAX) return high / 2;
    int64_t candidate = (int64_t)divide_u64_u32(2u * (uint64_t)c, (uint32_t)denominator) * 4096;
    return candidate > 0 ? (candidate < high ? candidate : high) : high / 2;
}

/* Velocity is monotone between acceleration-zero events. Position extrema are
 * therefore bracketed by at most two such intervals per constant-jerk phase. */
typedef struct { int64_t lower, upper, speed; } bounds_t;

static bool inside(const state_t *state, const bounds_t *bounds)
{
    return state->q >= bounds->lower && state->q <= bounds->upper &&
        magnitude(state->v) <= bounds->speed;
}

static bool interval(const state_t *start, const state_t *end, int32_t jerk,
                     uint64_t time, const bounds_t *bounds)
{
    if (!inside(end, bounds)) return false;
    if ((start->v < 0 && end->v > 0) || (start->v > 0 && end->v < 0)) {
        /* On this monotone-velocity interval, solve v+a*t+J*t²/2=0.
         * The stable form 2*|v|/(|a|+sqrt(a²-2Jv)) avoids cancellation.
         * A sign crossing within a bounded-acceleration phase bounds the
         * discriminant and its intermediates by the acceleration envelope. */
        uint64_t low, high;
        if (!jerk) {
            if (!start->a) return false;
            low = duration(magnitude(start->v), magnitude(start->a));
            high = low + 1;
        } else {
            int64_t discriminant = (int64_t)start->a * start->a -
                2 * (int64_t)jerk * start->v;
            /* Endpoint quantization can flip an almost-zero velocity although
             * the continuous polynomial has no root. Its travel is bounded by
             * the already-checked endpoint; do not invent a negative square root. */
            if (discriminant < 0) return magnitude(end->v) <= UNIT / 1000000;
            uint32_t root = square_root((uint64_t)discriminant);
            int64_t denominator = magnitude(start->a) + root;
            if (!denominator) return false;
            low = duration(2 * magnitude(start->v), denominator + 1);
            high = duration(2 * magnitude(start->v), denominator) + 1;
        }
        if (low > time) low = time;
        if (high > time) high = time;
        state_t before = *start, after = *start;
        advance(&before, jerk, low);
        advance(&after, jerk, high);
        if (!inside(&before, bounds) || !inside(&after, bounds)) return false;
    }
    return true;
}

static bool valid_plan(const arm_motion_t *plan, const endpoint_state_t *ends,
                       int32_t lower_q8, int32_t upper_q8)
{
    bounds_t bounds = {(int64_t)lower_q8 * POSITION_UNIT - POSITION_ERROR,
        (int64_t)upper_q8 * POSITION_UNIT + POSITION_ERROR,
        (int64_t)divide_u64_u32((uint64_t)plan->speed_limit * UNIT, 1000) + UNIT / 1000000};
    state_t state = {plan->position, plan->velocity, plan->acceleration};
    int64_t cruise_distance = times(plan->cruise_velocity, plan->phase[3].remaining);
    if (!inside(&state, &bounds)) return false;
    for (unsigned i = 0; i < ARM_MOTION_PHASES; ++i) {
        const arm_motion_phase_t *phase = &plan->phase[i];
        uint64_t split = 0;
        if ((state.a < 0 && phase->end_acceleration > 0) ||
            (state.a > 0 && phase->end_acceleration < 0))
            split = duration(magnitude(state.a), magnitude(phase->jerk));
        state_t end = {.q=ends[i].q + (i >= 3 ? cruise_distance : 0), .v=ends[i].v};
        if (split) {
            state_t middle = state;
            advance(&middle, phase->jerk, split);
            if (!interval(&state, &middle, phase->jerk, split, &bounds) ||
                !interval(&middle, &end, phase->jerk, phase->remaining - split, &bounds)) return false;
        } else if (!interval(&state, &end, phase->jerk, phase->remaining, &bounds)) return false;
        state.q = end.q;
        state.v = end.v;
        state.a = phase->end_acceleration;
        if (i == 2) {
            if (magnitude(state.v - plan->cruise_velocity) > UNIT / 1000000) return false;
            state.v = plan->cruise_velocity;
        }
    }
    return magnitude(state.q - plan->goal) <= POSITION_ERROR &&
        magnitude(state.v) <= UNIT / 1000000;
}

static bool valid(const arm_motion_t *plan, const endpoint_state_t *ends, int32_t lower, int32_t upper)
{
#ifdef FW_ARM_TIMING_PROBE
    uint32_t started = arm_motion_clock();
#endif
    bool result = valid_plan(plan, ends, lower, upper);
#ifdef FW_ARM_TIMING_PROBE
    arm_motion_record(ARM_TIMING_VALIDATION, started);
#endif
    return result;
}

void arm_motion_init(arm_motion_t *motion, int32_t position_q8)
{
    *motion = (arm_motion_t){.position = (int64_t)position_q8 * POSITION_UNIT,
        .goal = (int64_t)position_q8 * POSITION_UNIT, .cursor = ARM_MOTION_PHASES};
}

bool arm_motion_idle(const arm_motion_t *motion) { return motion->cursor == ARM_MOTION_PHASES; }
int32_t arm_motion_position(const arm_motion_t *motion) { return (int32_t)(motion->position / POSITION_UNIT); }
int32_t arm_motion_velocity(const arm_motion_t *motion) { return (int32_t)(motion->velocity * 1000 / POSITION_UNIT); }

/* Keep search scratch out of the validation call chain to bound stack use. */
static __attribute__((noinline)) bool prepare_target(arm_motion_t *plan,
    endpoint_state_t *ends, uint8_t ramp_ms, int32_t lower_q8, int32_t upper_q8)
{
    int64_t goal = plan->goal;
    int32_t a = (int32_t)divide_u64_u32((uint64_t)plan->acceleration_limit * (1u << 30), 15625);
    int32_t j = a / ramp_ms;
    state_t initial = {plan->position, plan->velocity, plan->acceleration};
    search_t search = search_setup(initial, a, j);
    int64_t stopped = endpoint(&search, 0).distance;
    int direction = goal >= stopped ? 1 : -1;
    /* Even without jerk limits a rest-to-rest move cannot use a peak exceeding
     * sqrt(2*A*travel). This also bounds intermediate fixed-point products. */
    uint64_t span = (uint64_t)((int64_t)upper_q8 - lower_q8 + 255) / 256;
    uint32_t bound = square_root(2u * (uint64_t)plan->acceleration_limit * span);
    int64_t high = (int64_t)divide_u64_u32((uint64_t)(plan->speed_limit < bound ? plan->speed_limit : bound) * UNIT, 1000);
    int64_t ceiling = high, end;
    int64_t low = 0, lower_distance = stopped;
    /* Splitting a deceleration into two ramps makes distance non-monotone
     * below the acceleration-neutral velocity. Select the bracket on either
     * side of that junction before Newton iteration; otherwise same-direction
     * retargets can wander through the redundant two-deceleration branch. */
    int64_t junction = orient(search.neutral_velocity, direction);
    if (junction > 0 && junction < high) {
        int64_t at_junction = endpoint(&search, orient(junction, direction)).distance;
        if (orient((goal - at_junction), direction) >= 0) {
            low = junction;
            lower_distance = at_junction;
        } else high = junction;
    }
    int64_t candidate = peak_seed(&search, goal, direction, high);
    if (low && candidate <= low) {
        /* Just beyond this junction, a tiny triangular ramp dominates:
         * extra distance ≈2*v*sqrt(delta_v/J). Its inverse is a better seed
         * than the acceleration-limited quadratic near the square-root cusp. */
        uint64_t t = duration(orient((goal - lower_distance), direction), 2 * low);
        if (t > search.ramp_time) t = search.ramp_time;
        int64_t delta = times(times(j, t), t);
        candidate = low + (delta > 0 ? delta : 1);
        if (candidate > high) candidate = high;
    }
    bool cruise = false;
    for (unsigned i = 0; i < 16; ++i) {
#ifdef FW_ARM_TIMING_PROBE
        arm_motion_iterations += 256;
#endif
        endpoint_t estimate = endpoint(&search, orient(candidate, direction));
        int64_t error = orient((estimate.distance - goal), direction);
        if (magnitude(error) <= POSITION_ERROR / 8) break;
        if (candidate == ceiling && error < 0) { cruise = true; break; }
        if (error < 0) low = candidate;
        else high = candidate;
        int64_t correction = estimate.slope > 0 ?
            (int64_t)duration(magnitude(error), estimate.slope) : high;
        int64_t next = candidate + (error < 0 ? correction : -correction);
        if (next >= high && high == ceiling) candidate = ceiling;
        else candidate = next > low && next < high ? next : low + (high - low) / 2;
    }
    if (cruise) {
        end = construct(plan, ends, initial, orient(ceiling, direction), a, j);
        plan->phase[3].remaining = duration(magnitude(goal - end), ceiling);
    } else {
        /* Resolve the small difference between continuous endpoint arithmetic
         * and quantized phase times using the same distance derivative. */
        for (unsigned i = 0; i < 5; ++i) {
#ifdef FW_ARM_TIMING_PROBE
            ++arm_motion_iterations;
#endif
            end = construct(plan, ends, initial, orient(candidate, direction), a, j);
            int64_t error = orient((end - goal), direction);
            if (magnitude(error) <= POSITION_ERROR / 4) break;
            endpoint_t estimate = endpoint(&search, orient(candidate, direction));
            if (estimate.slope <= 0) return false;
            int64_t correction = (int64_t)duration(magnitude(error), estimate.slope);
            candidate += error < 0 ? correction : -correction;
            if (candidate < 0) return false;
        }
    }
    return true;
}

bool arm_motion_target(arm_motion_t *motion, int32_t target_q8,
    uint16_t speed, uint16_t acceleration, uint8_t ramp_ms,
    int32_t lower_q8, int32_t upper_q8)
{
#ifdef FW_ARM_TIMING_PROBE
    arm_motion_iterations = 0;
#endif
    if (!speed || !acceleration || acceleration > 30000 || !ramp_ms ||
        target_q8 < lower_q8 || target_q8 > upper_q8 || lower_q8 >= upper_q8)
        return false;
    if (!arm_motion_idle(motion) && (motion->speed_limit != speed ||
        motion->acceleration_limit != acceleration)) return false;
    int64_t goal = (int64_t)target_q8 * POSITION_UNIT;
    if (goal == motion->goal && !arm_motion_idle(motion)) return true;
    if (goal == motion->position && motion->velocity == 0 && motion->acceleration == 0) {
        motion->goal = goal;
        motion->speed_limit = speed;
        motion->acceleration_limit = acceleration;
        motion->cursor = ARM_MOTION_PHASES;
        return true;
    }
    arm_motion_t plan = *motion;
    endpoint_state_t ends[ARM_MOTION_PHASES];
    plan.speed_limit = speed;
    plan.acceleration_limit = acceleration;
    plan.cursor = 0;
    plan.goal = goal;
    if (!prepare_target(&plan, ends, ramp_ms, lower_q8, upper_q8) ||
        !valid(&plan, ends, lower_q8, upper_q8)) return false;
    *motion = plan;
    return true;
}

bool arm_motion_stop(arm_motion_t *motion, uint8_t ramp_ms,
    int32_t lower_q8, int32_t upper_q8)
{
    if (!ramp_ms || lower_q8 >= upper_q8) return false;
    if (arm_motion_idle(motion)) return true;
    if (motion->velocity == 0 && motion->acceleration == 0) {
        motion->goal = motion->position;
        motion->cursor = ARM_MOTION_PHASES;
        return true;
    }
    arm_motion_t plan = *motion;
    endpoint_state_t ends[ARM_MOTION_PHASES];
    int32_t a = (int32_t)divide_u64_u32((uint64_t)plan.acceleration_limit * (1u << 30), 15625);
    plan.goal = construct(&plan, ends, (state_t){plan.position, plan.velocity, plan.acceleration},
                           0, a, a / ramp_ms);
    plan.cursor = 0;
    if (!valid(&plan, ends, lower_q8, upper_q8)) return false;
    *motion = plan;
    return true;
}

void arm_motion_step(arm_motion_t *motion, uint32_t milliseconds)
{
#ifdef FW_ARM_TIMING_PROBE
    uint32_t started = arm_motion_clock();
#endif
    uint64_t remaining = (uint64_t)milliseconds * TIME_UNIT;
    state_t state = {motion->position, motion->velocity, motion->acceleration};
    /* Each iteration consumes a phase or all remaining time; at most seven. */
    for (unsigned i = 0; i < ARM_MOTION_PHASES && motion->cursor < ARM_MOTION_PHASES; ++i) {
        arm_motion_phase_t *phase = &motion->phase[motion->cursor];
        uint64_t time = remaining < phase->remaining ? remaining : phase->remaining;
        advance(&state, phase->jerk, time);
        remaining -= time;
        phase->remaining -= time;
        if (phase->remaining != 0) break;
        state.a = phase->end_acceleration;
        if (motion->cursor == 2) state.v = motion->cruise_velocity;
        if (++motion->cursor == ARM_MOTION_PHASES) {
            state = (state_t){.q = motion->goal};
            break;
        }
    }
    motion->position = state.q;
    motion->velocity = state.v;
    motion->acceleration = state.a;
#ifdef FW_ARM_TIMING_PROBE
    arm_motion_record(ARM_TIMING_EVALUATION, started);
#endif
}
