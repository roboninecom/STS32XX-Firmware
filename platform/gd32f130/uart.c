#include "uart_driver.h"
#include "bus_timing.h"

#include <stdint.h>

#ifndef FW_UART_HOST_TEST
#include "uart_registers.h"
#else
#include "uart_driver_test_port.h"
#endif

static uart_driver_t *active_driver;
static const uint32_t serial_irq_mask = (1u << HW_DMA_RX_IRQ) |
    (1u << HW_USART1_IRQ) | (1u << HW_TIMER15_IRQ);

void uart_driver_lock(void)
{
    REG32(HW_NVIC_ICER) = serial_irq_mask;
#ifndef FW_UART_HOST_TEST
    __asm volatile("dsb\n isb" ::: "memory");
#endif
}

void uart_driver_unlock(void)
{
#ifndef FW_UART_HOST_TEST
    __asm volatile("" ::: "memory");
#endif
    REG32(HW_NVIC_ISER) = serial_irq_mask;
}

void uart_driver_set_handler(uart_driver_t *driver,
                             uart_service_handler_t handler, void *context)
{
    uart_driver_lock();
    driver->context = context;
    driver->handler = handler;
    uart_driver_unlock();
}

static void service_receive(uart_driver_t *driver)
{
    /* Sample HW_DMA once per bounded service event. Pending wrap bookkeeping is
     * handled by the same-priority HW_DMA IRQ before any bytes are consumed. */
    uint32_t remaining = REG32(HW_DMA_RX_COUNT);
    driver->receive_limit = driver->consumed;
    if (remaining != 0u && (REG32(HW_DMA_INTF) & HW_DMA_RX_FTF) == 0u) {
        uint32_t produced = driver->receive_wraps * UART_RX_CAPACITY +
            ((UART_RX_CAPACITY - remaining) & (UART_RX_CAPACITY - 1u));
        uint32_t available = produced - driver->consumed;
#ifdef FW_TIMING_PROBE
        uint16_t observed = available > UINT16_MAX ? UINT16_MAX : (uint16_t)available;
        if (observed > driver->max_rx_occupancy) driver->max_rx_occupancy = observed;
#endif
        if (available > UART_RX_CAPACITY || driver->receive_error) {
            driver->consumed = produced;
            driver->overflowed = true;
            driver->receive_error = false;
        }
        driver->receive_limit = produced;
    }
    if (remaining != driver->last_dma_count) {
        driver->receive_idle = false;
        driver->last_dma_count = remaining;
    }
    if (driver->handler != 0) driver->handler(driver->context);
}

static inline void configure_pins_and_clocks(void)
{
    REG32(HW_RCU_AHBEN) |= HW_DMA_CLOCK; /* HW_DMA */
    REG32(HW_RCU_APB1EN) |= HW_USART_CLOCK; /* USART1 */
    REG32(HW_RCU_APB2EN) |= HW_TIMER_CLOCK; /* HW_TIMER15 */
    REG32(HW_GPIOA_AF) |= HW_PA2_AF1; /* PA2 alternate function 1 */
    REG32(HW_GPIOA_CTL) |= HW_PA2_AF; /* PA2 alternate function */
    REG32(HW_GPIOA_SPEED) |= HW_PA2_SPEED;
}

static inline void configure_transmit_dma(void)
{
    REG32(HW_DMA_TX_CTL) = 0;
    REG32(HW_DMA_TX_COUNT) = 0;
    REG32(HW_DMA_TX_PERIPHERAL) = HW_USART_TDATA;
    REG32(HW_DMA_TX_CTL) = HW_DMA_TX_CONFIG;
}

static inline void configure_receive_dma(uart_driver_t *driver)
{
    REG32(HW_DMA_RX_CTL) = 0;
    REG32(HW_DMA_INTC) = HW_DMA_RX_FLAGS;
    REG32(HW_DMA_RX_COUNT) = UART_RX_CAPACITY;
    REG32(HW_DMA_RX_PERIPHERAL) = HW_USART_RDATA;
    REG32(HW_DMA_RX_MEMORY) = (uint32_t)(uintptr_t)driver->receive;
    REG32(HW_DMA_RX_CTL) = HW_DMA_RX_CONFIG; /* circular RX: half/full-transfer and error IRQs */
    REG8(HW_NVIC_PRIO + HW_DMA_RX_IRQ) = HW_IRQ_PRIORITY;
    REG32(HW_NVIC_ISER) = 1u << HW_DMA_RX_IRQ;
}

