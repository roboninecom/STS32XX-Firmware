'use strict';

class CleanupError extends Error {
  constructor(message, operationError, cleanupError) {
    super(message, { cause: cleanupError });
    this.name = 'CleanupError';
    this.operationError = operationError;
    this.cleanupError = cleanupError;
  }
}

module.exports = { CleanupError };
