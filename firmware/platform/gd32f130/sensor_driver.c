#include "sensor_driver.h"

#include <stdint.h>
#ifndef FW_SENSOR_HOST_TEST
#include "mcu.h"
#else
#include "sensor_driver_test_port.h"
#endif

static sensor_driver_t *active_driver;
enum { SENSOR_PRIORITY = 4u };
static const IRQn_Type sensor_irqs[] = {
    DMA_Channel0_IRQn, DMA_Channel1_2_IRQn, I2C0_EV_IRQn, I2C0_ER_IRQn
};

static __attribute__((noinline)) void sensor_irqs_enable(bool enable)
{
    for (unsigned i = 0; i < sizeof sensor_irqs / sizeof sensor_irqs[0]; ++i) {
        IRQn_Type irq = sensor_irqs[i];
        if (enable) {
            NVIC_SetPriority(irq, SENSOR_PRIORITY);
            NVIC_EnableIRQ(irq);
        } else {
            NVIC_DisableIRQ(irq);
            NVIC_ClearPendingIRQ(irq);
        }
    }
}

static __attribute__((noinline)) void update_clock(sensor_driver_t *driver)
{
    elapsed_clock_update(&driver->clock, DWT->CYCCNT);
    driver->ticks = driver->clock.milliseconds;
}

static uint32_t lock_sensors(void)
{
    uint32_t mask = __get_PRIMASK();
    __disable_irq();
    __DMB();
    return mask;
}

static void unlock_sensors(uint32_t mask)
{
    __DMB();
    __set_PRIMASK(mask);
}

static void dma_stop(void)
{
    DMA_CH0CTL = 0;
    DMA_CH2CTL = 0;
    DMA_INTC = 0x0f0fu;
    I2C_CTL1(I2C0) = 48u; /* Clock setting; no IRQ or DMA requests. */
}

static __attribute__((noinline)) void publish_pair(sensor_driver_t *driver, bool valid)
{
    /* Overwriting unread data must not silently count as a healthy control
     * period. Publish the newest timestamp but revoke this sample's validity. */
    valid = valid && !driver->ready;
    driver->completed = (sensor_pair_t){
        .tick_ms = driver->started_tick,
        .encoder_raw = (uint16_t)(((uint16_t)driver->encoder_dma[0] << 8) |
                                  driver->encoder_dma[1]),
        .adc_raw = {driver->adc_dma[0], driver->adc_dma[1], driver->adc_dma[2]},
        .valid = valid,
    };
    driver->ready = true;
    driver->in_flight = false;
}

static void fail_pair(sensor_driver_t *driver)
{
    dma_stop();
    I2C_CTL0(I2C0) |= I2C_CTL0_STOP;
    driver->phase = SENSOR_I2C_IDLE;
    driver->recovery_pending = true;
    publish_pair(driver, false);
}

static void complete_pair(sensor_driver_t *driver)
{
    if (driver->encoder_done && driver->adc_done) publish_pair(driver, true);
}

enum { CALIBRATION_TIMEOUT = 1000000u };

static void i2c_gpio_pause(void)
{
    for (volatile unsigned remaining = 0; remaining < 240u; ++remaining) {
        __NOP();
    }
}

static void i2c_gpio_recover(void)
{
    /* Temporarily drive SCL/SDA as open-drain GPIO. Release SDA by clocking
     * through a byte, then generate STOP. PA6 and bridge pins are untouched. */
    uint32_t control = GPIO_CTL(GPIOA);
    GPIO_CTL(GPIOA) = (control & ~(0xfu << 18)) | (1u << 18) | (1u << 20);
    GPIO_BOP(GPIOA) = (1u << 9) | (1u << 10);
    i2c_gpio_pause();
    for (unsigned pulse = 0; pulse < 9u; ++pulse) {
        if ((GPIO_ISTAT(GPIOA) & (1u << 10)) != 0u) break;
        GPIO_BC(GPIOA) = 1u << 9;
        i2c_gpio_pause();
        GPIO_BOP(GPIOA) = 1u << 9;
        i2c_gpio_pause();
    }
    GPIO_BC(GPIOA) = 1u << 10;
    i2c_gpio_pause();
    GPIO_BOP(GPIOA) = 1u << 10;
    i2c_gpio_pause();
    GPIO_CTL(GPIOA) = control;
}

