'use strict';

const BROADCAST_ID = 0xFE;
const MAX_SERVO_ID = 0xFD;

const Instruction = Object.freeze({
  PING: 0x01,
  READ: 0x02,
  WRITE: 0x03,
  REG_WRITE: 0x04,
  ACTION: 0x05,
  FACTORY_RESET: 0x06,
  SYSTEM_RESET: 0x08,
  SAVE_RESET_TEMPLATE: 0x09,
  ENCODER_HOME: 0x0A,
  POSITION_CALIBRATE: 0x0B,
  SYNC_READ: 0x82,
  SYNC_WRITE: 0x83,
  ARM_READ: 0x90,
  ARM_WRITE: 0x91,
  ARM_GRAVITY: 0x99,
  ARM_TARGETS: 0x9A,
});

const DeviceAlarm = Object.freeze({
  VOLTAGE: 0x01,
  SENSOR: 0x02,
  TEMPERATURE: 0x04,
  CURRENT: 0x08,
  ANGLE: 0x10,
  OVERLOAD: 0x20,
});

const BAUD_RATES = Object.freeze([
  1_000_000, 500_000, 250_000, 128_000, 115_200, 76_800, 57_600, 38_400,
]);

module.exports = {
  BAUD_RATES,
  BROADCAST_ID,
  DeviceAlarm,
  MAX_SERVO_ID,
  Instruction,
  ResponseError: DeviceAlarm,
};
