#ifndef ELAPSED_CLOCK_H
#define ELAPSED_CLOCK_H
#include <stdint.h>

/* Single-owner counter extension. Update more often than one 32-bit cycle
 * wrap (89 s at 48 MHz). The sensor IRQ owns this clock while enabled;
 * restart advances it with that IRQ stopped to include flash-maintenance time. */
typedef struct { uint32_t last_cycles, remainder_cycles, milliseconds; } elapsed_clock_t;

static inline void elapsed_clock_update(elapsed_clock_t *clock, uint32_t cycles)
{
    uint32_t delta = cycles - clock->last_cycles;
    clock->last_cycles = cycles;
    clock->milliseconds += delta / 48000u;
    clock->remainder_cycles += delta % 48000u;
    clock->milliseconds += clock->remainder_cycles / 48000u;
    clock->remainder_cycles %= 48000u;
}
#endif
