'use strict';

const { EventEmitter } = require('events');
const { checksum } = require('./PacketEncoder');

const HEADER_SIZE = 4;
const MIN_LENGTH = 2;

class PacketDecoder extends EventEmitter {
  #buffer = Buffer.alloc(0);

  push(chunk) {
    if (!chunk?.length) return;
    this.#buffer = this.#buffer.length
      ? Buffer.concat([this.#buffer, chunk])
      : (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    this.#parse();
  }

  reset() {
    this.#buffer = Buffer.alloc(0);
  }

  #parse() {
    while (this.#buffer.length >= 2) {
      const start = this.#findHeader();
      if (start < 0) {
        this.#buffer = this.#buffer[this.#buffer.length - 1] === 0xFF
          ? this.#buffer.subarray(this.#buffer.length - 1)
          : Buffer.alloc(0);
        return;
      }
      if (start > 0) {
        this.emit('diagnostic', { type: 'discarded-bytes', count: start });
        this.#buffer = this.#buffer.subarray(start);
      }
      if (this.#buffer.length < HEADER_SIZE) return;

      const length = this.#buffer[3];
      if (length < MIN_LENGTH) {
        this.emit('diagnostic', { type: 'invalid-length', length });
        this.#buffer = this.#buffer.subarray(1);
        continue;
      }

      const frameLength = HEADER_SIZE + length;
      if (this.#buffer.length < frameLength) return;
      const packet = this.#buffer.subarray(0, frameLength);
      const receivedChecksum = packet[frameLength - 1];
      const expectedChecksum = checksum(packet, 2, frameLength - 1);
      if (receivedChecksum !== expectedChecksum) {
        this.emit('diagnostic', {
          type: 'checksum-mismatch',
          expected: expectedChecksum,
          received: receivedChecksum,
        });
        this.#buffer = this.#buffer.subarray(1);
        continue;
      }

      this.emit('packet', {
        id: packet[2],
        error: packet[4],
        parameters: packet.subarray(5, frameLength - 1),
      });
      this.#buffer = this.#buffer.subarray(frameLength);
    }
  }

  #findHeader() {
    for (let index = 0; index < this.#buffer.length - 1; index += 1) {
      if (this.#buffer[index] === 0xFF && this.#buffer[index + 1] === 0xFF) return index;
    }
    return -1;
  }
}

module.exports = { PacketDecoder };
