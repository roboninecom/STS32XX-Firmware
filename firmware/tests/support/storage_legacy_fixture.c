#include "storage_legacy_fixture.h"

enum {
    PRIMARY_MARKER_BYTES = 2,
    BACKUP_HEADER_BYTES = 8,
    BACKUP_COMMIT_OFFSET = BACKUP_HEADER_BYTES + STORAGE_MIRROR_BYTES,
    BACKUP_HEADER_LAST_STEP = 4,
    BACKUP_PAYLOAD_FIRST_STEP = BACKUP_HEADER_LAST_STEP + 1,
    PRIMARY_ERASE_STEP = STORAGE_LEGACY_BACKUP_COMMIT_STEP + 1,
    PRIMARY_MARKER_STEP = PRIMARY_ERASE_STEP + 1,
    PRIMARY_PAYLOAD_FIRST_STEP = PRIMARY_MARKER_STEP + 1,
    BACKUP_FINAL_ERASE_STEP = STORAGE_LEGACY_PLAN_STEPS - 1,
};

static uint16_t read_u16(const uint8_t *bytes)
{
    return (uint16_t)bytes[0] | ((uint16_t)bytes[1] << 8);
}

static void write_u32(uint8_t *bytes, uint32_t value)
{
    for (unsigned i = 0; i < 4; ++i)
        bytes[i] = (uint8_t)(value >> (i * 8u));
}

static uint32_t mirror_crc(const storage_mirror_t *mirror)
{
    uint32_t crc = 0xffffffffu;
    for (unsigned i = 0; i < STORAGE_MIRROR_BYTES; ++i) {
        crc ^= mirror->byte[i];
        for (unsigned bit = 0; bit < 8; ++bit)
            crc = (crc >> 1) ^ (0xedb88320u & (0u - (crc & 1u)));
    }
    return ~crc;
}

void storage_legacy_fixture_encode(const storage_mirror_t *mirror,
                                   uint8_t page[STORAGE_PAGE_BYTES])
{
    for (unsigned i = 0; i < STORAGE_PAGE_BYTES; ++i) page[i] = 0xffu;
    page[0] = 'R';
    page[1] = 'W';
    page[2] = '0';
    page[3] = '1';
    write_u32(page + 4, mirror_crc(mirror));
    for (unsigned i = 0; i < STORAGE_MIRROR_BYTES; ++i)
        page[BACKUP_HEADER_BYTES + i] = mirror->byte[i];
    page[BACKUP_COMMIT_OFFSET] = 0;
    page[BACKUP_COMMIT_OFFSET + 1u] = 0;
}

bool storage_legacy_fixture_decode(
    const uint8_t backup_page[STORAGE_PAGE_BYTES],
    storage_mirror_t *mirror)
{
    uint8_t erased[STORAGE_PAGE_BYTES];
    for (unsigned i = 0; i < STORAGE_PAGE_BYTES; ++i) erased[i] = 0xffu;
    storage_selection_t selected = storage_inspect(backup_page, erased);
    const uint8_t *payload = storage_selection_payload(
        selected, backup_page, erased);
    if (selected.source != STORAGE_SOURCE_BACKUP || payload == 0) return false;
    for (unsigned i = 0; i < STORAGE_MIRROR_BYTES; ++i)
        mirror->byte[i] = payload[i];
    return true;
}

bool storage_legacy_fixture_matches(
    const uint8_t backup_page[STORAGE_PAGE_BYTES],
    const storage_mirror_t *mirror)
{
    storage_mirror_t decoded;
    if (!storage_legacy_fixture_decode(backup_page, &decoded)) return false;
    for (unsigned i = 0; i < STORAGE_MIRROR_BYTES; ++i) {
        if (decoded.byte[i] != mirror->byte[i]) return false;
    }
    return true;
}

storage_source_t storage_fixture_select(
    const uint8_t backup_page[STORAGE_PAGE_BYTES],
    const uint8_t primary_page[STORAGE_PAGE_BYTES],
    storage_mirror_t *mirror)
{
    storage_selection_t selected = storage_inspect(backup_page, primary_page);
    const uint8_t *payload = storage_selection_payload(
        selected, backup_page, primary_page);
    if (payload != 0) {
        for (unsigned i = 0; i < STORAGE_MIRROR_BYTES; ++i)
            mirror->byte[i] = payload[i];
    }
    return selected.source;
}

void storage_legacy_fixture_plan_init(storage_legacy_fixture_plan_t *plan,
                                      const storage_mirror_t *mirror)
{
    plan->mirror = mirror;
    plan->crc = mirror_crc(mirror);
    plan->next_step = 0;
}

bool storage_legacy_fixture_plan_next(storage_legacy_fixture_plan_t *plan,
                                      storage_legacy_action_t *action)
{
    if (plan->next_step >= STORAGE_LEGACY_PLAN_STEPS || action == 0) return false;
    unsigned step = plan->next_step++;
    action->kind = STORAGE_LEGACY_PROGRAM;
    action->page = STORAGE_PAGE_BACKUP;
    action->byte_offset = 0;
    action->value = 0;
    if (step == 0u || step == PRIMARY_ERASE_STEP ||
        step == BACKUP_FINAL_ERASE_STEP) {
        action->kind = STORAGE_LEGACY_ERASE;
        action->page = step == PRIMARY_ERASE_STEP ?
            STORAGE_PAGE_PRIMARY : STORAGE_PAGE_BACKUP;
    } else if (step <= BACKUP_HEADER_LAST_STEP) {
        static const uint8_t magic[4] = {'R', 'W', '0', '1'};
        uint8_t header[8];
        for (unsigned i = 0; i < 4; ++i) header[i] = magic[i];
        write_u32(header + 4, plan->crc);
        action->byte_offset = (uint16_t)((step - 1u) * 2u);
        action->value = read_u16(header + action->byte_offset);
    } else if (step < STORAGE_LEGACY_BACKUP_COMMIT_STEP) {
        unsigned index = step - BACKUP_PAYLOAD_FIRST_STEP;
        action->byte_offset = (uint16_t)(BACKUP_HEADER_BYTES + index * 2u);
        action->value = read_u16(plan->mirror->byte + index * 2u);
    } else if (step == STORAGE_LEGACY_BACKUP_COMMIT_STEP) {
        action->byte_offset = BACKUP_COMMIT_OFFSET;
    } else if (step == PRIMARY_MARKER_STEP) {
        action->page = STORAGE_PAGE_PRIMARY;
    } else {
        unsigned index = step - PRIMARY_PAYLOAD_FIRST_STEP;
        action->page = STORAGE_PAGE_PRIMARY;
        action->byte_offset = (uint16_t)(PRIMARY_MARKER_BYTES + index * 2u);
        action->value = read_u16(plan->mirror->byte + index * 2u);
    }
    return true;
}
