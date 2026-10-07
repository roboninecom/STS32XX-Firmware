'use strict';

class StsError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}

class SerialDisconnectedError extends StsError {}
class SerialOperationTimeoutError extends StsError {}
class RequestTimeoutError extends StsError {}
class MissingResponseError extends RequestTimeoutError {}
class InvalidPacketError extends StsError {}
class SettingsVerificationError extends StsError {}

class ServoStatusError extends StsError {
  constructor(id, status, flags) {
    super(`STS servo ${id} returned ${flags.join(', ') || `status 0x${status.toString(16)}`}`, {
      id,
      status,
      flags,
    });
  }
}

module.exports = {
  StsError,
  SerialDisconnectedError,
  SerialOperationTimeoutError,
  RequestTimeoutError,
  MissingResponseError,
  InvalidPacketError,
  SettingsVerificationError,
  ServoStatusError,
};
