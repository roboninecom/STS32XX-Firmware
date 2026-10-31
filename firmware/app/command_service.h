#ifndef COMMAND_SERVICE_H
#define COMMAND_SERVICE_H

#include "protocol.h"

/* Runs after byte writes and before response construction. The context is the
 * owning application state until service state is split further. */
void command_service_apply(const protocol_result_t *result, void *context);

#endif
