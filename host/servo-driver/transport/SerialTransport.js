'use strict';

const { EventEmitter } = require('events');
const { SerialDisconnectedError, SerialOperationTimeoutError } = require('../protocol/errors');

class SerialTransport extends EventEmitter {
  #opening = null;
  #closing = null;

  constructor({
    path,
    baudRate = 1_000_000,
    operationTimeoutMs = 5_000,
    portFactory,
    ...serialOptions
  } = {}) {
    super();
    if (!path) throw new TypeError('serial.path is required');
    if (!Number.isFinite(operationTimeoutMs) || operationTimeoutMs <= 0) {
      throw new RangeError('serial.operationTimeoutMs must be positive');
    }
    this.config = { path, baudRate, ...serialOptions };
    this.operationTimeoutMs = operationTimeoutMs;
    const options = { ...this.config, autoOpen: false };
    if (portFactory) {
      this.port = portFactory(options);
    } else {
      const { SerialPort } = require('serialport');
      this.port = new SerialPort(options);
    }
    this.port.on('data', chunk => this.emit('data', chunk));
    this.port.on('open', () => this.emit('connect'));
    this.port.on('close', () => this.emit('disconnect'));
    this.port.on('error', error => this.emit('fault', error));
  }

  get isOpen() {
    return Boolean(this.port.isOpen);
  }

  async open() {
    if (this.#closing) await this.#closing;
    if (this.isOpen) return;
    if (this.#opening) return this.#opening;
    this.#opening = this.#run('open', callback => this.port.open(callback))
      .finally(() => { this.#opening = null; });
    return this.#opening;
  }

  async close() {
    if (this.#opening) {
      try {
        await this.#opening;
      } catch {
        return;
      }
    }
    if (!this.isOpen) return;
    if (this.#closing) return this.#closing;
    this.#closing = this.#run('close', callback => this.port.close(callback))
      .finally(() => { this.#closing = null; });
    return this.#closing;
  }

  async write(data) {
    if (!this.isOpen) {
      throw new SerialDisconnectedError(`Serial port ${this.config.path} is not open`, {
        path: this.config.path,
      });
    }
    await this.#run('write', callback => this.port.write(data, callback));
    await this.#run('drain', callback => this.port.drain(callback));
  }

  async updateBaudRate(baudRate) {
    if (!Number.isInteger(baudRate) || baudRate <= 0) {
      throw new RangeError('baudRate must be a positive integer');
    }
    if (this.isOpen) {
      await this.#run('update-baud', callback => this.port.update({ baudRate }, callback));
    }
    this.config.baudRate = baudRate;
  }

  #run(operation, start) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(() => {
        settled = true;
        reject(new SerialOperationTimeoutError(
          `Serial ${operation} timed out after ${this.operationTimeoutMs} ms`,
          { operation, path: this.config.path, timeoutMs: this.operationTimeoutMs }
        ));
      }, this.operationTimeoutMs);

      try {
        start(finish);
      } catch (error) {
        finish(error);
      }
    });
  }
}

module.exports = { SerialTransport };
