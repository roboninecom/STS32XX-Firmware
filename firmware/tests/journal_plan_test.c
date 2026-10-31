#include "storage.h"
#include "storage_journal.h"
#include "support/storage_legacy_fixture.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static uint8_t pages[2 * STORAGE_PAGE_BYTES];

static void apply(storage_journal_action_t action, const storage_mirror_t *desired)
{
    uint8_t *page = pages + (action.page == STORAGE_PAGE_PRIMARY ?
                             STORAGE_PAGE_BYTES : 0u);
    if (action.kind == STORAGE_JOURNAL_ERASE) {
        memset(page, 0xff, STORAGE_PAGE_BYTES);
    } else if (action.kind == STORAGE_JOURNAL_PROGRAM) {
        assert((action.byte_offset & 1u) == 0u &&
               action.byte_offset + 1u < STORAGE_PAGE_BYTES);
        uint16_t before = (uint16_t)page[action.byte_offset] |
            ((uint16_t)page[action.byte_offset + 1u] << 8);
        assert((before & action.value) == action.value);
        page[action.byte_offset] = (uint8_t)action.value;
        page[action.byte_offset + 1u] = (uint8_t)(action.value >> 8);
    } else if (action.kind == STORAGE_JOURNAL_VERIFY_PAYLOAD) {
        assert(storage_journal_payload_matches(page,
               action.byte_offset / 512u, desired));
    } else {
        assert(action.kind == STORAGE_JOURNAL_VERIFY_SLOT);
        assert(storage_slot_matches(page, action.byte_offset / 512u, desired));
    }
}

int main(void)
{
    FILE *fixture = fopen("tests/fixtures/2026-09-25-target-storage-readback.bin", "rb");
    assert(fixture != NULL);
    assert(fread(pages, 1, sizeof(pages), fixture) == sizeof(pages));
    fclose(fixture);

    storage_mirror_t previous;
    assert(storage_fixture_select(pages, pages + STORAGE_PAGE_BYTES, &previous) ==
           STORAGE_SOURCE_PRIMARY);
    unsigned modeled_actions = 0;
    for (unsigned generation = 0; generation < 4u; ++generation) {
        storage_mirror_t desired = previous;
        ++desired.byte[21];
        storage_journal_plan_t plan;
        assert(storage_journal_plan_init(&plan, pages,
                                         pages + STORAGE_PAGE_BYTES, &desired));
        assert(plan.rotate == ((generation & 1u) != 0u));
        assert(plan.target_slot == ((generation & 1u) == 0u ? 1u : 0u));
        bool marker_seen = false;
        bool payload_verified = false;
        bool verify_seen = false;
        storage_journal_action_t action;
        while (storage_journal_plan_next(&plan, &action)) {
            if (action.kind == STORAGE_JOURNAL_VERIFY_PAYLOAD) {
                assert(!payload_verified && !marker_seen);
                payload_verified = true;
            }
            if (action.kind == STORAGE_JOURNAL_PROGRAM &&
                action.byte_offset == plan.target_slot * 512u) {
                assert(payload_verified && !marker_seen && !verify_seen &&
                       action.value == 0u);
                marker_seen = true;
            }
            if (action.kind == STORAGE_JOURNAL_VERIFY_SLOT) {
                assert(marker_seen && !verify_seen);
                verify_seen = true;
            }
            if (action.kind == STORAGE_JOURNAL_ERASE &&
                action.page == plan.active_page)
                assert(marker_seen && verify_seen && plan.rotate);
            apply(action, &desired);
            storage_mirror_t selected;
            assert(storage_fixture_select(pages, pages + STORAGE_PAGE_BYTES, &selected) !=
                   STORAGE_SOURCE_NONE);
            assert(memcmp(&selected, marker_seen ? &desired : &previous,
                          sizeof(selected)) == 0);
            ++modeled_actions;
        }
        assert(payload_verified && marker_seen && verify_seen);
        assert(!storage_journal_plan_next(&plan, &action));
        previous = desired;
    }
    printf("Portable journal plan, %u actions and marker cuts: OK\n", modeled_actions);
}
