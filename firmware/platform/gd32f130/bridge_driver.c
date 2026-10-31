#include "bridge_driver.h"
#include "bridge_output.h"

#include <stdint.h>

#include "mcu.h"

/* The old local names at +0x1c/+0x20/+0x30 were shifted. The actual
 * registers are CHCTL1/CHCTL2/CREP. Preserve programmed values and order. */
enum { PA6 = 1u << 6 };

static bool ready;
static bool armed;

void bridge_driver_disarm(void)
{
    /* Cut the external gate before touching timer compare state. */
    GPIO_BC(GPIOA) = PA6;
    TIMER_CCHP(TIMER0) = 0u;
    TIMER_CH0CV(TIMER0) = 0u;
    TIMER_CH2CV(TIMER0) = 0u;
    armed = false;
}

bool bridge_driver_init(uint8_t configuration)
{
    ready = false;
    bridge_driver_disarm();
    if ((configuration & 0x20u) != 0u) return false;

    RCU_AHBEN |= RCU_AHBEN_PBEN;
    /* PA7 = TIMER0_CH0N, PB1 = TIMER0_CH2N, both AF2. The external
     * standard-bridge gate is PA6 and remains low throughout setup. */
    GPIO_AFSEL0(GPIOA) = (GPIO_AFSEL0(GPIOA) & ~(0xfu << 28)) |
                             (2u << 28);
    GPIO_AFSEL0(GPIOB) = (GPIO_AFSEL0(GPIOB) & ~(0xfu << 4)) |
                             (2u << 4);
    GPIO_CTL(GPIOA) = (GPIO_CTL(GPIOA) & ~(3u << 14)) |
                             (2u << 14);
    GPIO_CTL(GPIOB) = (GPIO_CTL(GPIOB) & ~(3u << 2)) |
                             (2u << 2);
    GPIO_OSPD(GPIOA) &= ~(3u << 14);
    GPIO_OSPD(GPIOB) &= ~(3u << 2);

    /* Factory standard mode uses PWM0 on the two complementary outputs.
     * Configuration bit 6 selects /3 for 16 kHz, otherwise /2 for 24 kHz. */
    TIMER_CTL0(TIMER0) = 0u;
    TIMER_CCHP(TIMER0) = 0u;
    TIMER_CHCTL2(TIMER0) = 0u;
    TIMER_CHCTL0(TIMER0) = TIMER_OC_MODE_PWM0 | TIMER_CHCTL0_CH0COMSEN;
    TIMER_CHCTL1(TIMER0) = TIMER_OC_MODE_PWM0 | TIMER_CHCTL1_CH2COMSEN;
    TIMER_CH0CV(TIMER0) = 0u;
    TIMER_CH2CV(TIMER0) = 0u;
    TIMER_PSC(TIMER0) = (configuration & 0x40u) != 0u ? 2u : 1u;
    TIMER_CAR(TIMER0) = 999u;
    TIMER_CREP(TIMER0) = (configuration & 0x40u) != 0u ? 15u : 23u;
    TIMER_CHCTL2(TIMER0) = TIMER_CHCTL2_CH0NEN | TIMER_CHCTL2_CH2NEN;
    TIMER_SWEVG(TIMER0) = TIMER_SWEVG_UPG;
    TIMER_INTF(TIMER0) = 0u;
    TIMER_CTL0(TIMER0) = TIMER_CTL0_ARSE | TIMER_CTL0_CEN;
    ready = true;
    return true;
}

bool bridge_driver_apply(bridge_request_t request, bool motor_polarity,
                         int16_t *applied_effort)
{
    *applied_effort = 0;
    bridge_output_t output;
    if (!ready || !bridge_output_map_standard(request, motor_polarity, &output)) {
        bridge_driver_disarm();
        return false;
    }
    if (!output.gate_enabled) {
        bridge_driver_disarm();
        return true;
    }
    /* Preload compare changes at the timer update. Gate only on first arm,
     * avoiding a 1 kHz gate pulse during ordinary control updates. */
    if (!armed) GPIO_BC(GPIOA) = PA6;
    TIMER_CH0CV(TIMER0) = output.channel_0;
    TIMER_CH2CV(TIMER0) = output.channel_2;
    if (!armed) {
        TIMER_CCHP(TIMER0) = TIMER_CCHP_POEN;
        GPIO_BOP(GPIOA) = PA6;
        armed = true;
    }
    *applied_effort = output.applied_effort;
    return true;
}
