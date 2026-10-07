'use strict';

class StsDevice {
  constructor(bus, id) {
    this.bus = bus;
    this.id = id;
  }

  read(registers, options) {
    return this.bus.read(this.id, registers, options);
  }

  write(values, options) {
    return this.bus.write(this.id, values, options);
  }

  regWrite(values, options) {
    return this.bus.regWrite([{ id: this.id, values }], options);
  }

  factoryReset(options) {
    return this.bus.protocol.factoryReset(this.id, options);
  }

  systemReset(options) {
    return this.bus.protocol.systemReset(this.id, options);
  }

  saveResetTemplate(options) {
    return this.bus.protocol.saveResetTemplate(this.id, options);
  }

  encoderHome(options) {
    return this.bus.protocol.encoderHome(this.id, options);
  }

  calibratePosition(desiredPosition, options) {
    return this.bus.protocol.calibratePosition(this.id, desiredPosition, options);
  }
}

module.exports = { StsDevice };
