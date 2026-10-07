#ifndef DIAGNOSTICS_H
#define DIAGNOSTICS_H

#include <stdint.h>

/* Test-profile mechanisms. Only the target implementation touches Cortex
 * debug registers or reserved stack memory. */
void diagnostics_probe_init(uint32_t *stack_mark_end);
uint32_t diagnostics_probe_cycles(void);
uint16_t diagnostics_probe_stack_used(uint32_t stack_mark_end);

/* Shared bounded running mean/maximum, count starts at one. */
void diagnostics_record(uint32_t *mean, uint32_t *maximum,
                        uint32_t sample, uint16_t count);
#endif
