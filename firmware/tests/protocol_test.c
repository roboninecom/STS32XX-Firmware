#include "protocol.h"
#include "registers.h"
#include "fixtures/initial_wire.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static unsigned frame(uint8_t *out, uint8_t id, uint8_t inst,
                      const uint8_t *params, uint8_t count)
{
    out[0] = out[1] = 0xff;
    out[2] = id;
    out[3] = (uint8_t)(count + 2);
    out[4] = inst;
    unsigned sum = id + out[3] + inst;
    for (unsigned i = 0; i < count; ++i) {
        out[5 + i] = params[i];
        sum += params[i];
    }
    out[5 + count] = (uint8_t)~sum;
    return 6u + count;
}

static bool feed(protocol_parser_t *parser, const uint8_t *frame_data, unsigned size)
{
    bool done = false;
    for (unsigned i = 0; i < size; ++i) done |= protocol_feed(parser, 2, frame_data[i]);
    return done;
}

int main(void)
{
    register_table_t regs = {0};
    protocol_parser_t parser;
    protocol_command_state_t command = {0};
    protocol_result_t result;
    uint8_t bytes[260];
    uint8_t params[] = {50, 0x5a};
    regs.byte[5] = 2;
    regs.byte[8] = 1;
    protocol_parser_init(&parser);

    /* Signed extension values may contain the header byte pair: -1 is FFFF.
     * Length-delimited extension payloads must not restart framing there. */
    uint8_t ff[] = {2,0,1,0,0xff,0xff,0,0,0x20,3,250,0};
    unsigned ff_count = frame(bytes, 2, 0x99, ff, sizeof(ff));
    assert(feed(&parser, bytes, ff_count));
    assert(parser.packet.instruction == 0x99);
    assert(memcmp(parser.packet.params, ff, sizeof(ff)) == 0);
    /* Exercise every pair position, including the payload/checksum boundary,
     * and ensure a subsequent ordinary packet is still parsed. */
    for (unsigned inst = 0x90; inst <= 0x9A; ++inst) {
        for (unsigned offset = 0; offset + 1 < sizeof(ff); ++offset) {
            uint8_t payload[sizeof(ff)] = {0};
            payload[offset] = payload[offset + 1] = 0xff;
            protocol_parser_init(&parser);
            ff_count = frame(bytes, 2, (uint8_t)inst, payload, sizeof(payload));
            assert(feed(&parser, bytes, ff_count));
            assert(memcmp(parser.packet.params, payload, sizeof(payload)) == 0);
            ff_count = frame(bytes, 2, 1, NULL, 0);
            assert(feed(&parser, bytes, ff_count));
        }
    }
    uint8_t checksum_pair[] = {0x62, 0xff};
    ff_count = frame(bytes, 2, 0x99, checksum_pair, sizeof(checksum_pair));
    assert(bytes[ff_count - 1] == 0xff);
    assert(feed(&parser, bytes, ff_count));
    ff_count = frame(bytes, 2, 1, NULL, 0);
    assert(feed(&parser, bytes, ff_count));
    /* Bad checksum cannot activate a command; framing recovers afterward. */
    ff_count = frame(bytes, 2, 0x99, ff, sizeof(ff));
    bytes[ff_count - 1] ^= 1;
    assert(!feed(&parser, bytes, ff_count));
    ff_count = frame(bytes, 2, 1, NULL, 0);
    assert(feed(&parser, bytes, ff_count));
    /* Maximum group packet: not complete until checksum, no reply needed.
     * A corrupt broadcast must not reach foreground dispatch. */
    uint8_t group[68] = {9, 0};
    for (unsigned i = 0; i < 6; ++i) {
        unsigned offset = 2 + i * 11;
        group[offset] = (uint8_t)(i + 1);
        group[offset + 1] = 1;
        group[offset + 3] = group[offset + 4] = group[offset + 5] = group[offset + 6] = 0xff;
        group[offset + 7] = group[offset + 9] = 100;
    }
    protocol_parser_init(&parser);
    ff_count = frame(bytes, PROTOCOL_BROADCAST, 0x9A, group, sizeof group);
    assert(!feed(&parser, bytes, ff_count - 1));
    assert(protocol_feed(&parser, 2, bytes[ff_count - 1]));
    assert(parser.packet.param_count == 68 && parser.packet.instruction == 0x9A);
    assert(memcmp(parser.packet.params, group, sizeof group) == 0);
    bytes[ff_count - 1] ^= 1;
    assert(!feed(&parser, bytes, ff_count));
    protocol_parser_init(&parser);

    unsigned count = frame(bytes, 2, 1, NULL, 0);
    assert(feed(&parser, bytes, count));
    protocol_execute(&parser.packet, &command, &regs, &result);
    protocol_build_response(&parser.packet, &regs, &result);
    assert(result.response_size == 6 && result.response[2] == 2);
    assert(result.response[5] == (uint8_t)~(2u + 2u));

    count = frame(bytes, 2, 3, params, 2);
    bytes[count - 1] ^= 1;
    assert(!feed(&parser, bytes, count));
    assert(regs.byte[50] == 0);
    bytes[count - 1] ^= 1;
    assert(feed(&parser, bytes, count));
    protocol_execute(&parser.packet, &command, &regs, &result);
    protocol_build_response(&parser.packet, &regs, &result);
    assert(regs.byte[50] == 0x5a && result.effect == PROTOCOL_EFFECT_WRITE);

    /* Application effects run before the status is encoded. */
    regs.byte[65] = 4;
    protocol_build_response(&parser.packet, &regs, &result);
    assert(result.response[4] == 4);
    regs.byte[65] = 0;

    params[0] = 56;
    count = frame(bytes, 2, 3, params, 2);
    assert(feed(&parser, bytes, count));
    protocol_execute(&parser.packet, &command, &regs, &result);
    protocol_build_response(&parser.packet, &regs, &result);
    assert(regs.byte[56] == 0 && result.write.accepted_count == 1);

    register_table_t scratch = {0};
    for (unsigned start = 0; start < 256; ++start) {
        for (unsigned length = 0; length < 256; ++length) {
            uint8_t out[87] = {0};
            uint8_t input[255] = {0};
            register_write_result_t effect;
            int n = registers_read(&scratch, (uint8_t)start, (uint8_t)length, out);
            int written = registers_write(&scratch, (uint8_t)start,
                                          (uint8_t)length, input, &effect);
            assert(n >= -1 && n <= 87);
            assert(written == n);
            if (start >= 87) assert(n == -1);
            else assert(n <= (int)(87 - start));
        }
    }
    uint8_t out[87];
    assert(registers_read(&regs, 0, 0, out) == 87);
    assert(registers_read(&regs, 1, 0, out) == 0);
    assert(registers_persistent_writable(50) == false);
    assert(registers_persistent_writable(82) == true);

    uint8_t stage[] = {50, 0x44};
    count = frame(bytes, 2, 4, stage, 2);
    assert(feed(&parser, bytes, count));
    protocol_execute(&parser.packet, &command, &regs, &result);
    protocol_build_response(&parser.packet, &regs, &result);
    assert(regs.byte[64] == 1 && regs.byte[50] == 0x5a);
    count = frame(bytes, 2, 5, NULL, 0);
    assert(feed(&parser, bytes, count));
    protocol_execute(&parser.packet, &command, &regs, &result);
    protocol_build_response(&parser.packet, &regs, &result);
    assert(regs.byte[64] == 0 && regs.byte[50] == 0x44);

    /* A second staged write replaces the first one. */
    uint8_t replacement[] = {50, 0x75};
    count = frame(bytes, 2, 4, stage, 2);
    assert(feed(&parser, bytes, count));
    protocol_execute(&parser.packet, &command, &regs, &result);
    count = frame(bytes, 2, 4, replacement, 2);
    assert(feed(&parser, bytes, count));
    protocol_execute(&parser.packet, &command, &regs, &result);
    count = frame(bytes, 2, 5, NULL, 0);
    assert(feed(&parser, bytes, count));
    protocol_execute(&parser.packet, &command, &regs, &result);
    assert(regs.byte[50] == 0x75 && !command.pending);

    uint8_t sync[] = {50, 1, 2, 0x33, 3, 0x55, 2, 0x44};
    count = frame(bytes, 0xfe, 0x83, sync, sizeof(sync));
    assert(feed(&parser, bytes, count));
    protocol_execute(&parser.packet, &command, &regs, &result);
    protocol_build_response(&parser.packet, &regs, &result);
    assert(result.response_size == 0 && regs.byte[50] == 0x44);
    sync[7] = 0x66;
    count = frame(bytes, 0xfe, 0x83, sync, sizeof(sync));
    assert(feed(&parser, bytes, count));
    protocol_execute(&parser.packet, &command, &regs, &result);
    protocol_build_response(&parser.packet, &regs, &result);
    assert(regs.byte[50] == 0x66);

    uint8_t partial[] = {50, 2, 2, 0x88};
    count = frame(bytes, 0xfe, 0x83, partial, sizeof(partial));
    assert(feed(&parser, bytes, count));
    protocol_execute(&parser.packet, &command, &regs, &result);
    assert(regs.byte[50] == 0x88);

    uint8_t sync_read[] = {50, 1, 3, 2};
    count = frame(bytes, 0xfe, 0x82, sync_read, sizeof(sync_read));
    assert(feed(&parser, bytes, count));
    protocol_execute(&parser.packet, &command, &regs, &result);
    protocol_build_response(&parser.packet, &regs, &result);
    assert(result.response_size == 7 && result.delay_slot == 1);
    assert(result.response[2] == 2 && result.response[5] == 0x88);

    const uint8_t special[] = {6, 8, 9, 10, 11, 0x7f};
    const protocol_effect_t effects[] = {
        PROTOCOL_EFFECT_FACTORY_RESET, PROTOCOL_EFFECT_SYSTEM_RESET,
        PROTOCOL_EFFECT_SAVE_TEMPLATE, PROTOCOL_EFFECT_ENCODER_HOME,
        PROTOCOL_EFFECT_CALIBRATE, PROTOCOL_EFFECT_NONE
    };
    for (unsigned i = 0; i < sizeof(special); ++i) {
        count = frame(bytes, 2, special[i], NULL, 0);
        assert(feed(&parser, bytes, count));
        protocol_execute(&parser.packet, &command, &regs, &result);
        protocol_build_response(&parser.packet, &regs, &result);
        assert(result.effect == effects[i]);
        assert(result.response_size == (special[i] == 8 ? 0 : 6));
    }
    uint8_t calibrate[] = {0x34, 0x12};
    count = frame(bytes, 2, 11, calibrate, sizeof(calibrate));
    assert(feed(&parser, bytes, count));
    protocol_execute(&parser.packet, &command, &regs, &result);
    assert(result.calibration_target == 0x1234);
    regs.byte[8] = 0;
    count = frame(bytes, 2, 0x7f, NULL, 0);
    assert(feed(&parser, bytes, count));
    protocol_execute(&parser.packet, &command, &regs, &result);
    protocol_build_response(&parser.packet, &regs, &result);
    assert(result.response_size == 0);
    regs.byte[8] = 1;

    uint8_t read[] = {0, 0};
    count = frame(bytes, 2, 2, read, sizeof(read));
    assert(feed(&parser, bytes, count));
    protocol_execute(&parser.packet, &command, &regs, &result);
    protocol_build_response(&parser.packet, &regs, &result);
    assert(result.response_size == 93 && result.response[3] == 89);

    uint32_t random_state = 0x12345678u;
    for (unsigned i = 0; i < 100000; ++i) {
        random_state ^= random_state << 13;
        random_state ^= random_state >> 17;
        random_state ^= random_state << 5;
        if (protocol_feed(&parser, 2, (uint8_t)random_state)) {
            protocol_execute(&parser.packet, &command, &regs, &result);
    protocol_build_response(&parser.packet, &regs, &result);
            assert(result.response_size <= PROTOCOL_MAX_RESPONSE);
        }
    }

    protocol_parser_init(&parser);
    assert(feed(&parser, ping_request, sizeof(ping_request)));
    protocol_execute(&parser.packet, &command, &regs, &result);
    protocol_build_response(&parser.packet, &regs, &result);
    assert(result.response_size == sizeof(ping_response));
    assert(memcmp(result.response, ping_response, sizeof(ping_response)) == 0);

    register_table_t captured = {0};
    memcpy(captured.byte, read_0_86_response + 5, 87);
    protocol_parser_init(&parser);
    assert(feed(&parser, read_0_86_request, sizeof(read_0_86_request)));
    protocol_execute(&parser.packet, &command, &captured, &result);
    protocol_build_response(&parser.packet, &captured, &result);
    assert(result.response_size == sizeof(read_0_86_response));
    assert(memcmp(result.response, read_0_86_response, sizeof(read_0_86_response)) == 0);

    uint16_t encoded;
    for (int value = -4095; value <= 4095; ++value) {
        assert(register_encode_position_offset(value, &encoded));
        assert(register_decode_position_offset(encoded) == value);
    }
    for (int value = -1023; value <= 1023; ++value) {
        assert(register_encode_signed(value, 10, &encoded));
        assert(register_decode_signed(encoded, 10) == value);
    }
    assert(!register_encode_signed(1024, 10, &encoded));
    assert(!register_encode_position_offset(4096, &encoded));

    puts("Portable protocol/register tests: OK");
    return 0;
}
