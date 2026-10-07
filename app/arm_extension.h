#ifndef ARM_EXTENSION_H
#define ARM_EXTENSION_H

#include "protocol.h"

enum { ARM_FEEDBACK_BYTES = 32, ARM_TUNING_BYTES = 56 };
struct app_state;
/* Called once after a complete control/protection/bridge update. */
void arm_extension_publish_sample(struct app_state *state);

/* Foreground-only extension handler. Legacy protocol instructions never enter. */
void arm_extension_process(const protocol_packet_t *packet,
                           register_table_t *registers,
                           protocol_result_t *result,
                           void *context);

#endif
