#include "diagnostic_service.h"

#include "app_runtime.h"
#ifdef FW_FLASH_DUMP
#include "flash_dump_target.h"
#endif
#ifdef FW_TIMING_PROBE
#include "diagnostics.h"
#endif

#ifdef FW_ARM_TIMING_PROBE
uint16_t arm_motion_iterations;
static struct { uint32_t maximum; uint16_t samples, iterations; } motion_timing[ARM_TIMING_COUNT];
uint32_t arm_motion_clock(void) { return diagnostics_probe_cycles(); }
__attribute__((noinline)) void arm_motion_record(unsigned operation, uint32_t started)
{
    uint32_t elapsed = diagnostics_probe_cycles() - started;
    if (elapsed > motion_timing[operation].maximum) {
        motion_timing[operation].maximum = elapsed;
        motion_timing[operation].iterations = arm_motion_iterations;
    }
    if (motion_timing[operation].samples != UINT16_MAX) ++motion_timing[operation].samples;
}
#endif

void diagnostic_service_early_init(struct app_state *state)
{
#ifdef FW_TIMING_PROBE
    diagnostics_probe_init(&state->timing_stack_mark_end);
#else
    (void)state;
#endif
}

void diagnostic_service_device_init(struct app_state *state)
{
#ifdef FW_FLASH_DUMP
    flash_dump_window(0u, state->device.registers.byte + 73);
#else
    (void)state;
#endif
}

void diagnostic_service_write(struct app_state *state,
                              const register_write_result_t *write)
{
    if (!registers_write_touches(write, 50u, 50u)) return;
#ifdef FW_ARM_TIMING_PROBE
    if (state->device.registers.byte[REG_UNDOCUMENTED_RUNTIME50] == 210u) {
        unsigned char *bytes = (unsigned char *)motion_timing;
        for (unsigned i = 0; i < sizeof motion_timing; ++i) bytes[i] = 0;
        state->timing_control_max_cycles = 0;
        state->timing_control_samples = 0;
        state->timing_arm_revocation = 0;
        state->bus.command_dispatch_max_cycles = 0;
    }
#endif

#ifdef FW_FLASH_DUMP
    flash_dump_window(state->device.registers.byte[REG_UNDOCUMENTED_RUNTIME50],
                      state->device.registers.byte + 73);
#else
    (void)state;
#endif
}

void diagnostic_service_period_started(struct app_state *state,
                                     uint32_t started_cycles, uint16_t late_us)
{
#if defined(FW_TIMING_PROBE) && !defined(FW_ARM_TIMING_PROBE)
    if (late_us > state->timing_max_tick_late_us) state->timing_max_tick_late_us = late_us;
    state->timing_started_cycles = started_cycles;
#else
    (void)state; (void)started_cycles; (void)late_us;
#endif
}

void diagnostic_service_goal_queued(struct app_state *state)
{
#if defined(FW_TIMING_PROBE) && !defined(FW_ARM_TIMING_PROBE)
    if (state->goal_timing_pending && state->goal_replaced_count != UINT16_MAX)
        ++state->goal_replaced_count;
    state->goal_packet_cycles = state->bus.command_completed_cycles;
    state->goal_timing_pending = true;
#else
    (void)state;
#endif
}

uint32_t diagnostic_service_goal_started(struct app_state *state)
{
#if defined(FW_TIMING_PROBE) && !defined(FW_ARM_TIMING_PROBE)
    (void)state;
    return diagnostics_probe_cycles();
#else
    (void)state;
    return 0u;
#endif
}

void diagnostic_service_goal_applied(struct app_state *state,
                                     uint32_t control_started_cycles)
{
#if defined(FW_TIMING_PROBE) && !defined(FW_ARM_TIMING_PROBE)
    uint32_t output_cycles = diagnostics_probe_cycles();
    if (!state->goal_timing_pending) return;
    state->goal_timing_pending = false;
    if (state->goal_timing_count < 1024u) ++state->goal_timing_count;
    diagnostics_record(&state->goal_control_mean_cycles,
                   &state->goal_control_max_cycles,
                   control_started_cycles - state->goal_packet_cycles,
                   state->goal_timing_count);
    diagnostics_record(&state->goal_output_mean_cycles,
                   &state->goal_output_max_cycles,
                   output_cycles - state->goal_packet_cycles,
                   state->goal_timing_count);
#else
    (void)state;
    (void)control_started_cycles;
#endif
}

void diagnostic_service_pair_rejected(struct app_state *state)
{
#ifdef FW_TIMING_PROBE
    if (state->timing_rejected_pairs == UINT16_MAX) return;
    ++state->timing_rejected_pairs;
#ifndef FW_ARM_TIMING_PROBE
    registers_set_u16(&state->device.registers, REG_ACTIVE_PROFILE_GOAL_POSITION, state->timing_rejected_pairs);
    registers_set_u16(&state->device.registers, REG_PRESENT_CURRENT,
                      state->sensor_service.encoder_raw);
#endif
#else
    (void)state;
#endif
}

