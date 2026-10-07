#include "../core/control/arm_motion.c"
#include <assert.h>
#include <stdio.h>
/* Endpoint-only validation would accept these intervals. Their velocity
 * changes sign inside the phase, taking q beyond the lower/upper limit. */
static void interior_extrema(void)
{
    for (int sign = -1; sign <= 1; sign += 2) {
        state_t start = {.v=-sign * (UNIT / 100)}, end = start;
        int32_t jerk = sign * (int32_t)(UNIT / 1000000);
        uint64_t time = 200u * (uint64_t)TIME_UNIT;
        advance(&end, jerk, time);
        bounds_t narrow = {-UNIT * 8 / 10, UNIT * 8 / 10, UNIT};
        bounds_t wide = {-UNIT, UNIT, UNIT};
        assert(inside(&start, &narrow) && inside(&end, &narrow));
        assert(!interval(&start, &end, jerk, time, &narrow));
        assert(interval(&start, &end, jerk, time, &wide));

        start = (state_t){.v=-sign * (UNIT / 1000), .a=sign * (int32_t)(UNIT / 1000000)};
        end = start;
        time = 2000u * (uint64_t)TIME_UNIT;
        advance(&end, 0, time);
        narrow = (bounds_t){-UNIT * 4 / 10, UNIT * 4 / 10, UNIT};
        assert(inside(&start, &narrow) && inside(&end, &narrow));
        assert(!interval(&start, &end, 0, time, &narrow));
        assert(interval(&start, &end, 0, time, &wide));
    }
}

int main(void) {
    interior_extrema();
    uint64_t seed=0x653422418762fea1ULL;
    for(unsigned i=0;i<1000000;++i) {
        seed=seed*6364136223846793005ULL+1;
        uint64_t n=seed;
        uint32_t d=(uint32_t)(seed>>27);
        if (!d) d=1;
        assert(divide_u64_u32(n,d)==n/d);
        uint64_t root = square_root(n);
        assert(root * root <= n);
        assert(root == UINT32_MAX || (root + 1) * (root + 1) > n);
        int64_t signed_n=(int64_t)(n>>1);
        assert(sixth(signed_n)==signed_n/6);
        assert(sixth(-signed_n)==-signed_n/6);
    }
    for (uint64_t root = 1; root <= UINT32_MAX; root = root * 2 + 1) {
        uint64_t square = root * root;
        assert(square_root(square) == root);
        assert(square_root(square - 1) == root - 1);
        assert(square_root(square + 1) == root);
    }
    assert(square_root(0) == 0 && square_root(UINT64_MAX) == UINT32_MAX);
    for(uint32_t d=1;d<65536;d++) {
        assert(divide_u64_u32(UINT64_MAX,d)==UINT64_MAX/d);
        assert(divide_u64_u32(0,d)==0);
    }
    for(unsigned bit=0;bit<32;bit++) {
        uint32_t d=(uint32_t)1<<bit;
        assert(divide_u64_u32(UINT64_MAX,d)==UINT64_MAX/d);
        assert(divide_u64_u32(UINT64_MAX,d+1)==UINT64_MAX/(d+1));
    }
    puts("motion arithmetic: exact wide ratios and signed division OK");
}
