#include "diagnostic_service.h"

#include "app_runtime.h"
#ifdef FW_FLASH_DUMP
#include "flash_dump_target.h"
#endif
#ifdef FW_TIMING_PROBE
#include "diagnostics.h"
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
#ifdef FW_FLASH_DUMP
    flash_dump_window(state->device.registers.byte[REG_UNDOCUMENTED_RUNTIME50],
                      state->device.registers.byte + 73);
#else
    (void)state;
#endif
}

void diagnostic_service_period_started(struct app_state *state)
{
#ifdef FW_TIMING_PROBE
    uint32_t late = diagnostics_probe_tick_late_us();
    if (late > state->timing_max_tick_late_us)
        state->timing_max_tick_late_us = (uint16_t)late;
    state->timing_started_cycles = diagnostics_probe_cycles();
#else
    (void)state;
#endif
}

#ifdef FW_TIMING_PROBE
static void timing_average(uint32_t *mean, uint32_t *maximum,
                           uint32_t sample, uint16_t count)
{
    if (sample > *maximum) *maximum = sample;
    if (count == 1u) *mean = sample;
    else if (sample > *mean) *mean += (sample - *mean) / count;
    else *mean -= (*mean - sample) / count;
}
#endif

void diagnostic_service_goal_queued(struct app_state *state)
{
#ifdef FW_TIMING_PROBE
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
#ifdef FW_TIMING_PROBE
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
#ifdef FW_TIMING_PROBE
    uint32_t output_cycles = diagnostics_probe_cycles();
    if (!state->goal_timing_pending) return;
    state->goal_timing_pending = false;
    if (state->goal_timing_count < 1024u) ++state->goal_timing_count;
    timing_average(&state->goal_control_mean_cycles,
                   &state->goal_control_max_cycles,
                   control_started_cycles - state->goal_packet_cycles,
                   state->goal_timing_count);
    timing_average(&state->goal_output_mean_cycles,
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
    registers_set_u16(&state->device.registers, REG_ACTIVE_PROFILE_GOAL_POSITION, state->timing_rejected_pairs);
    registers_set_u16(&state->device.registers, REG_PRESENT_CURRENT,
                      state->sensor_service.acquisition.encoder_raw);
#else
    (void)state;
#endif
}

void diagnostic_service_pair_complete(struct app_state *state)
{
#ifdef FW_TIMING_PROBE
    register_table_t *registers = &state->device.registers;
    uint32_t cycles = diagnostics_probe_cycles() - state->timing_started_cycles;
    uint32_t us = cycles / 48u;
    if (us > 65535u) us = 65535u;
    if (us > state->timing_max_latency_us)
        state->timing_max_latency_us = (uint16_t)us;
    registers_set_u16(registers, REG_ACTIVE_PROFILE_VELOCITY, state->timing_max_latency_us);
    registers_set_u16(registers, REG_UNDOCUMENTED_STATUS73, state->timing_max_tick_late_us);
    registers_set_u16(registers, REG_UNDOCUMENTED_STATUS75,
                      (uint16_t)state->sensor_service.acquisition.completed_pairs);
    if (registers->byte[REG_UNDOCUMENTED_RUNTIME50] == 201u) {
        registers_set_u16(registers, REG_ACTIVE_PROFILE_GOAL_POSITION, state->bus.uart.max_rx_occupancy);
        registers_set_u16(registers, REG_PRESENT_CURRENT, state->bus.response_timeouts);
    } else {
        registers_set_u16(registers, REG_ACTIVE_PROFILE_GOAL_POSITION, state->timing_rejected_pairs);
    }
    if (registers->byte[REG_UNDOCUMENTED_RUNTIME50] == 200u) {
        registers_set_u16(registers, REG_PRESENT_PWM,
            diagnostics_probe_stack_used(state->timing_stack_mark_end));
    } else if (registers->byte[REG_UNDOCUMENTED_RUNTIME50] == 204u) {
        registers_set_u16(registers, REG_PRESENT_PWM, state->goal_replaced_count);
    }
    registers->byte[REG_UNDOCUMENTED_STATUS77] = state->bus.timing_overflows;
    if (registers->byte[REG_UNDOCUMENTED_RUNTIME50] == 202u) {
        registers_set_u16(registers, REG_ACTIVE_PROFILE_GOAL_POSITION, state->bus.uart.idle_to_tx_us);
        registers_set_u16(registers, REG_PRESENT_CURRENT, state->bus.uart.max_idle_to_tx_us);
        registers_set_u16(registers, REG_ACTIVE_PROFILE_VELOCITY, state->bus.uart.tx_duration_us);
        registers_set_u16(registers, REG_UNDOCUMENTED_STATUS73, state->bus.uart.max_tx_duration_us);
    } else if (registers->byte[REG_UNDOCUMENTED_RUNTIME50] == 203u) {
        uint32_t wait_mean = state->bus.command_wait_mean_cycles / 48u;
        uint32_t wait_max = state->bus.command_wait_max_cycles / 48u;
        uint32_t dispatch_mean = state->bus.command_dispatch_mean_cycles / 48u;
        uint32_t dispatch_max = state->bus.command_dispatch_max_cycles / 48u;
        registers_set_u16(registers, REG_ACTIVE_PROFILE_GOAL_POSITION, wait_mean > UINT16_MAX ? UINT16_MAX : (uint16_t)wait_mean);
        registers_set_u16(registers, REG_PRESENT_CURRENT, wait_max > UINT16_MAX ? UINT16_MAX : (uint16_t)wait_max);
        registers_set_u16(registers, REG_ACTIVE_PROFILE_VELOCITY, dispatch_mean > UINT16_MAX ? UINT16_MAX : (uint16_t)dispatch_mean);
        registers_set_u16(registers, REG_UNDOCUMENTED_STATUS73, dispatch_max > UINT16_MAX ? UINT16_MAX : (uint16_t)dispatch_max);
    } else if (registers->byte[REG_UNDOCUMENTED_RUNTIME50] == 204u) {
        uint32_t control_mean = state->goal_control_mean_cycles / 48u;
        uint32_t control_max = state->goal_control_max_cycles / 48u;
        uint32_t output_mean = state->goal_output_mean_cycles / 48u;
        uint32_t output_max = state->goal_output_max_cycles / 48u;
        registers_set_u16(registers, REG_ACTIVE_PROFILE_GOAL_POSITION, control_mean > UINT16_MAX ? UINT16_MAX : (uint16_t)control_mean);
        registers_set_u16(registers, REG_PRESENT_CURRENT, control_max > UINT16_MAX ? UINT16_MAX : (uint16_t)control_max);
        registers_set_u16(registers, REG_ACTIVE_PROFILE_VELOCITY, output_mean > UINT16_MAX ? UINT16_MAX : (uint16_t)output_mean);
        registers_set_u16(registers, REG_UNDOCUMENTED_STATUS73, output_max > UINT16_MAX ? UINT16_MAX : (uint16_t)output_max);
        registers_set_u16(registers, REG_UNDOCUMENTED_STATUS75, state->goal_timing_count);
    }
#else
    (void)state;
#endif
}