void uart_driver_init(uart_driver_t *driver, uint8_t baud_index)
{
    active_driver = driver;
    driver->handler = 0;
    driver->context = 0;
    driver->receive_wraps = 0;
    driver->receive_error = false;
    driver->consumed = 0;
    driver->receive_limit = 0;
    driver->last_dma_count = UART_RX_CAPACITY;
    driver->receive_idle = false;
    driver->transmitting = false;
    driver->transmit_complete = false;
    driver->delay_running = false;
    driver->overflowed = false;
#ifdef FW_TIMING_PROBE
    driver->max_rx_occupancy = 0u;
    driver->idle_cycles = 0;
    driver->tx_cycles = 0;
    driver->idle_to_tx_us = driver->max_idle_to_tx_us = 0;
    driver->tx_duration_us = driver->max_tx_duration_us = 0;
#endif

    configure_pins_and_clocks();

    REG32(HW_USART_CTL0) = 0;
    REG32(HW_USART_BAUD) = HW_USART_CLOCK_HZ / bus_baud_rate(baud_index);
    REG32(HW_USART_CTL2) = HW_USART_HDEN | HW_USART_DENR | HW_USART_DENT;

    configure_transmit_dma();
    configure_receive_dma(driver);

    REG32(HW_TIMER15_CTL) = HW_TIMER_ONE_PULSE; /* one pulse, initially stopped */
    REG32(HW_TIMER15_INTF) = 0;
    REG32(HW_TIMER15_DMAINTEN) = 0;
    REG8(HW_NVIC_PRIO + HW_TIMER15_IRQ) = HW_IRQ_PRIORITY;
    REG32(HW_NVIC_ISER) = 1u << HW_TIMER15_IRQ;
    REG32(HW_USART_CTL0) = HW_USART_UEN | HW_USART_REN | HW_USART_IDLEIE;
    REG8(HW_NVIC_PRIO + HW_USART1_IRQ) = HW_IRQ_PRIORITY;
    REG32(HW_NVIC_ISER) = 1u << HW_USART1_IRQ;
}

void USART1_IRQHandler(void)
{
    uart_driver_t *driver = active_driver;
    if (driver == 0) return;
    uint32_t status = REG32(HW_USART_STAT);
    if ((status & HW_USART_TC) != 0u &&
        (REG32(HW_USART_CTL0) & HW_USART_TCIE) != 0u) {
        REG32(HW_USART_CTL0) &= ~(HW_USART_TCIE | HW_USART_TEN);
        REG32(HW_USART_INTC) = HW_USART_TC;
        REG32(HW_USART_CTL0) |= HW_USART_REN;
#ifdef FW_TIMING_PROBE
        uint32_t us = (REG32(HW_CYCLE_COUNTER) - driver->tx_cycles) /
            (HW_USART_CLOCK_HZ / 1000000u);
        driver->tx_duration_us = us > UINT16_MAX ? UINT16_MAX : (uint16_t)us;
        if (driver->tx_duration_us > driver->max_tx_duration_us)
            driver->max_tx_duration_us = driver->tx_duration_us;
#endif
        driver->transmitting = false;
        driver->transmit_complete = true;
    }
    if ((status & HW_USART_RX_ERRORS) != 0u) {
        REG32(HW_USART_INTC) = status & HW_USART_RX_ERRORS;
        driver->receive_error = true;
    }
    if ((status & HW_USART_IDLEF) != 0u) {
#ifdef FW_TIMING_PROBE
        driver->idle_cycles = REG32(HW_CYCLE_COUNTER);
#endif
        REG32(HW_USART_INTC) = HW_USART_IDLEF;
        driver->last_dma_count = REG32(HW_DMA_RX_COUNT);
        driver->receive_idle = true;
    }
    service_receive(driver);
}

void DMA_Channel3_4_IRQHandler(void)
{
    uint32_t flags = REG32(HW_DMA_INTF);
    REG32(HW_DMA_INTC) = HW_DMA_RX_FLAGS;
    if (active_driver != 0) {
        if ((flags & HW_DMA_RX_FTF) != 0u) ++active_driver->receive_wraps;
        if ((flags & HW_DMA_RX_ERR) != 0u) active_driver->receive_error = true;
        service_receive(active_driver);
    }
}

void TIMER15_IRQHandler(void)
{
    REG32(HW_TIMER15_INTF) = 0;
    REG32(HW_TIMER15_DMAINTEN) = 0;
    if (active_driver == 0) return;
    active_driver->delay_running = false;
    if (active_driver->handler != 0)
        active_driver->handler(active_driver->context);
}

void uart_driver_poll(uart_driver_t *driver)
{
    /* Service newly arrived bytes or the remainder of a bounded IRQ batch.
     * These observations are hints: an IRQ may advance the cursors between
     * loads, causing a harmless extra pend. DMA/IDLE IRQs and the next poll
     * cover subsequent arrivals. Foreground never advances the RX cursors. */
    if (REG32(HW_DMA_RX_COUNT) != driver->last_dma_count ||
        driver->consumed != driver->receive_limit)
        REG32(HW_NVIC_ISPR) = 1u << HW_USART1_IRQ;
}

