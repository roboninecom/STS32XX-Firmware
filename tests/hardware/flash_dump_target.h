#ifndef FLASH_DUMP_TARGET_H
#define FLASH_DUMP_TARGET_H

#include <stdint.h>
/* Diagnostic-only read of application-adjacent flash. No FMC commands. */
void flash_dump_window(uint8_t window, uint8_t out[14]);

#endif
