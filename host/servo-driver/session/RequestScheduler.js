'use strict';

const { EventEmitter } = require('events');
const { PacketDecoder } = require('../protocol/PacketDecoder');
const { RequestTimeoutError, SerialDisconnectedError } = require('../protocol/errors');
const { ResponseCollector } = require('./ResponseCollector');

const Priority = Object.freeze({
  CRITICAL: 0,
  MOTION: 10,
  NORMAL: 20,
  BACKGROUND: 30,
});

class RequestScheduler extends EventEmitter {
  #queue = [];
  #running = false;
  #sequence = 0;
  #activeCollector = null;
  #coalesced = new Map();
  #timeoutRecoveryMs;

  constructor(transport, { decoder = new PacketDecoder(), timeoutRecoveryMs = 2 } = {}) {
    super();
    if (!transport?.write || !transport?.on) throw new TypeError('A serial transport is required');
    this.transport = transport;
    this.decoder = decoder;
    this.#timeoutRecoveryMs = timeoutRecoveryMs;
    transport.on('data', chunk => decoder.push(chunk));
    transport.on('disconnect', () => {
      decoder.reset();
      this.#abort(new SerialDisconnectedError('STS bus disconnected'));
    });
    transport.on('fault', error => {
      this.#activeCollector?.reject(error);
      this.emit('fault', error);
    });
    decoder.on('packet', packet => {
      if (!this.#activeCollector?.accept(packet)) this.emit('unsolicitedPacket', packet);
    });
    decoder.on('diagnostic', diagnostic => this.emit('diagnostic', diagnostic));
  }

  send(packet, options = {}) {
    return this.#enqueue(() => this.#send(packet), options);
  }

  request(packet, responseOptions, queueOptions = {}) {
    return this.#enqueue(() => this.#request(packet, responseOptions), queueOptions);
  }

  collect(packet, responseOptions, queueOptions = {}) {
    return this.#enqueue(() => this.#collect(packet, responseOptions), queueOptions);
  }

  transaction(operation, options = {}) {
    if (typeof operation !== 'function') throw new TypeError('transaction operation must be a function');
    return this.#enqueue(() => operation({
      send: packet => this.#send(packet),
      request: (packet, responseOptions) => this.#request(packet, responseOptions),
      collect: (packet, responseOptions) => this.#collect(packet, responseOptions),
    }), options);
  }

  #enqueue(run, { priority = Priority.NORMAL, coalesceKey, deadlineMs } = {}) {
    if (deadlineMs != null && (!Number.isFinite(deadlineMs) || deadlineMs <= 0)) {
      throw new RangeError('deadlineMs must be positive');
    }
    if (coalesceKey && this.#coalesced.has(coalesceKey)) return this.#coalesced.get(coalesceKey);
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    const deadlineAt = deadlineMs == null ? null : performance.now() + deadlineMs;
    const task = { run, priority, sequence: this.#sequence++, resolve, reject,
                   coalesceKey, deadlineAt, promise };
    if (coalesceKey) this.#coalesced.set(coalesceKey, promise);
    this.#queue.push(task);
    this.#queue.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
    this.#drain();
    return promise;
  }

  async #drain() {
    if (this.#running) return;
    this.#running = true;
    while (this.#queue.length) {
      const task = this.#queue.shift();
      try {
        if (task.deadlineAt != null && performance.now() >= task.deadlineAt) {
          throw new Error('Queued request expired before transmission');
        }
        task.resolve(await task.run());
      } catch (error) {
        task.reject(error);
      } finally {
        if (task.coalesceKey && this.#coalesced.get(task.coalesceKey) === task.promise) {
          this.#coalesced.delete(task.coalesceKey);
        }
      }
    }
    this.#running = false;
  }

  #send(packet) {
    return this.transport.write(packet);
  }

  async #request(packet, options) {
    const collector = new ResponseCollector({ mode: 'single', ...options });
    return this.#withCollector(collector, packet);
  }

  async #collect(packet, options) {
    const collector = new ResponseCollector({ mode: 'multiple', ...options });
    return this.#withCollector(collector, packet);
  }

  async #withCollector(collector, packet) {
    this.#activeCollector = collector;
    const response = collector.promise;
    void response.catch(() => {});
    try {
      await this.transport.write(packet);
      collector.sent();
      return await response;
    } catch (error) {
      collector.reject(error);
      await response.catch(() => {});
      if (error instanceof RequestTimeoutError && this.#timeoutRecoveryMs > 0) {
        await new Promise(resolve => setTimeout(resolve, this.#timeoutRecoveryMs));
        this.decoder.reset();
      }
      throw error;
    } finally {
      if (this.#activeCollector === collector) this.#activeCollector = null;
    }
  }

  #abort(error) {
    this.#activeCollector?.reject(error);
    for (const task of this.#queue.splice(0)) task.reject(error);
    this.#coalesced.clear();
  }
}

module.exports = { RequestScheduler, Priority };
