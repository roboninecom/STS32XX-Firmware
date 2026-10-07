#ifndef ARM_EXTENSION_H
#define ARM_EXTENSION_H

#include "protocol.h"

/* Foreground-only extension handler. Legacy protocol instructions never enter. */
void arm_extension_process(const protocol_packet_t *packet,
                           register_table_t *registers,
                           protocol_result_t *result,
                           void *context);

#endif
