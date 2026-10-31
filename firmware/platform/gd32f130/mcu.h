#ifndef GD32F130_MCU_H
#define GD32F130_MCU_H

/* Target-private vendor declarations. Portable application and core code must
 * not include this header. The local device header includes the SPL headers. */
#ifndef GD32F130_150
#define GD32F130_150
#endif
/* This vintage device header typedefs `bool`; freestanding C11 uses _Bool.
 * Rename only that vendor typedef while parsing, then restore C11 bool. */
#undef bool
#define bool gd32_vendor_bool
#include "gd32f1x0.h"
#undef bool
#define bool _Bool

#endif