void diagnostic_service_pair_complete(struct app_state *state)
{
#ifdef FW_TIMING_PROBE
    register_table_t *registers = &state->device.registers;
#ifndef FW_ARM_TIMING_PROBE
    uint32_t cycles = diagnostics_probe_cycles() - state->timing_started_cycles;
    uint32_t us = cycles / 48u;
    if (us > 65535u) us = 65535u;
    if (us > state->timing_max_latency_us)
        state->timing_max_latency_us = (uint16_t)us;
    registers_set_u16(registers, REG_ACTIVE_PROFILE_VELOCITY, state->timing_max_latency_us);
    registers_set_u16(registers, REG_UNDOCUMENTED_STATUS73, state->timing_max_tick_late_us);
    registers_set_u16(registers, REG_UNDOCUMENTED_STATUS75,
                      (uint16_t)state->sensor_service.completed_pairs);
    if (registers->byte[REG_UNDOCUMENTED_RUNTIME50] == 201u) {
        registers_set_u16(registers, REG_ACTIVE_PROFILE_GOAL_POSITION, state->bus.uart.max_rx_occupancy);
        registers_set_u16(registers, REG_PRESENT_CURRENT, state->bus.response_timeouts);
    } else {
        registers_set_u16(registers, REG_ACTIVE_PROFILE_GOAL_POSITION, state->timing_rejected_pairs);
    }
#endif
    if (registers->byte[REG_UNDOCUMENTED_RUNTIME50] == 200u) {
        registers_set_u16(registers, REG_PRESENT_PWM,
            diagnostics_probe_stack_used(state->timing_stack_mark_end));
#ifndef FW_ARM_TIMING_PROBE
    } else if (registers->byte[REG_UNDOCUMENTED_RUNTIME50] == 204u) {
        registers_set_u16(registers, REG_PRESENT_PWM, state->goal_replaced_count);
#endif
    }
    registers->byte[REG_UNDOCUMENTED_STATUS77] = state->bus.timing_overflows;
    uint32_t values[4];
    unsigned cycle_mask = 0;
    unsigned mode = registers->byte[REG_UNDOCUMENTED_RUNTIME50];
    switch (mode) {
#ifdef FW_ARM_TIMING_PROBE
    case 201:
        values[0] = state->bus.uart.max_rx_occupancy;
        values[1] = state->bus.response_timeouts;
        values[2] = state->timing_rejected_pairs;
        values[3] = state->bus.timing_overflows;
        break;
#else
    case 202:
        values[0] = state->bus.uart.idle_to_tx_us;
        values[1] = state->bus.uart.max_idle_to_tx_us;
        values[2] = state->bus.uart.tx_duration_us;
        values[3] = state->bus.uart.max_tx_duration_us;
        break;
#endif
    case 203:
        cycle_mask = 0x0fu;
        values[0] = state->bus.command_wait_mean_cycles;
        values[1] = state->bus.command_wait_max_cycles;
        values[2] = state->bus.command_dispatch_mean_cycles;
        values[3] = state->bus.command_dispatch_max_cycles;
        break;
#ifndef FW_ARM_TIMING_PROBE
    case 204:
        cycle_mask = 0x0fu;
        values[0] = state->goal_control_mean_cycles;
        values[1] = state->goal_control_max_cycles;
        values[2] = state->goal_output_mean_cycles;
        values[3] = state->goal_output_max_cycles;
        registers_set_u16(registers, REG_UNDOCUMENTED_STATUS75, state->goal_timing_count);
        break;
#endif
#ifdef FW_ARM_TIMING_PROBE
    case 205:
        cycle_mask = 0x03u;
        values[0] = state->timing_control_last_cycles;
        values[1] = state->timing_control_max_cycles;
        values[2] = state->timing_control_samples;
        values[3] = state->timing_arm_revocation;
        break;
#endif
    default:
#ifdef FW_ARM_TIMING_PROBE
        if (mode < 206 || mode >= 206 + ARM_TIMING_COUNT) return;
        cycle_mask = 0x02u;
        values[0] = mode == 206 ? motion_timing[0].iterations : 0;
        values[1] = motion_timing[mode - 206].maximum;
        values[2] = motion_timing[mode - 206].samples;
        values[3] = state->timing_arm_revocation;
        break;
#else
        return;
#endif
    }
    /* Diagnostic words occupy consecutive u16 slots at registers 67–74. */
    for (unsigned i = 0; i < 4; ++i) {
        if (cycle_mask & (1u << i)) values[i] /= 48u;
        registers_set_u16(registers, REG_ACTIVE_PROFILE_GOAL_POSITION + 2u * i, values[i] > UINT16_MAX ? UINT16_MAX : (uint16_t)values[i]);
    }

#else
    (void)state;
#endif
}
