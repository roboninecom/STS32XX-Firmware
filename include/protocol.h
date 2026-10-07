#ifndef PROTOCOL_H
#define PROTOCOL_H

#include "registers.h"

#include <stdbool.h>
#include <stdint.h>

enum {
    PROTOCOL_MAX_PARAMS = 128,
    PROTOCOL_MAX_RESPONSE = 93,
    PROTOCOL_BROADCAST = 0xfe,
};

typedef struct {
    uint8_t id, instruction, param_count;
    uint8_t params[PROTOCOL_MAX_PARAMS];
    uint8_t selected_count;
} protocol_packet_t;

typedef struct {
    protocol_packet_t packet;
    uint8_t state, history_a, history_b, checksum_sum;
    uint8_t parameter_index, selected_id, group_index;
    uint8_t own_id;
} protocol_parser_t;

typedef enum {
    PROTOCOL_EFFECT_NONE,
    PROTOCOL_EFFECT_WRITE,
    PROTOCOL_EFFECT_FACTORY_RESET,
    PROTOCOL_EFFECT_SYSTEM_RESET,
    PROTOCOL_EFFECT_SAVE_TEMPLATE,
    PROTOCOL_EFFECT_ENCODER_HOME,
    PROTOCOL_EFFECT_CALIBRATE,
} protocol_effect_t;

typedef struct {
    protocol_effect_t effect;
    register_write_result_t write;
    int16_t calibration_target;
    uint8_t response[PROTOCOL_MAX_RESPONSE];
    uint8_t response_size;
    uint8_t delay_slot;
} protocol_result_t;

typedef struct {
    bool pending;
    uint8_t count;
    uint8_t staged[PROTOCOL_MAX_PARAMS];
} protocol_command_state_t;

void protocol_parser_init(protocol_parser_t *parser);
bool protocol_feed(protocol_parser_t *parser, uint8_t own_id, uint8_t byte);
void protocol_execute(const protocol_packet_t *packet,
                      protocol_command_state_t *command,
                      register_table_t *registers,
                      protocol_result_t *result);
/* Call after the application applies the returned effect to the live state. */
void protocol_build_response(const protocol_packet_t *packet,
                             const register_table_t *registers,
                             protocol_result_t *result);
/* Versioned arm extension replies use the ordinary framed status packet and
 * place an extension status byte before their data. */
void protocol_extension_response(const protocol_packet_t *packet,
                                 const register_table_t *registers,
                                 protocol_result_t *result,
                                 uint8_t payload_count);

#endif
