#include "diagnostics.h"

#include <stdint.h>
#include "mcu.h"

enum {
    STACK_TOP = 0x20001000u
};

/* Measure the complete free-RAM stack area, including deeper planning calls.
 * The old fixed 1 KiB window could only report a saturated high-water mark. */
extern uint32_t _end;

void diagnostics_probe_init(uint32_t *stack_mark_end)
{
    CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
    DWT->CYCCNT = 0u;
    DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;
    uint32_t sp;
    __asm volatile("mov %0, sp" : "=r"(sp));
    uint32_t end = (sp - 128u) & ~3u;
    uint32_t floor = ((uint32_t)(uintptr_t)&_end + 31u) & ~31u;
    if (end < floor) end = floor;
    *stack_mark_end = end;
    for (uint32_t address = floor; address < end; address += 4u)
        REG32(address) = 0xa5a5a5a5u;
}

uint32_t diagnostics_probe_cycles(void)
{
    return DWT->CYCCNT;
}

uint16_t diagnostics_probe_stack_used(uint32_t stack_mark_end)
{
    uint32_t floor = ((uint32_t)(uintptr_t)&_end + 31u) & ~31u;
    for (uint32_t address = floor; address < stack_mark_end; address += 4u)
        if (REG32(address) != 0xa5a5a5a5u)
            return (uint16_t)(STACK_TOP - address);
    return (uint16_t)(STACK_TOP - stack_mark_end);
}

__attribute__((noinline)) void diagnostics_record(uint32_t *mean, uint32_t *maximum,
                                                 uint32_t sample, uint16_t count)
{
    if (sample > *maximum) *maximum = sample;
    /* At count one the whole difference is applied, resetting the mean. */
    if (sample > *mean) *mean += (sample - *mean) / count;
    else *mean -= (*mean - sample) / count;
}
