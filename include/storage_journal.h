#ifndef STORAGE_JOURNAL_H
#define STORAGE_JOURNAL_H

#include "storage.h"

typedef enum {
    STORAGE_JOURNAL_ERASE,
    STORAGE_JOURNAL_PROGRAM,
    STORAGE_JOURNAL_VERIFY_PAYLOAD,
    STORAGE_JOURNAL_VERIFY_SLOT,
} storage_journal_action_kind_t;

typedef struct {
    storage_journal_action_kind_t kind;
    storage_page_t page;
    uint16_t byte_offset;
    uint16_t value;
} storage_journal_action_t;

typedef struct {
    const storage_mirror_t *mirror;
    storage_page_t active_page;
    storage_page_t target_page;
    uint8_t target_slot;
    bool erase_inactive;
    bool rotate;
    uint16_t next_step;
} storage_journal_plan_t;

bool storage_slot_matches(const uint8_t page[STORAGE_PAGE_BYTES],
                          unsigned slot, const storage_mirror_t *mirror);
bool storage_journal_plan_init(storage_journal_plan_t *plan,
    const uint8_t backup_page[STORAGE_PAGE_BYTES],
    const uint8_t primary_page[STORAGE_PAGE_BYTES],
    const storage_mirror_t *mirror);
bool storage_journal_plan_next(storage_journal_plan_t *plan,
                               storage_journal_action_t *action);
bool storage_journal_payload_matches(const uint8_t page[STORAGE_PAGE_BYTES],
                                      unsigned slot,
                                      const storage_mirror_t *mirror);

#endif
