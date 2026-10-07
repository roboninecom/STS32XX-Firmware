#ifndef BOARD_H
#define BOARD_H

#include <stdbool.h>

/* Bring-up mechanism only: no control or protocol policy in the board layer. */
bool board_init_safe(void);
void board_watchdog_feed(void);
void board_halt_safe(void) __attribute__((noreturn));
void board_system_reset(void) __attribute__((noreturn));

#endif
