#ifndef ARM_EXTENSION_H
#define ARM_EXTENSION_H

#include "protocol.h"

enum { ARM_FEEDBACK_BYTES = 32, ARM_TUNING_BYTES = 54 };
struct app_state;
/* Called once after a complete control/protection/bridge update. */
void arm_extension_publish_sample(struct app_state *state);

/* End both running control and any unconsumed setup. Legacy power is untouched. */
void arm_extension_end_session(struct app_state *state);
/* Apply a legacy torque write after register updates, in the foreground owner. */
void arm_extension_torque_written(struct app_state *state);

/* Foreground-only extension handler. Legacy protocol instructions never enter. */
void arm_extension_process(const protocol_packet_t *packet,
                           register_table_t *registers,
                           protocol_result_t *result,
                           void *context);

#endif
