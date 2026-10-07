#include "flash_driver.h"
#include "storage_service.h"
#include "support/storage_legacy_fixture.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static uint8_t pages[2048];
static unsigned erases;
static unsigned watchdog_feeds;
static unsigned operations;
static int fail_at = -1;
static bool unlocked;
static bool fail_begin;
static bool fail_lock;
static bool silent_program_loss;
static bool fail_page_view;

void board_watchdog_feed(void) { ++watchdog_feeds; }

bool flash_driver_begin(void)
{ assert(!unlocked); if (fail_begin) return false; unlocked = true; return true; }
bool flash_driver_end(void)
{ assert(unlocked); unlocked = false; return !fail_lock; }

static bool permitted(void)
{
    if (fail_at >= 0 && operations == (unsigned)fail_at) return false;
    ++operations;
    return true;
}

const uint8_t *flash_driver_page_view(storage_page_t page)
{
    assert(page == STORAGE_PAGE_BACKUP || page == STORAGE_PAGE_PRIMARY);
    if (fail_page_view) return NULL;
    return pages + (page == STORAGE_PAGE_BACKUP ? 0u : 1024u);
}

bool flash_driver_erase_page(storage_page_t page)
{
    assert(unlocked);
    assert(page == STORAGE_PAGE_BACKUP || page == STORAGE_PAGE_PRIMARY);
    if (!permitted()) return false;
    unsigned offset = page == STORAGE_PAGE_BACKUP ? 0u : 1024u;
    ++erases;
    memset(pages + offset, 0xff, 1024);
    return true;
}

bool flash_driver_program_halfword(storage_page_t page, uint16_t byte_offset,
                                    uint16_t value)
{
    assert(unlocked && (byte_offset & 1u) == 0u && byte_offset + 1u < 1024u);
    unsigned offset = (page == STORAGE_PAGE_BACKUP ? 0u : 1024u) + byte_offset;
    assert(pages[offset] == 0xff && pages[offset + 1u] == 0xff);
    if (!permitted()) return false;
    if (silent_program_loss) return true;
    pages[offset] = (uint8_t)value;
    pages[offset + 1u] = (uint8_t)(value >> 8);
    return true;
}

static bool commit(const storage_mirror_t *mirror)
{
    return storage_service_commit(mirror);
}

static bool same(const storage_mirror_t *left, const storage_mirror_t *right)
{
    return memcmp(left, right, sizeof(*left)) == 0;
}

int main(void)
{
    FILE *fixture = fopen("tests/fixtures/2026-09-25-target-storage-readback.bin", "rb");
    assert(fixture != NULL);
    assert(fread(pages, 1, sizeof(pages), fixture) == sizeof(pages));
    fclose(fixture);

    storage_mirror_t old;
    assert(storage_fixture_select(pages, pages + 1024, &old) == STORAGE_SOURCE_PRIMARY);
    storage_mirror_t initial_mirror = old;
    uint8_t initial_pages[sizeof(pages)];
    memcpy(initial_pages, pages, sizeof(pages));
    storage_mirror_t changed = old;
    ++changed.byte[21];
    fail_begin = true;
    assert(!commit(&changed) && !unlocked);
    assert(memcmp(pages, initial_pages, sizeof(pages)) == 0);
    fail_begin = false;
    fail_page_view = true;
    assert(!commit(&changed) && !unlocked);
    fail_page_view = false;
    silent_program_loss = true;
    assert(!commit(&changed) && !unlocked);
    assert(storage_fixture_select(pages, pages + 1024, &old) == STORAGE_SOURCE_PRIMARY);
    assert(same(&old, &initial_mirror));
    memcpy(pages, initial_pages, sizeof(pages));
    silent_program_loss = false;
    fail_lock = true;
    assert(!commit(&changed) && !unlocked);
    storage_mirror_t after_lock_failure;
    assert(storage_fixture_select(pages, pages + 1024, &after_lock_failure) !=
           STORAGE_SOURCE_NONE);
    assert(same(&after_lock_failure, &changed));
    memcpy(pages, initial_pages, sizeof(pages));
    fail_lock = false;
    unsigned cuts_checked = 0;
    for (unsigned phase = 0; phase < 4; ++phase) {
        uint8_t starting[sizeof(pages)];
        memcpy(starting, pages, sizeof(pages));
        storage_mirror_t desired = old;
        desired.byte[21] = (uint8_t)(old.byte[21] + 1u);
        operations = erases = 0;
        fail_at = -1;
        assert(commit(&desired));
        assert(erases == (phase & 1u));
        unsigned action_count = operations;
        uint8_t completed[sizeof(pages)];
        memcpy(completed, pages, sizeof(pages));
        storage_mirror_t selected;
        assert(storage_fixture_select(pages, pages + 1024, &selected) != STORAGE_SOURCE_NONE);
        assert(same(&selected, &desired));

        for (unsigned cut = 0; cut < action_count; ++cut) {
            memcpy(pages, starting, sizeof(pages));
            operations = erases = 0;
            fail_at = (int)cut;
            assert(!commit(&desired));
            assert(!unlocked);
            assert(storage_fixture_select(pages, pages + 1024, &selected) != STORAGE_SOURCE_NONE);
            assert(same(&selected, &old) || same(&selected, &desired));
            fail_at = -1;
            assert(commit(&desired));
            assert(storage_fixture_select(pages, pages + 1024, &selected) != STORAGE_SOURCE_NONE);
            assert(same(&selected, &desired));
            ++cuts_checked;
        }
        memcpy(pages, completed, sizeof(pages));
        old = desired;
    }

    /* A backup left by the previous transactional format still wins at boot
     * and is migrated by the existing recovery path. */
    storage_legacy_fixture_encode(&old, pages);
    memset(pages + 1024, 0xff, 1024);
    assert(storage_fixture_select(pages, pages + 1024, &old) == STORAGE_SOURCE_BACKUP);
    fail_at = -1;
    assert(storage_service_recover(&old));
    assert(storage_fixture_select(pages, pages + 1024, &old) == STORAGE_SOURCE_PRIMARY);
    assert(!unlocked && watchdog_feeds > 500u);
    printf("Storage journal, %u interrupted operations and legacy recovery: OK\n",
           cuts_checked);
}
