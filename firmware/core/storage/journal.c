#include "storage_journal.h"

enum { SLOT_BYTES = STORAGE_PAGE_BYTES / 2u,
       SLOT_MARKER_BYTES = 2u,
       PAYLOAD_HALFWORDS = STORAGE_MIRROR_BYTES / 2u };

static bool erased(const uint8_t *bytes, unsigned count)
{
    for (unsigned i = 0; i < count; ++i) {
        if (bytes[i] != 0xffu) return false;
    }
    return true;
}

bool storage_journal_payload_matches(const uint8_t page[STORAGE_PAGE_BYTES],
                                      unsigned slot, const storage_mirror_t *mirror)
{
    if (page == 0 || mirror == 0 || slot > 1u) return false;
    unsigned offset = slot * SLOT_BYTES + SLOT_MARKER_BYTES;
    for (unsigned i = 0; i < STORAGE_MIRROR_BYTES; ++i) {
        if (page[offset + i] != mirror->byte[i]) return false;
    }
    return true;
}

bool storage_journal_plan_init(storage_journal_plan_t *plan,
    const uint8_t backup_page[STORAGE_PAGE_BYTES],
    const uint8_t primary_page[STORAGE_PAGE_BYTES],
    const storage_mirror_t *mirror)
{
    if (plan == 0 || backup_page == 0 || primary_page == 0 || mirror == 0)
        return false;
    storage_selection_t selected = storage_inspect(backup_page, primary_page);
    if (selected.source != STORAGE_SOURCE_PRIMARY &&
        selected.source != STORAGE_SOURCE_JOURNAL) return false;
    storage_page_t active = selected.page;
    storage_page_t inactive = active == STORAGE_PAGE_PRIMARY ?
        STORAGE_PAGE_BACKUP : STORAGE_PAGE_PRIMARY;
    const uint8_t *active_bytes = active == STORAGE_PAGE_PRIMARY ?
        primary_page : backup_page;
    const uint8_t *inactive_bytes = inactive == STORAGE_PAGE_PRIMARY ?
        primary_page : backup_page;
    bool append = selected.slot == 0u &&
                  erased(active_bytes + SLOT_BYTES, SLOT_BYTES);
    *plan = (storage_journal_plan_t){
        .mirror = mirror,
        .active_page = active,
        .target_page = append ? active : inactive,
        .target_slot = append ? 1u : 0u,
        .erase_inactive = !erased(inactive_bytes, STORAGE_PAGE_BYTES),
        .rotate = !append,
    };
    return true;
}

bool storage_journal_plan_next(storage_journal_plan_t *plan,
                               storage_journal_action_t *action)
{
    if (plan == 0 || action == 0 || plan->mirror == 0) return false;
    unsigned total = PAYLOAD_HALFWORDS + 3u +
        (unsigned)plan->erase_inactive + (unsigned)plan->rotate;
    if (plan->next_step >= total) return false;
    unsigned step = plan->next_step++;
    if (plan->erase_inactive) {
        if (step == 0u) {
            *action = (storage_journal_action_t){
                .kind = STORAGE_JOURNAL_ERASE,
                .page = plan->rotate ? plan->target_page :
                    (plan->active_page == STORAGE_PAGE_PRIMARY ?
                     STORAGE_PAGE_BACKUP : STORAGE_PAGE_PRIMARY),
            };
            return true;
        }
        --step;
    }
    uint16_t slot_offset = (uint16_t)(plan->target_slot * SLOT_BYTES);
    if (step < PAYLOAD_HALFWORDS) {
        unsigned index = step * 2u;
        *action = (storage_journal_action_t){
            .kind = STORAGE_JOURNAL_PROGRAM,
            .page = plan->target_page,
            .byte_offset = (uint16_t)(slot_offset + SLOT_MARKER_BYTES + index),
            .value = (uint16_t)plan->mirror->byte[index] |
                ((uint16_t)plan->mirror->byte[index + 1u] << 8),
        };
        return true;
    }
    if (step == PAYLOAD_HALFWORDS) {
        *action = (storage_journal_action_t){
            .kind = STORAGE_JOURNAL_VERIFY_PAYLOAD,
            .page = plan->target_page,
            .byte_offset = slot_offset,
        };
        return true;
    }
    if (step == PAYLOAD_HALFWORDS + 1u) {
        *action = (storage_journal_action_t){
            .kind = STORAGE_JOURNAL_PROGRAM,
            .page = plan->target_page,
            .byte_offset = slot_offset,
            .value = 0u,
        };
        return true;
    }
    if (step == PAYLOAD_HALFWORDS + 2u) {
        *action = (storage_journal_action_t){
            .kind = STORAGE_JOURNAL_VERIFY_SLOT,
            .page = plan->target_page,
            .byte_offset = slot_offset,
        };
        return true;
    }
    if (step == PAYLOAD_HALFWORDS + 3u && plan->rotate) {
        *action = (storage_journal_action_t){
            .kind = STORAGE_JOURNAL_ERASE,
            .page = plan->active_page,
        };
        return true;
    }
    return false;
}
