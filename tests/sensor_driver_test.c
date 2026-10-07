#include "sensor_driver.h"
#include "sensor_driver_test_port.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

sensor_mock_core_t sensor_mock_tick, sensor_mock_dwt, sensor_mock_debug, sensor_mock_scb;
volatile uintptr_t sensor_mock_registers[64];
uint32_t sensor_mock_mask;
unsigned sensor_mock_irq_enabled[5], sensor_mock_irq_priority[5];
void SysTick_Handler(void);
void I2C0_EV_IRQHandler(void);
void I2C0_ER_IRQHandler(void);
void DMA_Channel0_IRQHandler(void);
void DMA_Channel1_2_IRQHandler(void);

static void tick(void) { DWT->CYCCNT += 48000; SysTick_Handler(); }
static void event(uint32_t flag) { I2C_STAT0(0)=flag; I2C0_EV_IRQHandler(); }
static void adc(sensor_driver_t *s)
{
    s->adc_dma[0]=900; s->adc_dma[1]=400; s->adc_dma[2]=1600;
    DMA_INTF=DMA_INTF_FTFIF;
    DMA_Channel0_IRQHandler();
    DMA_INTF=0;
}
static void encoder(sensor_driver_t *s)
{
    event(I2C_STAT0_SBSEND); assert(I2C_DATA(0)==0x6c);
    event(I2C_STAT0_ADDSEND); assert(I2C_DATA(0)==0x0c);
    event(I2C_STAT0_BTC);
    assert(I2C_CTL0(0)&I2C_CTL0_START);
    event(I2C_STAT0_SBSEND); assert(I2C_DATA(0)==0x6d);
    event(I2C_STAT0_ADDSEND);
    assert((I2C_CTL1(0)&(I2C_CTL1_DMAON|I2C_CTL1_DMALST)) ==
           (I2C_CTL1_DMAON|I2C_CTL1_DMALST));
    assert(!(I2C_CTL1(0)&I2C_CTL1_EVIE));
    s->encoder_dma[0]=0x07; s->encoder_dma[1]=0x08;
    DMA_INTF=DMA_INTF_FTFIF<<8;
    DMA_Channel1_2_IRQHandler();
    DMA_INTF=0;
    assert(I2C_CTL0(0)&I2C_CTL0_STOP);
}
static void restart(sensor_driver_t *s)
{
    I2C_STAT0(0)=0; DMA_INTF=0;
    assert(sensor_driver_restart(s,false));
    assert(!s->ready && !s->in_flight && !s->recovery_pending);
}
int main(void)
{
    sensor_driver_t s;
    sensor_pair_t p;
    assert(sensor_driver_init(&s,false));
    assert(ADC_RSQ2 == (1u | (3u << 5) | (4u << 10)));
    assert(sensor_driver_restart(&s, true));
    assert(ADC_RSQ2 == (5u | (4u << 5) | (3u << 10)));
    restart(&s);
    for (unsigned i=0;i<5;++i) assert(sensor_mock_irq_priority[i]==4);
    assert(SysTick->CTRL==7);
    tick();
    uint32_t started=s.ticks;
    assert(s.in_flight && DMA_CH0CNT==3 && DMA_CH2CNT==2);
    adc(&s); assert(!sensor_driver_take_pair(&s,&p));
    encoder(&s); assert(sensor_driver_take_pair(&s,&p));
    assert(p.valid && p.encoder_raw==1800 && p.adc_raw[1]==400 && p.tick_ms==started);
    assert(!sensor_driver_take_pair(&s,&p));

    /* Either completion order is valid; duplicate completions publish nothing. */
    tick(); encoder(&s); assert(!s.ready); adc(&s);
    assert(sensor_driver_take_pair(&s,&p) && p.valid);
    DMA_INTF=DMA_INTF_FTFIF; DMA_Channel0_IRQHandler(); DMA_INTF=0;
    assert(!s.ready);
    tick(); encoder(&s); adc(&s);
    tick(); encoder(&s); adc(&s);
    assert(sensor_driver_take_pair(&s,&p) && !p.valid); /* Unread mailbox loss. */

    /* An incomplete pair survives one tick, fails at two, without publishing
     * a partial sample or performing bus recovery inside the IRQ. */
    tick(); started=s.started_tick;
    adc(&s); tick(); assert(s.in_flight && s.started_tick==started && !s.ready);
    tick(); assert(!s.in_flight && s.recovery_pending);
    assert(DMA_CH0CTL==0 && DMA_CH2CTL==0);
    assert(sensor_driver_take_pair(&s,&p) && !p.valid);
    event(I2C_STAT0_BTC); assert(!s.ready);
    sensor_driver_service(&s); assert(!s.recovery_pending);
    for (unsigned i=0;i<9;++i) { tick(); assert(!s.in_flight); }
    tick(); assert(s.in_flight);

    /* NACK and both DMA error sources discard the entire transaction. */
    event(I2C_STAT0_AERR);
    assert(sensor_driver_take_pair(&s,&p) && !p.valid && s.recovery_pending);
    restart(&s); tick(); DMA_INTF=DMA_INTF_ERRIF; DMA_Channel0_IRQHandler();
    assert(sensor_driver_take_pair(&s,&p) && !p.valid);
    restart(&s); tick(); DMA_INTF=DMA_INTF_ERRIF<<8; DMA_Channel1_2_IRQHandler();
    assert(sensor_driver_take_pair(&s,&p) && !p.valid);
    restart(&s); tick(); I2C0_ER_IRQHandler();
    assert(sensor_driver_take_pair(&s,&p) && !p.valid);

    /* Flash cancellation cannot leave a late DMA completion to re-enable data.
     * Restart extends elapsed time, including a wrapped cycle counter. */
    restart(&s); tick(); adc(&s); sensor_driver_stop(&s);
    assert(SysTick->CTRL==0 && DMA_CH0CTL==0 && DMA_CH2CTL==0);
    DMA_INTF=DMA_INTF_FTFIF<<8; DMA_Channel1_2_IRQHandler();
    tick(); assert(!sensor_driver_take_pair(&s,&p));
    uint32_t before=s.ticks;
    DWT->CYCCNT+=48000*50;
    restart(&s); assert(s.ticks>=before+50);
    s.clock.last_cycles=UINT32_MAX-23999; s.clock.remainder_cycles=0;
    DWT->CYCCNT=24000; before=s.clock.milliseconds;
    SysTick_Handler(); assert(s.ticks==before+1);
    sensor_mock_mask=1;
    (void)sensor_driver_take_pair(&s,&p);
    assert(sensor_mock_mask==1); sensor_mock_mask=0;
    puts("Sensor IRQ/DMA ordering, deadlines, mailbox and recovery: OK");
}