static void i2c_recover(void)
{
    I2C_CTL0(I2C0) = 0;
    i2c_gpio_recover();
    I2C_CTL0(I2C0) = 1u << 15;
    __NOP(); __NOP(); __NOP();
    I2C_CTL0(I2C0) = 0;
    __NOP(); __NOP(); __NOP();
    I2C_CTL1(I2C0) = 48u;
    I2C_CKCFG(I2C0) = 240u;
    I2C_RT(I2C0) = 48u;
    I2C_STAT0(I2C0) &= ~(I2C_STAT0_BERR | I2C_STAT0_LOSTARB | I2C_STAT0_AERR | I2C_STAT0_OUERR);
    I2C_CTL0(I2C0) = 1u;
}

static bool adc_calibrate(uint32_t bit)
{
    ADC_CTL1 |= bit;
    for (uint32_t remaining = CALIBRATION_TIMEOUT; remaining != 0u; --remaining) {
        if ((ADC_CTL1 & bit) == 0u) return true;
    }
    return false;
}

void sensor_driver_stop(sensor_driver_t *driver)
{
    uint32_t mask = lock_sensors();
    driver->enabled = false;
    SysTick->CTRL = 0;
    /* A command may stop acquisition midway through an ADC scan. Stopping
     * DMA alone leaves the ADC producing results: the pending request can
     * become slot zero of the next scan and rotate all three measurements.
     * Power down the converter and its request source before disabling DMA. */
    ADC_CTL1 = 0;
    dma_stop();
    I2C_CTL0(I2C0) = 0;
    sensor_irqs_enable(false);
    SCB->ICSR = SCB_ICSR_PENDSTCLR_Msk;
    driver->in_flight = driver->ready = false;
    unlock_sensors(mask);
}

bool sensor_driver_init(sensor_driver_t *driver, bool complementary_output)
{
    *driver = (sensor_driver_t){0};
    CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
    DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;
    uint32_t initial_cycles = DWT->CYCCNT;
    for (unsigned i = 0; i < 32u; ++i) __NOP();
    if (DWT->CYCCNT == initial_cycles) return false;
    driver->clock.last_cycles = DWT->CYCCNT;
    active_driver = driver;
    return sensor_driver_restart(driver, complementary_output);
}

bool sensor_driver_restart(sensor_driver_t *driver, bool complementary_output)
{
    sensor_driver_stop(driver);
    update_clock(driver);
    driver->phase = SENSOR_I2C_IDLE;
    driver->recovery_pending = false;
    driver->recovery_cooldown = 0;
    /* stop() cancelled the mailbox; begin_pair() resets completion state.
     * DMA rewrites every byte before publication, so buffers need no reset. */
    active_driver = driver;

    /* PA9/PA10: AF4, open-drain. The reconstruction constants named PA6
     * target PA9's bit positions; PA6 remains the disabled bridge gate. */
    GPIO_AFSEL1(GPIOA) = (GPIO_AFSEL1(GPIOA) &
        ~(GPIO_AFSEL1_SEL9 | GPIO_AFSEL1_SEL10)) |
        (GPIO_AF_4 << 4) | (GPIO_AF_4 << 8);
    GPIO_OMODE(GPIOA) |= (1u << 9) | (1u << 10);
    GPIO_OSPD(GPIOA) |= (1u << 18) | (1u << 20);
    GPIO_CTL(GPIOA) = (GPIO_CTL(GPIOA) & ~(0xfu << 18)) |
                            (2u << 18) | (2u << 20);
    RCU_APB1EN |= RCU_APB1EN_I2C0EN;
    i2c_recover();

    RCU_APB2EN |= RCU_APB2EN_ADCEN;
    /* Factory DMA slots: normal [1=temp, 3=current, 4=voltage];
     * complementary [3=voltage, 4=current, 5=temp]. Scan order is
     * immaterial to the portable converter once arranged logically. */
    if (complementary_output) {
        GPIO_CTL(GPIOA) |= (3u << 6) | (3u << 8) | (3u << 10);
        ADC_SAMPT1 |= (1u << 9) | (1u << 12) | (1u << 15);
        ADC_RSQ2 = 5u | (4u << 5) | (3u << 10);
    } else {
        GPIO_CTL(GPIOA) |= (3u << 2) | (3u << 6) | (3u << 8);
        ADC_SAMPT1 |= (1u << 3) | (1u << 9) | (1u << 12);
        ADC_RSQ2 = 1u | (3u << 5) | (4u << 10);
    }
    ADC_RSQ0 = 2u << 20;
    ADC_CTL0 = 1u << 8; /* One software-triggered scan; no inherited modes. */
    ADC_CTL1 = ADC_CTL1_ADCON;
    /* Calibration requires at least 14 ADC clocks after power-on. At the
     * board's 48 MHz CPU / 14 MHz ADC clocks, 64 NOPs exceed that interval. */
    for (unsigned i = 0; i < 64u; ++i) __NOP();
    /* Power-off already reset calibration; only the calibration itself is
     * needed here (the separate RSTCLB step is optional in the ADC manual). */
    if (!adc_calibrate(1u << 2)) return false;
    ADC_CTL1 = ADC_CTL1_ETSRC | ADC_CTL1_ETERC |
        ADC_CTL1_DMA | ADC_CTL1_ADCON;

    DMA_CH0PADDR = (uintptr_t)&ADC_RDATA;
    DMA_CH0MADDR = (uintptr_t)driver->adc_dma;
    DMA_CH2PADDR = (uintptr_t)&I2C_DATA(I2C0);
    DMA_CH2MADDR = (uintptr_t)driver->encoder_dma;
    DMA_INTC = 0x0f0fu;

    /* Same-priority sensor IRQs cannot interleave transaction mutations.
     * UART retains its own priority and DMA channels 3/4. */
    NVIC_SetPriority(SysTick_IRQn, SENSOR_PRIORITY);
    sensor_irqs_enable(true);
    driver->enabled = true;
    SysTick->LOAD = 47999u;
    SysTick->VAL = 0u;
    SysTick->CTRL = 7u; /* 1 kHz, processor clock, interrupt enabled. */
    return true;
}

