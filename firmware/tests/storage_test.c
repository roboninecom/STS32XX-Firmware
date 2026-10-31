#include "storage_adapter.h"
#include "storage.h"
#include "storage_journal.h"
#include "support/storage_legacy_fixture.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static void execute(storage_legacy_action_t action, uint8_t backup[1024],
                    uint8_t primary[1024])
{
    uint8_t *page = action.page == STORAGE_PAGE_BACKUP ? backup : primary;
    if (action.kind == STORAGE_LEGACY_ERASE) {
        memset(page, 0xff, 1024);
        return;
    }
    assert(action.byte_offset < 1024 && (action.byte_offset & 1u) == 0u);
    uint16_t before = (uint16_t)page[action.byte_offset] |
                      ((uint16_t)page[action.byte_offset + 1u] << 8);
    assert((before & action.value) == action.value); /* No zero-to-one write. */
    page[action.byte_offset] = (uint8_t)action.value;
    page[action.byte_offset + 1u] = (uint8_t)(action.value >> 8);
}

int main(void)
{
    uint8_t captured[2048];
    FILE *fixture = fopen("tests/fixtures/2026-09-25-target-storage-readback.bin", "rb");
    assert(fixture != NULL);
    assert(fread(captured, 1, sizeof(captured), fixture) == sizeof(captured));
    assert(fgetc(fixture) == EOF);
    fclose(fixture);

    storage_mirror_t old;
    assert(storage_fixture_select(captured, captured + 1024, &old) == STORAGE_SOURCE_PRIMARY);
    storage_selection_t initial_selection = storage_inspect(captured, captured + 1024);
    assert(initial_selection.source == STORAGE_SOURCE_PRIMARY &&
           initial_selection.page == STORAGE_PAGE_PRIMARY && initial_selection.slot == 0u);
    assert(memcmp(storage_selection_payload(initial_selection, captured,
                  captured + 1024), old.byte, STORAGE_MIRROR_BYTES) == 0);
    assert(storage_slot_matches(captured + 1024, 0u, &old));
    assert(old.byte[5] == 2 && old.byte[18] == 0x5c);
    register_table_t registers = {0};
    registers.byte[5] = 7;
    assert(storage_copy_mirror_to_registers(&old, &registers, true));
    assert(registers.byte[5] == 7 && registers.byte[18] == 0x5c);
    assert(registers.byte[0] == 3 && registers.byte[1] == 10);

    storage_mirror_t desired = old;
    registers.byte[18] = 0x5du;
    storage_copy_registers_to_mirror(&desired, &registers, false);
    assert(desired.byte[18] == 0x5d && desired.byte[5] == 7);
    assert(memcmp(desired.byte + 49, old.byte + 49, 510 - 49) == 0);
    storage_mirror_t ranged = old;
    registers.byte[18] = 0x5eu;
    registers.byte[50] = 0x44u;
    assert(storage_update_mirror_range(&ranged, &registers, 18, 33));
    assert(!storage_update_mirror_range(&ranged, &registers, 18, 33));
    assert(ranged.byte[18] == 0x5e);
    assert(ranged.byte[5] == old.byte[5]);
    assert(ranged.byte[49] == old.byte[49]);
    assert(!storage_update_mirror_range(&ranged, &registers, 50, 6));
    uint8_t encoded_backup[1024];
    storage_legacy_fixture_encode(&desired, encoded_backup);
    storage_mirror_t decoded;
    assert(storage_legacy_fixture_decode(encoded_backup, &decoded));
    assert(storage_legacy_fixture_matches(encoded_backup, &desired));
    assert(memcmp(&decoded, &desired, sizeof(decoded)) == 0);
    encoded_backup[100] ^= 1;
    assert(!storage_legacy_fixture_decode(encoded_backup, &decoded));
    assert(!storage_legacy_fixture_matches(encoded_backup, &desired));
    assert(!storage_slot_matches(captured + 1024, 0u, &desired));

    storage_legacy_fixture_plan_t plan;
    storage_legacy_action_t actions[STORAGE_LEGACY_PLAN_STEPS];
    storage_legacy_fixture_plan_init(&plan, &desired);
    for (unsigned i = 0; i < STORAGE_LEGACY_PLAN_STEPS; ++i) {
        assert(storage_legacy_fixture_plan_next(&plan, &actions[i]));
    }
    assert(!storage_legacy_fixture_plan_next(&plan, &actions[0]));
    assert(actions[0].kind == STORAGE_LEGACY_ERASE);
    assert(actions[260].page == STORAGE_PAGE_BACKUP &&
           actions[260].byte_offset == 518);
    assert(actions[261].page == STORAGE_PAGE_PRIMARY &&
           actions[261].kind == STORAGE_LEGACY_ERASE);
    assert(actions[518].page == STORAGE_PAGE_BACKUP &&
           actions[518].kind == STORAGE_LEGACY_ERASE);

    for (unsigned cut = 0; cut <= STORAGE_LEGACY_PLAN_STEPS; ++cut) {
        uint8_t backup[1024], primary[1024];
        memcpy(backup, captured, 1024);
        memcpy(primary, captured + 1024, 1024);
        for (unsigned i = 0; i < cut; ++i) execute(actions[i], backup, primary);
        storage_mirror_t recovered;
        storage_source_t source = storage_fixture_select(backup, primary, &recovered);
        storage_selection_t selection = storage_inspect(backup, primary);
        assert(selection.source == source);
        assert(memcmp(storage_selection_payload(selection, backup, primary),
                      recovered.byte, STORAGE_MIRROR_BYTES) == 0);
        if (cut <= 260u) {
            assert(source == STORAGE_SOURCE_PRIMARY);
            assert(memcmp(&recovered, &old, sizeof(old)) == 0);
        } else {
            assert(source != STORAGE_SOURCE_NONE);
            assert(memcmp(&recovered, &desired, sizeof(desired)) == 0);
        }
    }

    uint8_t erased[1024];
    memset(erased, 0xff, sizeof(erased));
    assert(storage_fixture_select(erased, erased, &decoded) == STORAGE_SOURCE_NONE);
    assert(storage_selection_payload(storage_inspect(erased, erased),
                                     erased, erased) == 0);
    assert(storage_selection_payload((storage_selection_t){
        STORAGE_SOURCE_PRIMARY, STORAGE_PAGE_PRIMARY, 2u},
        erased, erased) == 0);
    puts("Legacy storage codec and 520 power-cut positions: OK");
}
