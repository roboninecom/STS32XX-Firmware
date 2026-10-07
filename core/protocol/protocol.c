#include "protocol.h"

#include <stddef.h>

enum { WAIT, ID, LENGTH, INSTRUCTION, PARAMETER, CHECKSUM };

enum {
    INST_PING = 1, INST_READ = 2, INST_WRITE = 3, INST_REG_WRITE = 4,
    INST_ACTION = 5, INST_FACTORY_RESET = 6, INST_SYSTEM_RESET = 8,
    INST_SAVE_TEMPLATE = 9, INST_ENCODER_HOME = 10, INST_CALIBRATE = 11,
    INST_SYNC_READ = 0x82, INST_SYNC_WRITE = 0x83,
};

void protocol_parser_init(protocol_parser_t *parser)
{
    parser->packet.id = 0;
    parser->packet.instruction = 0;
    parser->packet.param_count = 0;
    parser->packet.selected_count = 0;
    parser->state = WAIT;
    parser->history_a = parser->history_b = 0;
    parser->checksum_sum = 0;
    parser->parameter_index = parser->selected_id = parser->group_index = 0;
    parser->own_id = 0;
}

static bool collect_sync(protocol_parser_t *parser, uint8_t byte)
{
    protocol_packet_t *p = &parser->packet;
    uint8_t index = parser->parameter_index;
    if (index == 0u) {
        p->params[0] = byte;
        return true;
    }
    if (index == 1u) {
        if (byte > PROTOCOL_MAX_PARAMS - 3u) return false;
        p->params[1] = byte;
        parser->group_index = 0;
        return true;
    }
    if (parser->group_index == 0u) {
        parser->selected_id = byte;
        if (byte == parser->own_id) {
            p->params[2] = byte;
            p->selected_count = 0;
        }
    } else if (parser->selected_id == parser->own_id) {
        p->params[2u + parser->group_index] = byte;
        ++p->selected_count;
    }
    ++parser->group_index;
    if (parser->group_index == (uint8_t)(p->params[1] + 1u)) parser->group_index = 0;
    return true;
}

bool protocol_feed(protocol_parser_t *parser, uint8_t own_id, uint8_t byte)
{
    uint8_t older = parser->history_a;
    parser->history_a = parser->history_b;
    parser->history_b = byte;
    /* Factory parsing resynchronizes on embedded headers. Preserve that for
     * legacy packets, but extension payloads contain signed/fixed-point values
     * (e.g. -1 == FFFF) and use their validated, bounded packet length. */
    bool extension_payload =
        (parser->state == PARAMETER || parser->state == CHECKSUM) &&
        parser->packet.instruction >= 0x90u &&
        parser->packet.instruction <= 0x9Au;
    if (!extension_payload && older == 0xffu && parser->history_a == 0xffu)
        parser->state = ID;

    protocol_packet_t *p = &parser->packet;
    switch (parser->state) {
    case ID:
        parser->own_id = own_id;
        if (byte == own_id || byte == PROTOCOL_BROADCAST) {
            p->id = byte;
            parser->state = LENGTH;
        } else parser->state = WAIT;
        break;
    case LENGTH:
        if (byte < 2u) parser->state = WAIT;
        else {
            p->param_count = (uint8_t)(byte - 2u);
            parser->state = INSTRUCTION;
        }
        break;
    case INSTRUCTION:
        p->instruction = byte;
        if (byte != INST_SYNC_WRITE && p->param_count > PROTOCOL_MAX_PARAMS) {
            parser->state = WAIT;
            break;
        }
        parser->parameter_index = 0;
        parser->checksum_sum = 0;
        p->selected_count = 0;
        parser->state = p->param_count == 0u ? CHECKSUM : PARAMETER;
        break;
    case PARAMETER:
        if (p->instruction == INST_SYNC_WRITE) {
            if (!collect_sync(parser, byte)) {
                parser->state = WAIT;
                break;
            }
        } else p->params[parser->parameter_index] = byte;
        parser->checksum_sum = (uint8_t)(parser->checksum_sum + byte);
        ++parser->parameter_index;
        if (parser->parameter_index == p->param_count) parser->state = CHECKSUM;
        break;
    case CHECKSUM: {
        uint8_t expected = (uint8_t)~(unsigned)(p->id + 2u + p->param_count +
                                                p->instruction + parser->checksum_sum);
        parser->state = WAIT;
        if (expected == byte) return true;
        p->selected_count = 0;
        break;
    }
    default: break;
    }
    return false;
}