uint32_t sensor_driver_ticks(const sensor_driver_t *driver)
{
    return driver->ticks;
}

static void begin_pair(sensor_driver_t *driver)
{
    driver->started_tick = driver->ticks;
    driver->in_flight = true;
    driver->encoder_done = driver->adc_done = false;
    driver->phase = SENSOR_I2C_WRITE_START;
    DMA_CH0CNT = 3u;
    DMA_CH0CTL = DMA_CHXCTL_CMEN | DMA_CHXCTL_MNAGA |
        DMA_PERIPHERAL_WIDTH_16BIT | DMA_MEMORY_WIDTH_16BIT |
        DMA_PRIORITY_MEDIUM | DMA_CHXCTL_FTFIE | DMA_CHXCTL_ERRIE | DMA_CHXCTL_CHEN;
    DMA_CH2CNT = 2u;
    DMA_CH2CTL = DMA_CHXCTL_MNAGA | DMA_PRIORITY_MEDIUM |
        DMA_CHXCTL_FTFIE | DMA_CHXCTL_ERRIE | DMA_CHXCTL_CHEN;
    I2C_CTL1(I2C0) = 48u | I2C_CTL1_ERRIE | I2C_CTL1_EVIE;
    I2C_CTL0(I2C0) = 1u | I2C_CTL0_ACKEN | I2C_CTL0_START;
    ADC_CTL1 |= ADC_CTL1_SWRCST;
}

void SysTick_Handler(void)
{
    sensor_driver_t *driver = active_driver;
    if (driver == 0 || !driver->enabled) return;
    update_clock(driver);
    if (driver->in_flight) {
        if ((uint32_t)(driver->ticks - driver->started_tick) >= 2u) fail_pair(driver);
        return; /* Never replace a transaction within its deadline. */
    }
    if (driver->recovery_pending) return;
    if (driver->recovery_cooldown) { --driver->recovery_cooldown; return; }
    begin_pair(driver);
}

void sensor_driver_service(sensor_driver_t *driver)
{
    if (!driver->enabled || !driver->recovery_pending) return;
    /* Error IRQs have disabled peripheral/DMA requests. The timer keeps time
     * but cannot restart acquisition until this bounded recovery completes. */
    i2c_recover();
    uint32_t mask = lock_sensors();
    for (unsigned i = 0; i < sizeof sensor_irqs / sizeof sensor_irqs[0]; ++i)
        NVIC_ClearPendingIRQ(sensor_irqs[i]);
    driver->recovery_cooldown = 9u;
    driver->recovery_pending = false;
    unlock_sensors(mask);
}

