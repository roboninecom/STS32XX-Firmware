#ifndef SENSOR_DRIVER_TEST_PORT_H
#define SENSOR_DRIVER_TEST_PORT_H
#include <stdint.h>
/* Bit definitions expanded from the vendored GD32F1x0 headers. Only register
 * storage and CPU interrupt primitives are fake; tests execute sensor_driver.c. */
enum {
ADC_CTL1_ADCON = ((uint32_t)((uint32_t)0x01U<<(0))),
ADC_CTL1_DMA = ((uint32_t)((uint32_t)0x01U<<(8))),
ADC_CTL1_ETERC = ((uint32_t)((uint32_t)0x01U<<(20))),
ADC_CTL1_ETSRC = ((0xFFFFFFFFUL << (17)) & (0xFFFFFFFFUL >> (31U - (uint32_t)(19)))),
ADC_CTL1_SWRCST = ((uint32_t)((uint32_t)0x01U<<(22))),
DMA_CHXCTL_CHEN = ((uint32_t)((uint32_t)0x01U<<(0))),
DMA_CHXCTL_CMEN = ((uint32_t)((uint32_t)0x01U<<(5))),
DMA_CHXCTL_ERRIE = ((uint32_t)((uint32_t)0x01U<<(3))),
DMA_CHXCTL_FTFIE = ((uint32_t)((uint32_t)0x01U<<(1))),
DMA_CHXCTL_MNAGA = ((uint32_t)((uint32_t)0x01U<<(7))),
DMA_INTF_ERRIF = ((uint32_t)((uint32_t)0x01U<<(3))),
DMA_INTF_FTFIF = ((uint32_t)((uint32_t)0x01U<<(1))),
DMA_MEMORY_WIDTH_16BIT = (((0xFFFFFFFFUL << (10)) & (0xFFFFFFFFUL >> (31U - (uint32_t)(11)))) & ((1U) << 10U)),
DMA_PERIPHERAL_WIDTH_16BIT = (((0xFFFFFFFFUL << (8)) & (0xFFFFFFFFUL >> (31U - (uint32_t)(9)))) & ((1U) << 8U)),
DMA_PRIORITY_MEDIUM = (((0xFFFFFFFFUL << (12)) & (0xFFFFFFFFUL >> (31U - (uint32_t)(13)))) & ((uint32_t)(1U) << 12U)),
GPIO_AFSEL1_SEL10 = ((0xFFFFFFFFUL << (8)) & (0xFFFFFFFFUL >> (31U - (uint32_t)(11)))),
GPIO_AFSEL1_SEL9 = ((0xFFFFFFFFUL << (4)) & (0xFFFFFFFFUL >> (31U - (uint32_t)(7)))),
GPIO_AF_4 = (((0xFFFFFFFFUL << (0)) & (0xFFFFFFFFUL >> (31U - (uint32_t)(3)))) & ((uint32_t)(4) << 0)),
I2C_CTL0_ACKEN = ((uint32_t)((uint32_t)0x01U<<(10))),
I2C_CTL0_START = ((uint32_t)((uint32_t)0x01U<<(8))),
I2C_CTL0_STOP = ((uint32_t)((uint32_t)0x01U<<(9))),
I2C_CTL1_DMALST = ((uint32_t)((uint32_t)0x01U<<(12))),
I2C_CTL1_DMAON = ((uint32_t)((uint32_t)0x01U<<(11))),
I2C_CTL1_ERRIE = ((uint32_t)((uint32_t)0x01U<<(8))),
I2C_CTL1_EVIE = ((uint32_t)((uint32_t)0x01U<<(9))),
I2C_STAT0_ADDSEND = ((uint32_t)((uint32_t)0x01U<<(1))),
I2C_STAT0_AERR = ((uint32_t)((uint32_t)0x01U<<(10))),
I2C_STAT0_BERR = ((uint32_t)((uint32_t)0x01U<<(8))),
I2C_STAT0_BTC = ((uint32_t)((uint32_t)0x01U<<(2))),
I2C_STAT0_LOSTARB = ((uint32_t)((uint32_t)0x01U<<(9))),
I2C_STAT0_OUERR = ((uint32_t)((uint32_t)0x01U<<(11))),
I2C_STAT0_SBSEND = ((uint32_t)((uint32_t)0x01U<<(0))),
RCU_APB1EN_I2C0EN = ((uint32_t)((uint32_t)0x01U<<(21))),
RCU_APB2EN_ADCEN = ((uint32_t)((uint32_t)0x01U<<(9))),
};
typedef int IRQn_Type;
enum { SysTick_IRQn=0, DMA_Channel0_IRQn, DMA_Channel1_2_IRQn, I2C0_EV_IRQn, I2C0_ER_IRQn };
enum { CoreDebug_DEMCR_TRCENA_Msk=1, DWT_CTRL_CYCCNTENA_Msk=1, SCB_ICSR_PENDSTCLR_Msk=1 };
typedef struct { volatile uint32_t CTRL, LOAD, VAL, CYCCNT, DEMCR, ICSR; } sensor_mock_core_t;
extern sensor_mock_core_t sensor_mock_tick, sensor_mock_dwt, sensor_mock_debug, sensor_mock_scb;
#define SysTick (&sensor_mock_tick)
#define DWT (&sensor_mock_dwt)
#define CoreDebug (&sensor_mock_debug)
#define SCB (&sensor_mock_scb)
#define GPIOA 0
#define I2C0 0
extern volatile uintptr_t sensor_mock_registers[64];
extern uint32_t sensor_mock_mask;
extern unsigned sensor_mock_irq_enabled[5], sensor_mock_irq_priority[5];
static inline uint32_t __get_PRIMASK(void) { return sensor_mock_mask; }
static inline void __disable_irq(void) { sensor_mock_mask=1; }
static inline void __set_PRIMASK(uint32_t v) { sensor_mock_mask=v; }
static inline void __DMB(void) {}
static inline void __NOP(void) { ++DWT->CYCCNT; }
static inline void NVIC_EnableIRQ(unsigned n) { sensor_mock_irq_enabled[n]=1; }
static inline void NVIC_DisableIRQ(unsigned n) { sensor_mock_irq_enabled[n]=0; }
static inline void NVIC_ClearPendingIRQ(unsigned n) { (void)n; }
static inline void NVIC_SetPriority(unsigned n, unsigned p) { sensor_mock_irq_priority[n]=p; }
#define ADC_CTL0 sensor_mock_registers[0]
#define ADC_RDATA sensor_mock_registers[1]
#define ADC_RSQ0 sensor_mock_registers[2]
#define ADC_RSQ2 sensor_mock_registers[3]
#define ADC_SAMPT1 sensor_mock_registers[4]
#define DMA_CH0CNT sensor_mock_registers[5]
#define DMA_CH0CTL sensor_mock_registers[6]
#define DMA_CH0MADDR sensor_mock_registers[7]
#define DMA_CH0PADDR sensor_mock_registers[8]
#define DMA_CH2CNT sensor_mock_registers[9]
#define DMA_CH2CTL sensor_mock_registers[10]
#define DMA_CH2MADDR sensor_mock_registers[11]
#define DMA_CH2PADDR sensor_mock_registers[12]
#define DMA_INTC sensor_mock_registers[13]
#define DMA_INTF sensor_mock_registers[14]
#define RCU_APB1EN sensor_mock_registers[15]
#define RCU_APB2EN sensor_mock_registers[16]
#define GPIO_AFSEL1(unused) sensor_mock_registers[17]
#define GPIO_BC(unused) sensor_mock_registers[18]
#define GPIO_BOP(unused) sensor_mock_registers[19]
#define GPIO_CTL(unused) sensor_mock_registers[20]
#define GPIO_ISTAT(unused) sensor_mock_registers[21]
#define GPIO_OMODE(unused) sensor_mock_registers[22]
#define GPIO_OSPD(unused) sensor_mock_registers[23]
#define I2C_CKCFG(unused) sensor_mock_registers[24]
#define I2C_CTL0(unused) sensor_mock_registers[25]
#define I2C_CTL1(unused) sensor_mock_registers[26]
#define I2C_DATA(unused) sensor_mock_registers[27]
#define I2C_RT(unused) sensor_mock_registers[28]
#define I2C_STAT0(unused) sensor_mock_registers[29]
#define I2C_STAT1(unused) sensor_mock_registers[30]
static inline volatile uintptr_t *sensor_mock_adc(void) {
    sensor_mock_registers[63] &= ~((1u<<2) | (1u<<3));
    return &sensor_mock_registers[63];
}
#define ADC_CTL1 (*sensor_mock_adc())
#endif