static void status_response(const protocol_packet_t *p, const register_table_t *regs,
                            protocol_result_t *out, uint8_t count)
{
    uint8_t *tx = out->response;
    tx[0] = tx[1] = 0xffu;
    tx[2] = p->id == PROTOCOL_BROADCAST ? regs->byte[5] : p->id;
    tx[3] = (uint8_t)(count + 2u);
    tx[4] = regs->byte[65];
    uint8_t sum = (uint8_t)(tx[2] + tx[3] + tx[4]);
    for (unsigned i = 0; i < count; ++i) {
        sum = (uint8_t)(sum + tx[5u + i]);
    }
    tx[5u + count] = (uint8_t)~sum;
    out->response_size = (uint8_t)(6u + count);
}

void protocol_extension_response(const protocol_packet_t *p,
                                 const register_table_t *regs,
                                 protocol_result_t *out, uint8_t payload_count)
{
    if (p->id == PROTOCOL_BROADCAST || payload_count > 87u) {
        out->response_size = 0;
        return;
    }
    status_response(p, regs, out, payload_count);
}

static void apply_write(const uint8_t *params, uint8_t count,
                        register_table_t *regs, protocol_result_t *out)
{
    if (count < 2u) return;
    if (registers_write(regs, params[0], (uint8_t)(count - 1u),
                        params + 1, &out->write) >= 0) out->effect = PROTOCOL_EFFECT_WRITE;
}

void protocol_execute(const protocol_packet_t *p,
                      protocol_command_state_t *command,
                      register_table_t *regs, protocol_result_t *out)
{
    out->effect = PROTOCOL_EFFECT_NONE;
    out->write.start = 0;
    out->write.accepted_count = 0;
    out->write.any_changed = false;
    out->calibration_target = 0;
    out->response_size = 0;
    out->delay_slot = 0;
    switch (p->instruction) {
    case INST_WRITE:
        apply_write(p->params, p->param_count, regs, out);
        break;
    case INST_SYNC_WRITE:
        if (p->selected_count != 0u) {
            uint8_t params[PROTOCOL_MAX_PARAMS];
            params[0] = p->params[0];
            for (unsigned i = 0; i < p->selected_count; ++i) params[1u + i] = p->params[3u + i];
            apply_write(params, (uint8_t)(p->selected_count + 1u), regs, out);
        }
        break;
    case INST_REG_WRITE:
        command->count = p->param_count;
        for (unsigned i = 0; i < p->param_count; ++i) command->staged[i] = p->params[i];
        command->pending = true;
        regs->byte[64] = 1;
        break;
    case INST_ACTION:
        if (command->pending) {
            command->pending = false;
            regs->byte[64] = 0;
            apply_write(command->staged, command->count, regs, out);
        }
        break;
    case INST_FACTORY_RESET: out->effect = PROTOCOL_EFFECT_FACTORY_RESET; break;
    case INST_SYSTEM_RESET: out->effect = PROTOCOL_EFFECT_SYSTEM_RESET; return;
    case INST_SAVE_TEMPLATE: out->effect = PROTOCOL_EFFECT_SAVE_TEMPLATE; break;
    case INST_ENCODER_HOME: out->effect = PROTOCOL_EFFECT_ENCODER_HOME; break;
    case INST_CALIBRATE:
        if (p->param_count == 0u || p->param_count == 2u) {
            out->effect = PROTOCOL_EFFECT_CALIBRATE;
            out->calibration_target = p->param_count == 0u ? 2048 :
                (int16_t)((uint16_t)p->params[0] | ((uint16_t)p->params[1] << 8));
        }
        break;
    default: break;
    }

}

void protocol_build_response(const protocol_packet_t *p,
                             const register_table_t *regs,
                             protocol_result_t *out)
{
    out->response_size = 0;
    out->delay_slot = 0;
    if (p->instruction == INST_SYSTEM_RESET) return;
    if (p->instruction == INST_PING) {
        status_response(p, regs, out, 0);
        if (p->id == PROTOCOL_BROADCAST) out->delay_slot = regs->byte[5];
        return;
    }
    if (p->instruction == INST_READ || p->instruction == INST_SYNC_READ) {
        bool sync = p->instruction == INST_SYNC_READ;
        if (p->param_count < (sync ? 3u : 2u) || (!sync && p->param_count != 2u)) return;
        if (sync) {
            unsigned slot = 2;
            while (slot < p->param_count && p->params[slot] != regs->byte[5]) ++slot;
            if (slot == p->param_count) return;
            out->delay_slot = (uint8_t)(slot - 2u);
        }
        int count = registers_read(regs, p->params[0], p->params[1],
                                   out->response + 5u);
        if (count < 0) return;
        status_response(p, regs, out, (uint8_t)count);
        return;
    }
    if (p->id != PROTOCOL_BROADCAST && regs->byte[8] != 0u) {
        status_response(p, regs, out, 0);
    }
}
