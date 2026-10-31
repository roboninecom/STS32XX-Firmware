#include "storage_adapter.h"

enum { MIRROR_HEAD_BYTES = 40, MIRROR_TAIL_BYTES = 9,
       MIRROR_TEMPLATE_OFFSET = MIRROR_HEAD_BYTES + MIRROR_TAIL_BYTES,
       REGISTER_TAIL_START = 78 };

void storage_copy_registers_to_mirror(storage_mirror_t *mirror,
                                      const register_table_t *registers,
                                      bool template_slot)
{
    unsigned offset = template_slot ? MIRROR_TEMPLATE_OFFSET : 0u;
    for (unsigned i = 0; i < MIRROR_HEAD_BYTES; ++i)
        mirror->byte[offset + i] = registers->byte[i];
    for (unsigned i = 0; i < MIRROR_TAIL_BYTES; ++i)
        mirror->byte[offset + MIRROR_HEAD_BYTES + i] =
            registers->byte[REGISTER_TAIL_START + i];
}

static bool mirror_offset_for_register(uint8_t address, unsigned *offset)
{
    if (!registers_persistent_writable(address)) return false;
    if (address < MIRROR_HEAD_BYTES) {
        *offset = address;
        return true;
    }
    if (address >= REGISTER_TAIL_START &&
        address < REGISTER_TAIL_START + MIRROR_TAIL_BYTES) {
        *offset = MIRROR_HEAD_BYTES + address - REGISTER_TAIL_START;
        return true;
    }
    return false;
}

bool storage_update_mirror_range(storage_mirror_t *mirror,
                                 const register_table_t *registers,
                                 uint8_t start, uint8_t accepted_count)
{
    bool changed = false;
    for (unsigned i = 0; i < accepted_count; ++i) {
        unsigned address = (unsigned)start + i;
        if (address >= REGISTER_COUNT) continue;
        unsigned offset;
        if (!mirror_offset_for_register((uint8_t)address, &offset)) continue;
        if (mirror->byte[offset] != registers->byte[address]) {
            mirror->byte[offset] = registers->byte[address];
            changed = true;
        }
    }
    return changed;
}

bool storage_copy_mirror_to_registers(const storage_mirror_t *mirror,
                                      register_table_t *registers,
                                      bool template_slot)
{
    unsigned offset = template_slot ? MIRROR_TEMPLATE_OFFSET : 0u;
    if (mirror->byte[offset] != 3u || mirror->byte[offset + 3u] != 9u) return false;
    uint8_t id = registers->byte[REG_ID];
    for (unsigned i = 0; i < MIRROR_HEAD_BYTES; ++i)
        registers->byte[i] = mirror->byte[offset + i];
    for (unsigned i = 0; i < MIRROR_TAIL_BYTES; ++i)
        registers->byte[REGISTER_TAIL_START + i] =
            mirror->byte[offset + MIRROR_HEAD_BYTES + i];
    registers->byte[REG_FIRMWARE_MAJOR] = 3;
    registers->byte[REG_FIRMWARE_MINOR] = 10;
    registers->byte[REG_IDENTITY_BYTE2] = 0;
    registers->byte[REG_MODEL_MAJOR] = 9;
    if (template_slot) registers->byte[REG_ID] = id;
    return true;
}
