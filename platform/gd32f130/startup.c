#include <stdint.h>

#include "board.h"
#include "mcu.h"

extern uint32_t _estack, _sidata, _sdata, _edata, _sbss, _ebss;
int firmware_main(void);
void Reset_Handler(void);
void Default_Handler(void);
void DMA_Channel3_4_IRQHandler(void) __attribute__((weak, alias("Default_Handler")));
void TIMER15_IRQHandler(void) __attribute__((weak, alias("Default_Handler")));
void USART1_IRQHandler(void) __attribute__((weak, alias("Default_Handler")));

/* The bootloader-compatible vector slot at 0xCC begins Reset_Handler. */
__attribute__((section(".isr_vector"), used))
const uintptr_t vector_table[51] = {
    [0] = (uintptr_t)&_estack,
    [1] = (uintptr_t)Reset_Handler,
    [2] = (uintptr_t)Default_Handler,
    [3] = (uintptr_t)Default_Handler,
    [11] = (uintptr_t)Default_Handler,
    [14] = (uintptr_t)Default_Handler,
    [15] = (uintptr_t)Default_Handler,
    [16 + DMA_Channel3_4_IRQn] = (uintptr_t)DMA_Channel3_4_IRQHandler,
    [16 + TIMER15_IRQn] = (uintptr_t)TIMER15_IRQHandler,
    [16 + 23] = (uintptr_t)Default_Handler,
    [16 + USART1_IRQn] = (uintptr_t)USART1_IRQHandler,
    [16 + 32] = (uintptr_t)Default_Handler,
};

__attribute__((section(".text.Reset_Handler"), noreturn))
void Reset_Handler(void)
{
    uint32_t *from = &_sidata;
    for (uint32_t *to = &_sdata; to < &_edata; ++to) {
        *to = *from++;
    }
    for (uint32_t *to = &_sbss; to < &_ebss; ++to) {
        *to = 0;
    }
    (void)firmware_main();
    board_halt_safe();
}

void Default_Handler(void)
{
    board_halt_safe();
}