bool sensor_driver_take_pair(sensor_driver_t *driver, sensor_pair_t *pair)
{
    uint32_t mask = lock_sensors();
    bool ready = driver->ready;
    if (ready) { *pair = driver->completed; driver->ready = false; }
    unlock_sensors(mask);
    return ready;
}

void I2C0_ER_IRQHandler(void)
{
    sensor_driver_t *driver = active_driver;
    if (driver != 0 && driver->in_flight) fail_pair(driver);
}

void I2C0_EV_IRQHandler(void)
{
    sensor_driver_t *driver = active_driver;
    if (driver == 0 || !driver->in_flight) return;
    uint32_t status = I2C_STAT0(I2C0);
    if (status & (I2C_STAT0_BERR | I2C_STAT0_LOSTARB | I2C_STAT0_AERR | I2C_STAT0_OUERR)) {
        fail_pair(driver);
        return;
    }
    switch (driver->phase) {
    case SENSOR_I2C_WRITE_START:
        if (status & I2C_STAT0_SBSEND) {
            I2C_DATA(I2C0) = 0x36u << 1;
            driver->phase = SENSOR_I2C_WRITE_ADDRESS;
        }
        break;
    case SENSOR_I2C_WRITE_ADDRESS:
        if (status & I2C_STAT0_ADDSEND) {
            (void)I2C_STAT1(I2C0);
            I2C_DATA(I2C0) = 0x0cu;
            driver->phase = SENSOR_I2C_REGISTER_SENT;
        }
        break;
    case SENSOR_I2C_REGISTER_SENT:
        if (status & I2C_STAT0_BTC) {
            /* Preserve the encoder's verified repeated-START ordering. */
            /* The status read at IRQ entry precedes this DATA access. */
            (void)I2C_DATA(I2C0);
            I2C_CTL0(I2C0) |= I2C_CTL0_START;
            driver->phase = SENSOR_I2C_READ_START;
        }
        break;
    case SENSOR_I2C_READ_START:
        if (status & I2C_STAT0_SBSEND) {
            I2C_DATA(I2C0) = (0x36u << 1) | 1u;
            driver->phase = SENSOR_I2C_READ_ADDRESS;
        }
        break;
    case SENSOR_I2C_READ_ADDRESS:
        if (status & I2C_STAT0_ADDSEND) {
            /* Two-byte DMA receive: hardware NACKs the last byte; the DMA
             * completion IRQ requests STOP. Disable event IRQs before data. */
            I2C_CTL1(I2C0) = 48u | I2C_CTL1_ERRIE | I2C_CTL1_DMAON | I2C_CTL1_DMALST;
            /* CTL1 setup intervened after the IRQ status read. Repeat STAT0
             * immediately before STAT1 or ADDSEND remains set on this MCU,
             * holding SCL low and preventing the DMA receive from starting. */
            (void)I2C_STAT0(I2C0);
            (void)I2C_STAT1(I2C0);
            driver->phase = SENSOR_I2C_RECEIVE;
        }
        break;
    default: break;
    }
}

void DMA_Channel0_IRQHandler(void)
{
    uint32_t flags = DMA_INTF;
    DMA_INTC = 0x0fu;
    sensor_driver_t *driver = active_driver;
    if (driver == 0 || !driver->in_flight || driver->adc_done) return;
    if (flags & DMA_INTF_ERRIF) { fail_pair(driver); return; }
    if (!(flags & DMA_INTF_FTFIF)) return;
    DMA_CH0CTL = 0;
    driver->adc_done = true;
    complete_pair(driver);
}

void DMA_Channel1_2_IRQHandler(void)
{
    uint32_t flags = DMA_INTF >> 8;
    DMA_INTC = 0x0f00u; /* Channel 2 only; channel 1 is unused. */
    sensor_driver_t *driver = active_driver;
    if (driver == 0 || !driver->in_flight) return;
    if (flags & DMA_INTF_ERRIF) { fail_pair(driver); return; }
    if (!(flags & DMA_INTF_FTFIF) || driver->phase != SENSOR_I2C_RECEIVE) return;
    DMA_CH2CTL = 0;
    I2C_CTL0(I2C0) |= I2C_CTL0_STOP;
    I2C_CTL1(I2C0) = 48u;
    driver->phase = SENSOR_I2C_IDLE;
    driver->encoder_done = true;
    complete_pair(driver);
}
