#include "sensor_driver.h"

#include <stdint.h>
#include "mcu.h"

enum { CALIBRATION_TIMEOUT = 1000000u };

static void i2c_gpio_pause(void)
{
    for (volatile unsigned remaining = 0; remaining < 240u; ++remaining) {
        __asm volatile("nop");
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
    __asm volatile("nop\n nop\n nop");
    I2C_CTL0(I2C0) = 0;
    __asm volatile("nop\n nop\n nop");
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

bool sensor_driver_init(sensor_driver_t *driver, bool complementary_output)
{
    *driver = (sensor_driver_t){0};
    CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
    DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;
    uint32_t initial_cycles = DWT->CYCCNT;
    /* Fail closed if the target does not provide a running cycle counter. */
    for (unsigned i=0; i<32u; ++i) __asm volatile("nop");
    if (DWT->CYCCNT == initial_cycles) return false;
    driver->clock.last_cycles = DWT->CYCCNT;
    /* SysTick supplies the 1 kHz acquisition cadence without an IRQ.
     * TIMER0 and bridge pins belong exclusively to the board/bridge driver. */
    SysTick->LOAD = 47999u;
    SysTick->VAL = 0u;
    SysTick->CTRL = 5u;

    return sensor_driver_restart(driver, complementary_output);
}

bool sensor_driver_restart(sensor_driver_t *driver, bool complementary_output)
{
    uint32_t ticks = driver->ticks;
    elapsed_clock_t clock = driver->clock;
    uint32_t generation = driver->generation;
    /* DMA may still target the old buffer while foreground was stalled. Stop
     * it before clearing driver state and reconfiguring the ADC. */
    DMA_CH0CTL = 0u;
    I2C_CTL0(I2C0) = 0u;
    *driver = (sensor_driver_t){0};
    driver->ticks = ticks;
    driver->clock = clock;
    driver->generation = generation;

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
    const uint32_t channels[3] = {
        complementary_output ? 5u : 1u,
        complementary_output ? 4u : 3u,
        complementary_output ? 3u : 4u
    };
    for (unsigned i = 0; i < 3; ++i) {
        unsigned channel = channels[i];
        GPIO_CTL(GPIOA) |= 3u << (channel * 2u);
        ADC_SAMPT1 |= 1u << (channel * 3u);
    }
    ADC_RSQ2 = channels[0] | (channels[1] << 5) |
                             (channels[2] << 10);
    ADC_RSQ0 = 2u << 20;
    ADC_CTL0 |= 1u << 8;
    ADC_CTL1 |= ADC_CTL1_ETSRC | ADC_CTL1_ETERC |
        ADC_CTL1_DMA | ADC_CTL1_ADCON;
    if (!adc_calibrate(1u << 3) || !adc_calibrate(1u << 2)) return false;

    DMA_CH0CTL = 0;
    DMA_CH0PADDR = (uint32_t)(uintptr_t)&ADC_RDATA;
    DMA_CH0MADDR = (uint32_t)(uintptr_t)driver->adc_dma;
    DMA_INTC = 0x0fu;
    return true;
}

bool sensor_driver_timer_tick(sensor_driver_t *driver)
{
    /* COUNTFLAG schedules acquisition only. Elapsed time must count every
     * hardware cycle even if foreground missed several SysTick periods. */
    elapsed_clock_update(&driver->clock, DWT->CYCCNT);
    driver->ticks = driver->clock.milliseconds;
    if ((SysTick->CTRL & (1u << 16)) == 0u) return false;
    return true;
}

uint32_t sensor_driver_ticks(const sensor_driver_t *driver)
{
    return driver->ticks;
}

void sensor_driver_begin(sensor_driver_t *driver, uint32_t generation)
{
    driver->generation = generation;
    if (driver->phase != SENSOR_I2C_IDLE) {
        i2c_recover();
        driver->phase = SENSOR_I2C_IDLE;
        driver->recovery_cooldown = 9u;
    }
    driver->encoder_ready = false;
    driver->encoder_failed = false;
    driver->adc_ready = false;
    driver->adc_failed = false;
    driver->started_tick = driver->ticks;
    if (driver->recovery_cooldown != 0u) {
        --driver->recovery_cooldown;
        driver->encoder_failed = true;
    } else {
        driver->phase = SENSOR_I2C_WRITE_START;
        I2C_CTL0(I2C0) = 1u | I2C_CTL0_ACKEN | I2C_CTL0_START;
    }

    DMA_CH0CTL = (DMA_CHXCTL_CMEN | DMA_CHXCTL_MNAGA |
        DMA_PERIPHERAL_WIDTH_16BIT | DMA_MEMORY_WIDTH_16BIT |
        DMA_PRIORITY_MEDIUM);
    DMA_INTC = 0x0fu;
    DMA_CH0CNT = 3u;
    DMA_CH0CTL |= 1u;
    ADC_CTL1 |= 1u << 22;
    driver->adc_active = true;
}

bool sensor_driver_take_encoder(sensor_driver_t *driver, uint32_t *generation,
                                bool *valid, uint16_t *raw_angle)
{
    if (!driver->encoder_ready && !driver->encoder_failed) return false;
    *generation = driver->generation;
    *valid = driver->encoder_ready;
    *raw_angle = driver->encoder_raw;
    driver->encoder_ready = false;
    driver->encoder_failed = false;
    return true;
}

bool sensor_driver_take_adc(sensor_driver_t *driver, uint32_t *generation,
                            bool *valid, uint16_t samples[3])
{
    if (!driver->adc_ready && !driver->adc_failed) return false;
    *generation = driver->generation;
    *valid = driver->adc_ready;
    for (unsigned i = 0; i < 3; ++i) samples[i] = driver->adc_dma[i];
    driver->adc_ready = false;
    driver->adc_failed = false;
    return true;
}

static void i2c_fail(sensor_driver_t *driver)
{
    i2c_recover();
    driver->phase = SENSOR_I2C_IDLE;
    driver->encoder_failed = true;
    driver->recovery_cooldown = 9u;
}

void sensor_driver_poll(sensor_driver_t *driver)
{
    if (driver->adc_active) {
        uint32_t flags = DMA_INTF;
        if ((flags & DMA_INTF_ERRIF) != 0u) {
            DMA_CH0CTL = 0;
            DMA_INTC = 0x0fu;
            driver->adc_active = false;
            driver->adc_failed = true;
        } else if ((flags & DMA_INTF_FTFIF) != 0u) {
            DMA_CH0CTL = 0;
            DMA_INTC = 0x0fu;
            driver->adc_active = false;
            driver->adc_ready = true;
        }
    }
    if (driver->phase == SENSOR_I2C_IDLE) return;
    if ((uint32_t)(driver->ticks - driver->started_tick) >= 2u ||
        (I2C_STAT0(I2C0) & (I2C_STAT0_BERR | I2C_STAT0_LOSTARB | I2C_STAT0_AERR | I2C_STAT0_OUERR)) != 0u) {
        i2c_fail(driver);
        return;
    }
    uint32_t status = I2C_STAT0(I2C0);
    switch (driver->phase) {
    case SENSOR_I2C_WRITE_START:
        if ((status & I2C_STAT0_SBSEND) != 0u) {
            I2C_DATA(I2C0) = 0x36u << 1;
            driver->phase = SENSOR_I2C_WRITE_ADDRESS;
        }
        break;
    case SENSOR_I2C_WRITE_ADDRESS:
        if ((status & I2C_STAT0_ADDSEND) != 0u) {
            (void)I2C_STAT1(I2C0);
            I2C_DATA(I2C0) = 0x0cu;
            driver->phase = SENSOR_I2C_REGISTER_SENT;
        }
        break;
    case SENSOR_I2C_REGISTER_SENT:
        if ((status & I2C_STAT0_BTC) != 0u) {
            /* Clear the write-byte transfer state before issuing repeated
             * START. Leaving DATA unread can make the following two-byte
             * receive appear as a duplicated first byte. */
            (void)I2C_STAT0(I2C0);
            (void)I2C_DATA(I2C0);
            I2C_CTL0(I2C0) |= I2C_CTL0_POAP | I2C_CTL0_START;
            driver->phase = SENSOR_I2C_READ_START;
        }
        break;
    case SENSOR_I2C_READ_START:
        if ((status & I2C_STAT0_SBSEND) != 0u) {
            I2C_DATA(I2C0) = (0x36u << 1) | 1u;
            driver->phase = SENSOR_I2C_READ_ADDRESS;
        }
        break;
    case SENSOR_I2C_READ_ADDRESS:
        if ((status & I2C_STAT0_ADDSEND) != 0u) {
            I2C_CTL0(I2C0) &= ~I2C_CTL0_ACKEN;
            (void)I2C_STAT0(I2C0);
            (void)I2C_STAT1(I2C0);
            driver->phase = SENSOR_I2C_READ_BYTES;
        }
        break;
    case SENSOR_I2C_READ_BYTES:
        if ((status & (I2C_STAT0_BTC | I2C_STAT0_RBNE)) ==
            (I2C_STAT0_BTC | I2C_STAT0_RBNE)) {
            I2C_CTL0(I2C0) |= I2C_CTL0_STOP;
            driver->encoder_high = (uint8_t)I2C_DATA(I2C0);
            driver->phase = SENSOR_I2C_READ_LOW;
        }
        break;
    case SENSOR_I2C_READ_LOW:
        if ((status & I2C_STAT0_RBNE) != 0u) {
            uint16_t low = (uint8_t)I2C_DATA(I2C0);
            driver->encoder_raw = (uint16_t)(
                ((uint16_t)driver->encoder_high << 8) | low);
            driver->encoder_ready = true;
            driver->phase = SENSOR_I2C_IDLE;
        }
        break;
    default:
        i2c_fail(driver);
        break;
    }
}
