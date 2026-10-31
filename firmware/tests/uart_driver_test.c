#include "uart_driver.h"
#include "bus_timing.h"
#include "uart_driver_test_port.h"
#include <assert.h>
#include <stdio.h>

void USART1_IRQHandler(void);
void DMA_Channel3_4_IRQHandler(void);
void TIMER15_IRQHandler(void);
static struct { uint32_t address, value; } registers[64];
static unsigned register_count;
volatile uint32_t *uart_test_register(uint32_t address)
{
    for (unsigned i = 0; i < register_count; ++i)
        if (registers[i].address == address) return &registers[i].value;
    assert(register_count < 64);
    registers[register_count].address = address;
    return &registers[register_count++].value;
}
static unsigned received, calls;
static void receive(void *context)
{
    ++calls;
    uint8_t byte;
    while (uart_driver_read(context, &byte)) {
        assert(byte == (uint8_t)received);
        ++received;
    }
}
int main(void)
{
    uart_driver_t driver;
    uart_driver_init(&driver, 0);
    uart_driver_set_handler(&driver, receive, &driver);
    REG32(HW_NVIC_ISPR) = 0;
    uart_driver_poll(&driver);
    assert(REG32(HW_NVIC_ISPR) == 0); /* Idle foreground must not pend IRQs. */
    REG32(HW_DMA_RX_COUNT) = UART_RX_CAPACITY - 1u;
    uart_driver_poll(&driver);
    assert(REG32(HW_NVIC_ISPR) == (1u << HW_USART1_IRQ));
    REG32(HW_NVIC_ISPR) = 0;
    REG32(HW_DMA_RX_COUNT) = UART_RX_CAPACITY;
    driver.receive_limit = 1;
    uart_driver_poll(&driver);
    assert(REG32(HW_NVIC_ISPR) == (1u << HW_USART1_IRQ));
    driver.receive_limit = 0;
    for (unsigned i = 0; i < UART_RX_CAPACITY; ++i) driver.receive[i] = (uint8_t)i;
    REG32(0x4002005cu) = 64; /* RX DMA remaining. */
    REG32(0x40020000u) = 1u << 18; /* Half transfer. */
    DMA_Channel3_4_IRQHandler();
    assert(received == 64 && !uart_driver_idle(&driver));
    REG32(0x4002005cu) = 128;
    REG32(0x40020000u) = 1u << 17;
    DMA_Channel3_4_IRQHandler();
    /* The fake MMIO bank does not implement W1C; emulate its acknowledgement. */
    REG32(0x40020000u) = 0;
    REG32(0x4000441cu) = 1u << 4;
    USART1_IRQHandler();
    assert(received == 128 && driver.receive_wraps == 1);
    assert(uart_driver_idle(&driver));
    USART1_IRQHandler();
    assert(received == 128); /* Repeated events cannot consume bytes twice. */

    const uint8_t reply[8] = {255,255,2,4,0,3,10,236};
    uart_driver_transmit(&driver, reply, sizeof(reply));
    assert((REG32(0x40004400u) & ((1u << 6) | 12u)) == ((1u << 6) | 8u));
    assert(REG32(0x40020048u) == sizeof(reply));
    REG32(0x40020048u) = 0; /* DMA empty is not wire completion. */
    REG32(0x4000441cu) = 0;
    USART1_IRQHandler();
    assert(!uart_driver_transmit_done(&driver) && driver.transmitting);
    REG32(0x4000441cu) = 1u << 6;
    USART1_IRQHandler();
    assert((REG32(0x40004400u) & ((1u << 6) | 12u)) == 4u);
    assert(uart_driver_transmit_done(&driver));
    assert(!uart_driver_transmit_done(&driver));

    uart_driver_delay(&driver, 200, 93, 7);
    assert(REG32(0x40014428u) == 47);
    assert(REG32(0x4001442cu) == 25055);
    assert(REG32(0x40014430u) == 199);
    assert(!uart_driver_delay_done(&driver));
    TIMER15_IRQHandler();
    assert(uart_driver_delay_done(&driver));
    assert(REG32(0x4001440cu) == 0);
    for (unsigned baud = 0; baud < 8; ++baud) {
        for (unsigned slot = 0; slot < 254; ++slot) {
            uint32_t duration = (slot + 1u) * bus_slot_us(93, (uint8_t)baud);
            assert(bus_response_timeout_ms((uint8_t)slot, 93, (uint8_t)baud) * 1000u > duration);
        }
    }
    assert(bus_slot_us(93, 7) == 25056);
    assert(bus_response_timeout_ms(253, 93, 7) > 6000);
    assert(bus_baud_rate(255) == 1000000);

    /* More than one ring of unread data is discarded and reported once. */
    driver.receive_wraps = 3;
    REG32(0x4002005cu) = 120;
    REG32(0x4000441cu) = 0;
    USART1_IRQHandler();
    assert(uart_driver_take_overflow(&driver));
    assert(!uart_driver_take_overflow(&driver));
    assert(received == 128 && driver.consumed == 392);
    REG32(0x4002005cu) = 118;
    REG32(0x4000441cu) = 1u << 1; /* Framing error discards the partial frame. */
    USART1_IRQHandler();
    assert(uart_driver_take_overflow(&driver));
    assert(driver.consumed == 394 && received == 128);
    uart_driver_abort_transmission(&driver);
    assert(!driver.transmitting && !driver.delay_running);
    assert(calls >= 6);
    puts("UART DMA boundaries, wire completion, large slots and deadlines: OK");
}
