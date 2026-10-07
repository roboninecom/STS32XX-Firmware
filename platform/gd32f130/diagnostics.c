#include "diagnostics.h"

#include <stdint.h>
#include "mcu.h"

enum {
    STACK_FLOOR = 0x20000c00u, STACK_TOP = 0x20001000u,
    CPU_CLOCK_HZ = 48000000u, TICK_RELOAD = CPU_CLOCK_HZ / 1000u - 1u
};

void diagnostics_probe_init(uint32_t *stack_mark_end)
{
    CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
    DWT->CYCCNT = 0u;
    DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;
    uint32_t sp;
    __asm volatile("mov %0, sp" : "=r"(sp));
    uint32_t end = (sp - 128u) & ~3u;
    if (end < STACK_FLOOR) end = STACK_FLOOR;
    *stack_mark_end = end;
    for (uint32_t address = STACK_FLOOR; address < end; address += 4u)
        REG32(address) = 0xa5a5a5a5u;
}

uint32_t diagnostics_probe_cycles(void)
{
    return DWT->CYCCNT;
}

uint16_t diagnostics_probe_stack_used(uint32_t stack_mark_end)
{
    for (uint32_t address = STACK_FLOOR; address < stack_mark_end; address += 4u)
        if (REG32(address) != 0xa5a5a5a5u)
            return (uint16_t)(STACK_TOP - address);
    return (uint16_t)(STACK_TOP - stack_mark_end);
}

uint16_t diagnostics_probe_tick_late_us(void)
{
    return (uint16_t)((TICK_RELOAD - SysTick->VAL) /
                      (CPU_CLOCK_HZ / 1000000u));
}
