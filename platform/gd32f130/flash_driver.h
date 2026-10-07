#ifndef FLASH_DRIVER_H
#define FLASH_DRIVER_H

#include "storage.h"

#include <stdbool.h>
#include <stdint.h>

/* Only these two complete physical pages are exposed. The target driver owns
 * address translation and refuses all offsets outside the selected page. */
enum { FLASH_PHYSICAL_PAGE_BYTES = STORAGE_PAGE_BYTES };

const uint8_t *flash_driver_page_view(storage_page_t page);
bool flash_driver_begin(void);
bool flash_driver_erase_page(storage_page_t page);
bool flash_driver_program_halfword(storage_page_t page, uint16_t offset,
                                    uint16_t value);
bool flash_driver_end(void);

#endif
