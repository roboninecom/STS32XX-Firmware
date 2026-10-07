'use strict';

const { EventEmitter } = require('events');
const { SerialTransport } = require('./transport/SerialTransport');
const { RequestScheduler } = require('./session/RequestScheduler');
const { StsProtocol } = require('./protocol/StsProtocol');
const { StsBus } = require('./bus/StsBus');
const { StsSettings } = require('./bus/StsSettings');
const { ArmExtension } = require('./bus/ArmExtension');

class StsServo extends EventEmitter {
  constructor({ serial, transport, protocol = {} } = {}) {
    super();
    this.transport = transport ?? new SerialTransport(serial);
    this.scheduler = new RequestScheduler(this.transport);
    this.protocol = new StsProtocol(this.scheduler, {
      baudRate: serial?.baudRate ?? this.transport.config?.baudRate,
      ...protocol,
    });
    this.bus = new StsBus(this.protocol);
    this.arm = new ArmExtension(this.bus);
    this.settings = new StsSettings(this.bus);
    this.bus.settings = this.settings;
    for (const event of ['connect', 'disconnect', 'fault']) {
      this.transport.on(event, value => this.emit(event, value));
    }
    for (const event of ['diagnostic', 'unsolicitedPacket']) {
      this.scheduler.on(event, value => this.emit(event, value));
    }
  }

  get isConnected() {
    return this.transport.isOpen;
  }

  open() {
    return this.transport.open();
  }

  async connect({ discover = true, discovery } = {}) {
    const openedHere = !this.isConnected;
    await this.open();
    if (!discover) return undefined;
    try {
      return await this.bus.discover(discovery);
    } catch (error) {
      if (!openedHere) throw error;
      try {
        await this.close();
      } catch (closeError) {
        throw new AggregateError([error, closeError], 'STS discovery and serial cleanup failed');
      }
      throw error;
    }
  }

  close() {
    return this.transport.close();
  }
}

module.exports = { StsServo };
