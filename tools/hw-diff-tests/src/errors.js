'use strict';

class CleanupError extends Error {
  constructor(message, operationError, cleanupError) {
    super(message, { cause: cleanupError });
    this.name = 'CleanupError';
    this.operationError = operationError;
    this.cleanupError = cleanupError;
  }
}

// Cleanup must run even when setup or the test body fails. If cleanup also
// fails, retain both errors so the runner can stop further hardware operations.
async function withCleanup(operation, cleanup, message) {
  let operationError;
  let result;
  try { result = await operation(); }
  catch (error) { operationError = error; }
  try { await cleanup(); }
  catch (cleanupError) { throw new CleanupError(message, operationError, cleanupError); }
  if (operationError) throw operationError;
  return result;
}

module.exports = { CleanupError, withCleanup };
