#ifndef STORAGE_SERVICE_H
#define STORAGE_SERVICE_H

#include "storage.h"

/* Target maintenance operations. Caller keeps bridge disabled and prevents
 * concurrent protocol transactions for the duration of either call. */
bool storage_service_commit(const storage_mirror_t *mirror);
bool storage_service_recover(const storage_mirror_t *mirror);

#endif
