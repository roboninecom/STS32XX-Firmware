'use strict';

class BusTimeouts {
  constructor({ baudRate = 1_000_000, responseMarginMs = 5, minimumMs = 8 } = {}) {
    this.baudRate = baudRate;
    this.responseMarginMs = responseMarginMs;
    this.minimumMs = minimumMs;
  }

  forBytes(byteCount) {
    const wireTimeMs = byteCount * 10 * 1000 / this.baudRate;
    return Math.max(this.minimumMs, Math.ceil(wireTimeMs + this.responseMarginMs));
  }

  single(requestBytes, parameterBytes = 0) {
    return this.forBytes(requestBytes + parameterBytes + 6);
  }

  multiple(requestBytes, servoCount, parameterBytes = 0) {
    return this.forBytes(requestBytes + servoCount * (parameterBytes + 6));
  }
}

module.exports = { BusTimeouts };
