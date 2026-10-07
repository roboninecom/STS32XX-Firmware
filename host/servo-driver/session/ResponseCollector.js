'use strict';

const { MissingResponseError, RequestTimeoutError } = require('../protocol/errors');

class ResponseCollector {
  #mode;
  #match;
  #expectedIds;
  #responses = new Map();
  #strict;
  #timeout;
  #timeoutMs;
  #silenceMs;
  #silenceTimer;
  #settled = false;
  #resolve;
  #reject;
  #startedAt = process.hrtime.bigint();

  constructor({ mode, match, expectedIds, strict = true, timeoutMs, silenceMs = null }) {
    this.#mode = mode;
    this.#match = match;
    this.#expectedIds = expectedIds ? new Set(expectedIds) : null;
    this.#strict = strict;
    this.#timeoutMs = timeoutMs;
    this.#silenceMs = silenceMs;
    this.promise = new Promise((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });
  }

  accept(packet) {
    if (this.#settled) return false;
    let matches;
    try {
      matches = this.#match(packet);
    } catch (error) {
      this.reject(error);
      return false;
    }
    if (!matches) return false;

    if (this.#mode === 'single') {
      this.#finish(packet);
      return true;
    }

    this.#responses.set(packet.id, packet);
    if (this.#expectedIds?.size === this.#responses.size) this.#finish(this.#result());
    else if (!this.#expectedIds) this.#restartSilenceTimer();
    return true;
  }

  sent() {
    if (this.#settled) return;
    this.#timeout = setTimeout(() => this.#onTimeout(this.#timeoutMs), this.#timeoutMs);
  }

  reject(error) {
    if (this.#settled) return;
    this.#settled = true;
    this.#cleanup();
    this.#reject(error);
  }

  #restartSilenceTimer() {
    if (this.#silenceMs == null) return;
    clearTimeout(this.#silenceTimer);
    this.#silenceTimer = setTimeout(() => this.#finish(this.#result()), this.#silenceMs);
  }

  #onTimeout(timeoutMs) {
    if (this.#mode === 'multiple') {
      const result = this.#result();
      if (!this.#strict || !this.#expectedIds) this.#finish(result);
      else this.reject(new MissingResponseError(
        `Missing STS responses from IDs: ${result.missingIds.join(', ')}`,
        { ...result, timeoutMs }
      ));
      return;
    }
    this.reject(new RequestTimeoutError(`STS request timed out after ${timeoutMs} ms`, { timeoutMs }));
  }

  #result() {
    return {
      responses: new Map(this.#responses),
      missingIds: this.#expectedIds
        ? [...this.#expectedIds].filter(id => !this.#responses.has(id))
        : [],
      durationMs: Number(process.hrtime.bigint() - this.#startedAt) / 1e6,
    };
  }

  #finish(value) {
    if (this.#settled) return;
    this.#settled = true;
    this.#cleanup();
    this.#resolve(value);
  }

  #cleanup() {
    clearTimeout(this.#timeout);
    clearTimeout(this.#silenceTimer);
  }
}

module.exports = { ResponseCollector };
