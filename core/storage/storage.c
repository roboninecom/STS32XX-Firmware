#include "storage.h"
#include "storage_journal.h"

enum { PRIMARY_SLOT_BYTES = STORAGE_PAGE_BYTES / 2,
       PRIMARY_MARKER_BYTES = 2, BACKUP_HEADER_BYTES = 8 };

static uint16_t read_u16(const uint8_t *bytes)
{
    return (uint16_t)bytes[0] | ((uint16_t)bytes[1] << 8);
}

/* Read-only recovery for interrupted early rewrite RW01 commits. */
static uint32_t read_u32(const uint8_t *bytes)
{
    return (uint32_t)read_u16(bytes) | ((uint32_t)read_u16(bytes + 2) << 16);
}

static uint32_t crc_bytes(const uint8_t *bytes)
{
    uint32_t crc = 0xffffffffu;
    for (unsigned i = 0; i < STORAGE_MIRROR_BYTES; ++i) {
        crc ^= bytes[i];
        for (unsigned bit = 0; bit < 8; ++bit) {
            crc = (crc >> 1) ^ (0xedb88320u & (0u - (crc & 1u)));
        }
    }
    return ~crc;
}

static bool legacy_backup_valid(const uint8_t page[STORAGE_PAGE_BYTES])
{
    static const uint8_t magic[4] = {'R', 'W', '0', '1'};
    for (unsigned i = 0; i < 4; ++i) {
        if (page[i] != magic[i]) return false;
    }
    return read_u16(page + (BACKUP_HEADER_BYTES + STORAGE_MIRROR_BYTES)) == 0u &&
           page[BACKUP_HEADER_BYTES] == 3u &&
           page[BACKUP_HEADER_BYTES + 3u] == 9u &&
           read_u32(page + 4) == crc_bytes(page + BACKUP_HEADER_BYTES);
}

static bool storage_slot_valid(const uint8_t page[STORAGE_PAGE_BYTES],
                               unsigned slot)
{
    if (slot > 1u) return false;
    unsigned offset = slot * PRIMARY_SLOT_BYTES;
    return read_u16(page + offset) == 0u &&
           page[offset + PRIMARY_MARKER_BYTES] == 3u &&
           page[offset + PRIMARY_MARKER_BYTES + 3u] == 9u;
}

bool storage_slot_matches(const uint8_t page[STORAGE_PAGE_BYTES],
                          unsigned slot, const storage_mirror_t *mirror)
{
    if (!storage_slot_valid(page, slot)) return false;
    unsigned offset = slot * PRIMARY_SLOT_BYTES + PRIMARY_MARKER_BYTES;
    for (unsigned i = 0; i < STORAGE_MIRROR_BYTES; ++i) {
        if (page[offset + i] != mirror->byte[i]) return false;
    }
    return true;
}

storage_selection_t storage_inspect(const uint8_t backup_page[STORAGE_PAGE_BYTES],
                                    const uint8_t primary_page[STORAGE_PAGE_BYTES])
{
    if (legacy_backup_valid(backup_page))
        return (storage_selection_t){STORAGE_SOURCE_BACKUP, STORAGE_PAGE_BACKUP, 0u};
    bool p0 = storage_slot_valid(primary_page, 0u);
    bool p1 = storage_slot_valid(primary_page, 1u);
    bool b0 = storage_slot_valid(backup_page, 0u);
    bool b1 = storage_slot_valid(backup_page, 1u);
    /* The commit protocol alternates p0 -> p1 -> b0 -> b1 -> p0.
     * During a slow rotation the new slot commits before the old page is
     * erased. These cases distinguish both interrupted transitions. */
    if (p0 && b1) {
        return (storage_selection_t){STORAGE_SOURCE_PRIMARY, STORAGE_PAGE_PRIMARY, 0u};
    }
    if (b1) {
        return (storage_selection_t){STORAGE_SOURCE_JOURNAL, STORAGE_PAGE_BACKUP, 1u};
    }
    if (b0 && p1) {
        return (storage_selection_t){STORAGE_SOURCE_JOURNAL, STORAGE_PAGE_BACKUP, 0u};
    }
    if (p1) {
        return (storage_selection_t){STORAGE_SOURCE_PRIMARY, STORAGE_PAGE_PRIMARY, 1u};
    }
    if (p0) {
        return (storage_selection_t){STORAGE_SOURCE_PRIMARY, STORAGE_PAGE_PRIMARY, 0u};
    }
    if (b0) {
        return (storage_selection_t){STORAGE_SOURCE_JOURNAL, STORAGE_PAGE_BACKUP, 0u};
    }
    return (storage_selection_t){STORAGE_SOURCE_NONE, STORAGE_PAGE_BACKUP, 0u};
}

const uint8_t *storage_selection_payload(storage_selection_t selection,
    const uint8_t backup_page[STORAGE_PAGE_BYTES],
    const uint8_t primary_page[STORAGE_PAGE_BYTES])
{
    if (selection.source == STORAGE_SOURCE_BACKUP &&
        selection.page == STORAGE_PAGE_BACKUP && selection.slot == 0u)
        return backup_page + BACKUP_HEADER_BYTES;
    if (selection.slot > 1u ||
        (selection.source == STORAGE_SOURCE_PRIMARY &&
         selection.page != STORAGE_PAGE_PRIMARY) ||
        (selection.source == STORAGE_SOURCE_JOURNAL &&
         selection.page != STORAGE_PAGE_BACKUP) ||
        (selection.source != STORAGE_SOURCE_PRIMARY &&
         selection.source != STORAGE_SOURCE_JOURNAL)) return 0;
    const uint8_t *page = selection.page == STORAGE_PAGE_PRIMARY ?
        primary_page : backup_page;
    return page + selection.slot * PRIMARY_SLOT_BYTES + PRIMARY_MARKER_BYTES;
}
