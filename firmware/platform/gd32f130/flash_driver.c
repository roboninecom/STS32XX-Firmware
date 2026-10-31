#include "flash_driver.h"

#include <stdint.h>
#include "mcu.h"

/* Project-owned page layout and bounded wait; peripheral fields come from GD32. */
enum {
    MAX_BUSY_POLLS = 20000000u,
    FLASH_BACKUP_ADDRESS = 0x08007000u,
    FLASH_PRIMARY_ADDRESS = 0x08007400u
};

static bool page_address(storage_page_t page, uint32_t *address)
{
    if (page == STORAGE_PAGE_BACKUP) *address = FLASH_BACKUP_ADDRESS;
    else if (page == STORAGE_PAGE_PRIMARY) *address = FLASH_PRIMARY_ADDRESS;
    else return false;
    return true;
}

const uint8_t *flash_driver_page_view(storage_page_t page)
{
    uint32_t address;
    return page_address(page, &address) ? (const uint8_t *)(uintptr_t)address : 0;
}

static bool wait_ready(void)
{
    for (uint32_t remaining = MAX_BUSY_POLLS; remaining != 0u; --remaining) {
        uint32_t status = FMC_STAT;
        if ((status & FMC_STAT_BUSY) == 0u) {
            return (status & (FMC_STAT_PGERR | FMC_STAT_WPERR)) == 0u;
        }
    }
    return false; /* Watchdog is the additional fail-safe if flash stalls. */
}

static void clear_flags(void)
{
    FMC_STAT = FMC_STAT_ENDF | FMC_STAT_WPERR | FMC_STAT_PGERR;
}

/* BUSY need not be visible on the very first peripheral read after START or
 * the programming store. The factory routine also leaves a short gap. */
static void allow_busy_to_assert(void)
{
    __asm volatile("nop\n nop\n nop\n nop\n nop\n nop\n" ::: "memory");
}

bool flash_driver_begin(void)
{
    if (!wait_ready()) return false;
    if ((FMC_CTL & FMC_CTL_LK) != 0u) {
        FMC_KEY = 0x45670123u;
        FMC_KEY = 0xcdef89abu;
    }
    return (FMC_CTL & FMC_CTL_LK) == 0u;
}

bool flash_driver_erase_page(storage_page_t page)
{
    uint32_t address;
    if (!page_address(page, &address) ||
        (FMC_CTL & FMC_CTL_LK) != 0u || !wait_ready()) return false;
    clear_flags();
    FMC_CTL |= FMC_CTL_PER;
    FMC_ADDR = address;
    FMC_CTL |= FMC_CTL_START;
    allow_busy_to_assert();
    bool success = wait_ready();
    FMC_CTL &= ~FMC_CTL_PER;
    if (!success) return false;
    for (unsigned offset = 0; offset < FLASH_PHYSICAL_PAGE_BYTES; offset += 2u) {
        if (REG16(address + offset) != 0xffffu) return false;
    }
    return true;
}

bool flash_driver_program_halfword(storage_page_t page, uint16_t offset,
                                    uint16_t value)
{
    uint32_t base;
    if (!page_address(page, &base) || (offset & 1u) != 0u ||
        offset > FLASH_PHYSICAL_PAGE_BYTES - 2u ||
        (FMC_CTL & FMC_CTL_LK) != 0u || !wait_ready()) return false;
    uint32_t address = base + offset;
    if (value == 0xffffu) return REG16(address) == 0xffffu;
    if (REG16(address) != 0xffffu) return false;
    clear_flags();
    FMC_CTL |= FMC_CTL_PG;
    REG16(address) = value;
    __asm volatile("dsb" ::: "memory");
    allow_busy_to_assert();
    bool success = wait_ready();
    FMC_CTL &= ~FMC_CTL_PG;
    return success && REG16(address) == value;
}

bool flash_driver_end(void)
{
    FMC_CTL &= ~(FMC_CTL_PG | FMC_CTL_PER);
    FMC_CTL |= FMC_CTL_LK;
    return (FMC_CTL & FMC_CTL_LK) != 0u;
}
