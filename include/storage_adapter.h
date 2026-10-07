#ifndef STORAGE_ADAPTER_H
#define STORAGE_ADAPTER_H

#include "storage.h"
#include "registers.h"

/* Persisted register mapping; untouched mirror bytes remain opaque. */
void storage_copy_registers_to_mirror(storage_mirror_t *mirror,
                                      const register_table_t *registers,
                                      bool template_slot);
bool storage_update_mirror_range(storage_mirror_t *mirror,
                                 const register_table_t *registers,
                                 uint8_t start, uint8_t accepted_count);
bool storage_copy_mirror_to_registers(const storage_mirror_t *mirror,
                                      register_table_t *registers,
                                      bool template_slot);
#endif
