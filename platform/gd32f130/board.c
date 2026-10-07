#include "board.h"
#include "status_led_driver.h"

#include <stdint.h>
#include "mcu.h"

/* Clock and bootloader-visible order remain unchanged. The historical
 * RCU+0x08 name was wrong: the vendor map identifies it as RCU_INT. */
enum { CLOCK_TIMEOUT = 1000000u, PA6 = 1u << 6, LED_PIN = 1u << 0 };

void status_led_driver_init(void)
{
    RCU_AHBEN |= RCU_AHBEN_PFEN;
    GPIO_BOP(GPIOF) = LED_PIN;
    GPIO_CTL(GPIOF) = (GPIO_CTL(GPIOF) & ~3u) | 1u;
}

void status_led_driver_set(bool on)
{
    REG32(on ? (uintptr_t)&GPIO_BC(GPIOF) : (uintptr_t)&GPIO_BOP(GPIOF)) = LED_PIN;
}

static bool wait_mask(uint32_t address, uint32_t mask, uint32_t value)
{
    for (uint32_t remaining = CLOCK_TIMEOUT; remaining != 0; --remaining) {
        if ((REG32(address) & mask) == value) {
            return true;
        }
    }
    return false;
}

static void disable_bridge(void)
{
    /* Timer outputs are disabled before enabling their peripheral clock. */
    RCU_APB2EN |= RCU_APB2EN_TIMER0EN;
    TIMER_CCHP(TIMER0) = 0;
    TIMER_CTL0(TIMER0) = 0;
    RCU_AHBEN |= RCU_AHBEN_PAEN;
    GPIO_BC(GPIOA) = PA6;
    GPIO_CTL(GPIOA) = (GPIO_CTL(GPIOA) & ~(3u << 12)) | (1u << 12);
}

static bool start_48mhz_clock(void)
{
    RCU_INT = 0x00ff0000u; /* Factory-derived RCU interrupt-clear write. */
    RCU_CTL0 |= RCU_CTL0_IRC8MEN;
    RCU_CFG0 = 0x00280000u; /* 8 MHz / 2 * 12 */
    RCU_CTL0 |= RCU_CTL0_PLLEN;
    if (!wait_mask((uint32_t)(uintptr_t)&RCU_CTL0,
                   RCU_CTL0_PLLSTB, RCU_CTL0_PLLSTB)) {
        return false;
    }
    RCU_CFG0 |= 2u; /* system clock = PLL */
    return wait_mask((uint32_t)(uintptr_t)&RCU_CFG0, 3u << 2, 2u << 2);
}

static bool start_watchdog(void)
{
    FWDGT_CTL = 0x5555u;
    FWDGT_PSC = 6u;
    FWDGT_RLD = 0x96u;
    if (!wait_mask((uint32_t)(uintptr_t)&FWDGT_STAT, 3u, 0u)) {
        return false;
    }
    FWDGT_CTL = 0xaaaau;
    FWDGT_CTL = 0xccccu;
    return true;
}

bool board_init_safe(void)
{
    disable_bridge();
    if (!start_48mhz_clock()) {
        return false;
    }
    SCB->VTOR = 0x08000000u;
    return start_watchdog();
}

void board_watchdog_feed(void)
{
    FWDGT_CTL = 0xaaaau;
}

void board_halt_safe(void)
{
    disable_bridge();
    for (;;) {
        __asm volatile("wfi");
    }
}

void board_system_reset(void)
{
    __asm volatile("cpsid i" ::: "memory");
    __asm volatile("dsb" ::: "memory");
    SCB->AIRCR = (SCB->AIRCR & 0x700u) | 0x05fa0004u;
    __asm volatile("dsb" ::: "memory");
    for (;;) { }
}
