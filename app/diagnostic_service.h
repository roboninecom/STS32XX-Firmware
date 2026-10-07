#ifndef DIAGNOSTIC_SERVICE_H
#define DIAGNOSTIC_SERVICE_H

#include "protocol.h"
#include <stdint.h>

struct app_state;

void diagnostic_service_early_init(struct app_state *state);
void diagnostic_service_device_init(struct app_state *state);
void diagnostic_service_write(struct app_state *state,
                              const register_write_result_t *write);
void diagnostic_service_period_started(struct app_state *state);
void diagnostic_service_pair_rejected(struct app_state *state);
void diagnostic_service_pair_complete(struct app_state *state);
void diagnostic_service_goal_queued(struct app_state *state);
uint32_t diagnostic_service_goal_started(struct app_state *state);
void diagnostic_service_goal_applied(struct app_state *state,
                                     uint32_t control_started_cycles);

#endif
