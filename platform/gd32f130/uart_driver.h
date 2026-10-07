#ifndef UART_DRIVER_H
#define UART_DRIVER_H

#include <stdbool.h>
#include <stdint.h>

enum { UART_RX_CAPACITY = 128 };
_Static_assert((UART_RX_CAPACITY & (UART_RX_CAPACITY - 1)) == 0,
               "UART RX ring capacity must be a power of two");

typedef void (*uart_service_handler_t)(void *context);

/* DMA produces RX bytes. Same-priority USART/DMA/TIMER IRQs own RX cursors,
 * line-idle, delay and TX completion. Foreground only accesses shared state
 * with these IRQs masked, apart from volatile RX progress hints used to
 * request service via NVIC pending. Those hints transfer no ownership. */
typedef struct {
    uart_service_handler_t handler;
    void *context;
    volatile uint8_t receive[UART_RX_CAPACITY];
    volatile uint32_t receive_wraps;
    volatile bool receive_error;
    volatile uint32_t consumed;
    volatile uint32_t receive_limit;
    volatile uint32_t last_dma_count;
    bool receive_idle;
    volatile bool transmitting;
    volatile bool transmit_complete;
    bool delay_running;
    bool overflowed;
#ifdef FW_TIMING_PROBE
    uint16_t max_rx_occupancy;
    volatile uint32_t idle_cycles;
    uint32_t tx_cycles;
    volatile uint16_t idle_to_tx_us, max_idle_to_tx_us;
    volatile uint16_t tx_duration_us, max_tx_duration_us;
#endif
} uart_driver_t;

void uart_driver_init(uart_driver_t *driver, uint8_t baud_index);
void uart_driver_set_handler(uart_driver_t *driver,
                             uart_service_handler_t handler, void *context);
/* Non-nesting foreground critical section for response/mailbox handoff.
 * Snapshot copying itself runs with IRQs enabled. */
void uart_driver_lock(void);
void uart_driver_unlock(void);
void uart_driver_poll(uart_driver_t *driver);
bool uart_driver_read(uart_driver_t *driver, uint8_t *byte);
bool uart_driver_idle(const uart_driver_t *driver);
void uart_driver_set_baud(uart_driver_t *driver, uint8_t baud_index);
void uart_driver_delay(uart_driver_t *driver, uint8_t slot,
                       uint8_t response_length, uint8_t baud_index);
bool uart_driver_delay_done(uart_driver_t *driver);
void uart_driver_transmit(uart_driver_t *driver, const uint8_t *bytes,
                          uint8_t length);
bool uart_driver_transmit_done(uart_driver_t *driver);
bool uart_driver_take_overflow(uart_driver_t *driver);
/* Fail-safe cleanup for a stalled response slot or TX completion. */
void uart_driver_abort_transmission(uart_driver_t *driver);

#endif
