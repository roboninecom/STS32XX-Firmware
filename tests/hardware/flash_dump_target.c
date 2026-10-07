#include "flash_dump_target.h"
#include "flash_driver.h"

#include <stdint.h>

void flash_dump_window(uint8_t window, uint8_t out[14])
{
    uint32_t offset = (uint32_t)window * 14u;
    for (unsigned i = 0; i < 14u; ++i) {
        if (offset + i < 0x800u) {
            storage_page_t page = offset + i < STORAGE_PAGE_BYTES ?
                STORAGE_PAGE_BACKUP : STORAGE_PAGE_PRIMARY;
            out[i] = flash_driver_page_view(page)[(offset + i) % STORAGE_PAGE_BYTES];
        } else {
            out[i] = 0xffu;
        }
    }
}
