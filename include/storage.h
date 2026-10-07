#ifndef STORAGE_H
#define STORAGE_H

#include <stdbool.h>
#include <stdint.h>

enum { STORAGE_PAGE_BYTES = 1024, STORAGE_MIRROR_BYTES = 510 };

typedef struct { uint8_t byte[STORAGE_MIRROR_BYTES]; } storage_mirror_t;

typedef enum { STORAGE_PAGE_BACKUP, STORAGE_PAGE_PRIMARY } storage_page_t;
typedef enum { STORAGE_SOURCE_NONE, STORAGE_SOURCE_PRIMARY,
               STORAGE_SOURCE_BACKUP, STORAGE_SOURCE_JOURNAL } storage_source_t;

/* A selection borrows the supplied flash pages; it does not copy 510 bytes. */
typedef struct {
    storage_source_t source;
    storage_page_t page;
    uint8_t slot;
} storage_selection_t;

storage_selection_t storage_inspect(const uint8_t backup_page[STORAGE_PAGE_BYTES],
                                    const uint8_t primary_page[STORAGE_PAGE_BYTES]);
const uint8_t *storage_selection_payload(storage_selection_t selection,
    const uint8_t backup_page[STORAGE_PAGE_BYTES],
    const uint8_t primary_page[STORAGE_PAGE_BYTES]);

#endif
