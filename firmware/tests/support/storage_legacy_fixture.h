#ifndef STORAGE_LEGACY_FIXTURE_H
#define STORAGE_LEGACY_FIXTURE_H

#include "storage.h"

enum {
    STORAGE_LEGACY_PLAN_STEPS = 519,
    STORAGE_LEGACY_BACKUP_COMMIT_STEP = 1 + 4 + STORAGE_MIRROR_BYTES / 2,
};

typedef enum {
    STORAGE_LEGACY_ERASE,
    STORAGE_LEGACY_PROGRAM,
} storage_legacy_action_kind_t;

typedef struct {
    storage_legacy_action_kind_t kind;
    storage_page_t page;
    uint16_t byte_offset;
    uint16_t value;
} storage_legacy_action_t;

typedef struct {
    const storage_mirror_t *mirror;
    uint32_t crc;
    uint16_t next_step;
} storage_legacy_fixture_plan_t;

void storage_legacy_fixture_encode(const storage_mirror_t *mirror,
                                   uint8_t page[STORAGE_PAGE_BYTES]);
bool storage_legacy_fixture_decode(
    const uint8_t backup_page[STORAGE_PAGE_BYTES],
    storage_mirror_t *mirror);
bool storage_legacy_fixture_matches(
    const uint8_t backup_page[STORAGE_PAGE_BYTES],
    const storage_mirror_t *mirror);
storage_source_t storage_fixture_select(
    const uint8_t backup_page[STORAGE_PAGE_BYTES],
    const uint8_t primary_page[STORAGE_PAGE_BYTES],
    storage_mirror_t *mirror);
void storage_legacy_fixture_plan_init(storage_legacy_fixture_plan_t *plan,
                                      const storage_mirror_t *mirror);
bool storage_legacy_fixture_plan_next(storage_legacy_fixture_plan_t *plan,
                                      storage_legacy_action_t *action);

#endif
