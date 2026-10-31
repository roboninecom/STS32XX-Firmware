#include "storage_service.h"
#include "storage_journal.h"

#include "board.h"
#include "flash_driver.h"

#include <stdint.h>

bool storage_service_commit(const storage_mirror_t *mirror)
{
    const uint8_t *backup = flash_driver_page_view(STORAGE_PAGE_BACKUP);
    const uint8_t *primary = flash_driver_page_view(STORAGE_PAGE_PRIMARY);
    if (backup == 0 || primary == 0) return false;
    storage_journal_plan_t plan;
    if (!storage_journal_plan_init(&plan, backup, primary, mirror)) return false;
    bool success = flash_driver_begin();
    if (!success) return false;
    storage_journal_action_t action;
    while (success && storage_journal_plan_next(&plan, &action)) {
        switch (action.kind) {
        case STORAGE_JOURNAL_ERASE:
            success = flash_driver_erase_page(action.page);
            break;
        case STORAGE_JOURNAL_PROGRAM:
            success = flash_driver_program_halfword(action.page,
                                                    action.byte_offset, action.value);
            if (success &&
                action.byte_offset % (STORAGE_PAGE_BYTES / 2u) != 0u)
                board_watchdog_feed();
            break;
        case STORAGE_JOURNAL_VERIFY_PAYLOAD:
            success = storage_journal_payload_matches(
                flash_driver_page_view(action.page),
                action.byte_offset / (STORAGE_PAGE_BYTES / 2u), mirror);
            break;
        case STORAGE_JOURNAL_VERIFY_SLOT:
            success = storage_slot_matches(flash_driver_page_view(action.page),
                                           action.byte_offset / (STORAGE_PAGE_BYTES / 2u),
                                           mirror);
            break;
        default:
            success = false;
            break;
        }
    }
    if (success) {
        storage_selection_t selected = storage_inspect(backup, primary);
        const uint8_t *payload = storage_selection_payload(selected, backup, primary);
        success = payload != 0;
        for (unsigned i = 0; success && i < STORAGE_MIRROR_BYTES; ++i)
            success = payload[i] == mirror->byte[i];
    }
    bool locked = flash_driver_end();
    return success && locked;
}

bool storage_service_recover(const storage_mirror_t *mirror)
{
    const uint8_t *backup = flash_driver_page_view(STORAGE_PAGE_BACKUP);
    const uint8_t *primary = flash_driver_page_view(STORAGE_PAGE_PRIMARY);
    if (backup == 0 || primary == 0) return false;
    storage_selection_t selected = storage_inspect(backup, primary);
    const uint8_t *payload = storage_selection_payload(selected, backup, primary);
    bool matches = selected.source == STORAGE_SOURCE_BACKUP && payload != 0;
    for (unsigned i = 0; matches && i < STORAGE_MIRROR_BYTES; ++i)
        matches = payload[i] == mirror->byte[i];
    if (!matches || !flash_driver_begin()) return false;
    bool success = flash_driver_erase_page(STORAGE_PAGE_PRIMARY);
    board_watchdog_feed();
    if (success) success = flash_driver_program_halfword(STORAGE_PAGE_PRIMARY, 0u, 0u);
    for (unsigned i = 0; success && i < STORAGE_MIRROR_BYTES; i += 2u) {
        uint16_t value = (uint16_t)mirror->byte[i] |
            ((uint16_t)mirror->byte[i + 1u] << 8);
        success = flash_driver_program_halfword(STORAGE_PAGE_PRIMARY,
                                                (uint16_t)(2u + i), value);
        board_watchdog_feed();
    }
    if (success) success = storage_slot_matches(primary, 0u, mirror);
    if (success) success = flash_driver_erase_page(STORAGE_PAGE_BACKUP);
    bool locked = flash_driver_end();
    return success && locked;
}
