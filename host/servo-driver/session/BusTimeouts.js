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

  discovery() {
    // Broadcast PING replies are slotted by numeric ID, not motor count.
    // A six-byte reply occupies a nine-byte slot, rounded per byte by firmware.
    return Math.ceil(254 * 9 * Math.ceil(10_000_000 / this.baudRate) / 1000) + 100;
  }

  single(requestBytes, parameterBytes = 0) {
    return this.forBytes(requestBytes + parameterBytes + 6);
  }

  multiple(requestBytes, servoCount, parameterBytes = 0) {
    return this.forBytes(requestBytes + servoCount * (parameterBytes + 6));
  }
}

module.exports = { BusTimeouts };