bool uart_driver_read(uart_driver_t *driver, uint8_t *byte)
{
    if (driver->consumed == driver->receive_limit) return false;
    *byte = driver->receive[driver->consumed & (UART_RX_CAPACITY - 1u)];
    ++driver->consumed;
    return true;
}

bool uart_driver_idle(const uart_driver_t *driver)
{
    return driver->receive_idle;
}

void uart_driver_set_baud(uart_driver_t *driver, uint8_t baud_index)
{
    (void)driver;
    REG32(HW_USART_CTL0) &= ~HW_USART_UEN;
    REG32(HW_USART_BAUD) = HW_USART_CLOCK_HZ / bus_baud_rate(baud_index);
    REG32(HW_USART_CTL0) |= HW_USART_UEN;
}

void uart_driver_delay(uart_driver_t *driver, uint8_t slot,
                       uint8_t response_length, uint8_t baud_index)
{
    uint32_t slot_us = bus_slot_us(response_length, baud_index);
    REG32(HW_TIMER15_DMAINTEN) = 0;
    REG32(HW_TIMER15_CTL) = HW_TIMER_ONE_PULSE;
    REG32(HW_TIMER15_PSC) = HW_USART_CLOCK_HZ / 1000000u - 1u;
    REG32(HW_TIMER15_CAR) = slot_us - 1u;
    REG32(HW_TIMER15_CREP) = slot - 1u;
    REG32(HW_TIMER15_SWEVG) = HW_TIMER_UPDATE;
#ifndef FW_UART_HOST_TEST
    __asm volatile("nop\n nop\n nop");
#endif
    REG32(HW_TIMER15_INTF) = 0;
    REG32(HW_TIMER15_CTL) |= HW_TIMER_ENABLE;
    driver->delay_running = true;
    REG32(HW_TIMER15_DMAINTEN) = HW_TIMER_UPDATE_IRQ;
}

bool uart_driver_delay_done(uart_driver_t *driver)
{
    return !driver->delay_running;
}

void uart_driver_transmit(uart_driver_t *driver, const uint8_t *bytes,
                          uint8_t length)
{
#ifdef FW_TIMING_PROBE
    driver->tx_cycles = REG32(HW_CYCLE_COUNTER);
    uint32_t us = (driver->tx_cycles - driver->idle_cycles) /
        (HW_USART_CLOCK_HZ / 1000000u);
    driver->idle_to_tx_us = us > UINT16_MAX ? UINT16_MAX : (uint16_t)us;
    if (driver->idle_to_tx_us > driver->max_idle_to_tx_us)
        driver->max_idle_to_tx_us = driver->idle_to_tx_us;
#endif
    driver->transmit_complete = false;
    driver->transmitting = true;
    REG32(HW_USART_CTL0) &= ~HW_USART_REN;
    REG32(HW_USART_CTL0) |= HW_USART_TEN;
    REG32(HW_USART_INTC) = HW_USART_TC;
    REG32(HW_DMA_TX_CTL) &= ~HW_DMA_ENABLE;
    REG32(HW_DMA_TX_MEMORY) = (uint32_t)(uintptr_t)bytes;
    REG32(HW_DMA_TX_COUNT) = length;
    REG32(HW_DMA_TX_CTL) |= HW_DMA_ENABLE;
    REG32(HW_USART_CTL0) |= HW_USART_TCIE;
}

bool uart_driver_transmit_done(uart_driver_t *driver)
{
    if (!driver->transmit_complete) return false;
    driver->transmit_complete = false;
    return true;
}

bool uart_driver_take_overflow(uart_driver_t *driver)
{
    bool result = driver->overflowed;
    driver->overflowed = false;
    return result;
}

void uart_driver_abort_transmission(uart_driver_t *driver)
{
    REG32(HW_DMA_TX_CTL) &= ~HW_DMA_ENABLE;
    REG32(HW_TIMER15_CTL) &= ~HW_TIMER_ENABLE;
    REG32(HW_TIMER15_DMAINTEN) = 0;
    REG32(HW_TIMER15_INTF) = 0u;
    REG32(HW_USART_CTL0) &= ~(HW_USART_TCIE | HW_USART_TEN);
    REG32(HW_USART_CTL0) |= HW_USART_REN;
    REG32(HW_USART_INTC) = HW_USART_TC;
    driver->transmitting = false;
    driver->transmit_complete = false;
    driver->delay_running = false;
    driver->receive_idle = false;
}
