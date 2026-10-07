'use strict';

const Storage = Object.freeze({
  READ_ONLY: 'read-only',
  EEPROM: 'eeprom',
  RAM: 'ram',
  CONTROL: 'control',
});

const Access = Object.freeze({
  READ: 'read',
  READ_WRITE: 'read-write',
});

function register(address, size, storage, encoding, options = {}) {
  return Object.freeze({
    address,
    size,
    storage,
    access: storage === Storage.READ_ONLY ? Access.READ : Access.READ_WRITE,
    encoding,
    ...options,
  });
}

const ro = (address, size, encoding, options) =>
  register(address, size, Storage.READ_ONLY, encoding, options);

const eeprom = (address, size, encoding, options) =>
  register(address, size, Storage.EEPROM, encoding, options);

const ram = (address, size, encoding, options) =>
  register(address, size, Storage.RAM, encoding, options);

// STS3215 control table recovered from factory firmware.
// Public codec values are raw register units; `scale` and `unit` describe
// how to convert them for display. Multi-byte fields are little-endian.
// The `signN` encodings use bit N as a direction/sign flag.
const ControlTable = Object.freeze({
  firmwareMajor: ro(0x00, 1, 'u8', {
    description: 'Firmware main version',
  }),
  firmwareMinor: ro(0x01, 1, 'u8', {
    description: 'Firmware secondary version',
  }),
  modelMinor: ro(0x02, 1, 'u8', {
    description: 'Model secondary identifier',
  }),
  modelMajor: ro(0x03, 1, 'u8', {
    description: 'Model main identifier',
  }),
  reserved4: eeprom(0x04, 1, 'u8', {
    default: 0,
    description: 'Reserved EEPROM byte; writable by factory permission table',
  }),

  id: eeprom(0x05, 1, 'u8', {
    min: 0,
    max: 253,
    default: 1,
  }),

  baudRate: eeprom(0x06, 1, 'u8', {
    min: 0,
    max: 7,
    default: 0,
    values: Object.freeze([0, 1, 2, 3, 4, 5, 6, 7]),
    description:
      'Baud-rate selector: 1M, 500k, 250k, 128k, 115200, 76800, 57600, 38400',
  }),

  reserved7: eeprom(0x07, 1, 'u8', {
    default: 0,
    description:
      'Reserved EEPROM byte; not used by recovered response-delay code',
  }),

  responseStatusLevel: eeprom(0x08, 1, 'u8', {
    values: Object.freeze([0, 1]),
    default: 1,
  }),

  minAngleLimit: eeprom(0x09, 2, 'u16', {
    min: 0,
    max: 4094,
    default: 0,
    unit: 'step',
  }),

  maxAngleLimit: eeprom(0x0B, 2, 'u16', {
    min: 0,
    max: 4095,
    default: 0,
    unit: 'step',
  }),

  maxTemperature: eeprom(0x0D, 1, 'u8', {
    min: 0,
    max: 100,
    default: 80,
    unit: 'degC',
  }),

  maxVoltage: eeprom(0x0E, 1, 'u8', {
    min: 0,
    max: 254,
    default: 80,
    scale: 0.1,
    unit: 'V',
  }),

  minVoltage: eeprom(0x0F, 1, 'u8', {
    min: 0,
    max: 254,
    default: 40,
    scale: 0.1,
    unit: 'V',
  }),

  maxTorque: eeprom(0x10, 2, 'u16', {
    min: 0,
    max: 1000,
    default: 1000,
    scale: 0.1,
    unit: '%',
  }),

  configurationFlags: eeprom(0x12, 1, 'u8', {
    min: 0,
    max: 254,
    default: 32,
    description:
      'Configuration flags; includes direction and scaling behavior',
  }),

  protectionShutdownMask: eeprom(0x13, 1, 'u8', {
    min: 0,
    max: 254,
    default: 39,
  }),

  ledAlarmMask: eeprom(0x14, 1, 'u8', {
    min: 0,
    max: 254,
    default: 39,
  }),

  positionPGain: eeprom(0x15, 1, 'u8', {
    min: 0,
    max: 254,
    default: 32,
  }),

  positionDGain: eeprom(0x16, 1, 'u8', {
    min: 0,
    max: 254,
    default: 32,
  }),

  positionIGain: eeprom(0x17, 1, 'u8', {
    min: 0,
    max: 254,
    default: 4,
  }),

  positionPunch: eeprom(0x18, 1, 'u8', {
    min: 0,
    max: 254,
    default: 16,
    description:
      'Minimum drive / punch added to nonzero position-controller output',
  }),

  positionIntegralClamp: eeprom(0x19, 1, 'u8', {
    min: 0,
    max: 254,
    default: 0,
    description:
      'Position integral-term clamp; zero disables the explicit I-term clamp',
  }),

  clockwiseDeadZone: eeprom(0x1A, 1, 'u8', {
    min: 0,
    max: 32,
    default: 2,
    unit: 'step',
  }),

  counterclockwiseDeadZone: eeprom(0x1B, 1, 'u8', {
    min: 0,
    max: 32,
    default: 2,
    unit: 'step',
  }),

  currentOrOverloadThreshold: eeprom(0x1C, 2, 'u16', {
    min: 0,
    max: 511,
    default: 0,
    scale: 6.5,
    unit: 'mA',
    description:
      'Current or overload threshold; exact factory semantics/scaling still under investigation',
  }),

  positionScalingDivisor: eeprom(0x1E, 1, 'u8', {
    min: 1,
    max: 100,
    default: 1,
    description:
      'Position scaling divisor; runtime substitutes 1 if stored value is zero',
  }),

  positionCorrection: eeprom(0x1F, 2, 'positionOffset', {
    min: -4095,
    max: 4095,
    default: 0,
    unit: 'step',
    description:
      'Position offset subtracted when calculating the reported position',
  }),

  operationMode: eeprom(0x21, 1, 'u8', {
    values: Object.freeze([0, 1, 2, 3]),
    default: 0,
  }),

  protectiveTorque: eeprom(0x22, 1, 'u8', {
    min: 0,
    max: 254,
    default: 40,
    unit: '%',
  }),

  protectionTime: eeprom(0x23, 1, 'u8', {
    min: 0,
    max: 254,
    default: 80,
    unit: '10ms',
  }),

  overloadTorque: eeprom(0x24, 1, 'u8', {
    min: 0,
    max: 254,
    default: 80,
    unit: '%',
  }),

  speedPGain: eeprom(0x25, 1, 'u8', {
    min: 0,
    max: 254,
    default: 25,
  }),

  overcurrentTime: eeprom(0x26, 1, 'u8', {
    min: 0,
    max: 254,
    default: 0,
    unit: '10ms',
  }),

  speedIGain: eeprom(0x27, 1, 'u8', {
    min: 0,
    max: 254,
    default: 50,
  }),

  torqueEnable: ram(0x28, 1, 'u8', {
    values: Object.freeze([0, 1, 2, 128]),
    default: 0,
    description:
      '0 brakes/disables, 1 enables control, 2 selects the factory coast state, 128 calibrates position to 2048 and persists the offset',
  }),

  acceleration: ram(0x29, 1, 'u8', {
    min: 0,
    max: 254,
    default: 0,
    unit: '100 step/s^2',
  }),

  targetPosition: ram(0x2A, 2, 'sign15', {
    min: -32767,
    max: 32767,
    default: 0,
    unit: 'step',
  }),

  goalPWM: ram(0x2C, 2, 'sign10', {
    min: -1023,
    max: 1023,
    default: 0,
    description: 'Goal PWM used by open-loop PWM mode',
  }),

  goalVelocity: ram(0x2E, 2, 'sign15', {
    min: -32767,
    max: 32767,
    default: 0,
    unit: 'step/s',
  }),

  torqueLimit: ram(0x30, 2, 'u16', {
    min: 0,
    max: 1000,
    default: 1000,
    scale: 0.1,
    unit: '%',
  }),

  undocumentedRuntime50: ram(0x32, 1, 'u8', {
    default: 0,
    description: 'Undocumented factory runtime control',
  }),

  undocumentedRuntime51: ram(0x33, 1, 'u8', {
    default: 0,
    description: 'Undocumented factory runtime control',
  }),

  undocumentedRuntime52: ram(0x34, 1, 'u8', {
    default: 0,
    description: 'Undocumented factory runtime control',
  }),

  undocumentedRuntime53: ram(0x35, 1, 'u8', {
    default: 0,
    description: 'Undocumented factory runtime control',
  }),

  undocumentedRuntime54: ram(0x36, 1, 'u8', {
    default: 0,
    description: 'Undocumented factory runtime control',
  }),

  lock: register(0x37, 1, Storage.CONTROL, 'u8', {
    values: Object.freeze([0, 1]),
    default: 1,
    description:
      'Persistence and side-effect lock; nonzero suppresses EEPROM persistence and the generic side-effect pass',
  }),

  presentPosition: ro(0x38, 2, 'sign15', {
    unit: 'step',
  }),

  presentSpeed: ro(0x3A, 2, 'sign15', {
    unit: 'step/s',
  }),

  presentPWM: ro(0x3C, 2, 'sign10', {
    description:
      'Present PWM/controller output; factory firmware uses sign encoding for negative values',
  }),

  presentVoltage: ro(0x3E, 1, 'u8', {
    scale: 0.1,
    unit: 'V',
  }),

  presentTemperature: ro(0x3F, 1, 'u8', {
    unit: 'degC',
  }),

  asyncWritePending: ro(0x40, 1, 'u8'),

  servoStatus: ro(0x41, 1, 'u8'),

  moving: ro(0x42, 1, 'u8'),

  activeProfileGoalPosition: ro(0x43, 2, 'sign15', {
    unit: 'step',
    description:
      'Current internal profiled position; despite the legacy key name, this advances toward the goal',
  }),

  presentCurrent: ro(0x45, 2, 'sign15', {
    scale: 6.5,
    unit: 'mA',
  }),

  activeProfileVelocity: ro(0x47, 2, 'sign15', {
    description:
      'Active internal profile velocity/output; exact semantics still under investigation',
  }),

  undocumentedStatus73: ro(0x49, 1, 'u8', {
    description: 'Undocumented factory status byte',
  }),

  undocumentedStatus74: ro(0x4A, 1, 'u8', {
    description: 'Undocumented factory status byte',
  }),

  undocumentedStatus75: ro(0x4B, 1, 'u8', {
    description: 'Undocumented factory status byte',
  }),

  undocumentedStatus76: ro(0x4C, 1, 'u8', {
    description: 'Undocumented factory status byte',
  }),

  undocumentedStatus77: ro(0x4D, 1, 'u8', {
    description: 'Undocumented factory status byte',
  }),

  undocumentedExtended78: eeprom(0x4E, 1, 'u8', {
    default: 0,
    description: 'Undocumented extended factory configuration byte',
  }),

  undocumentedExtended79: eeprom(0x4F, 1, 'u8', {
    default: 0,
    description: 'Undocumented extended factory configuration byte',
  }),

  derivativeAndMovingDeadband: eeprom(0x50, 1, 'u8', {
    min: 0,
    max: 254,
    default: 2,
    description:
      'Shared measured-speed moving threshold and position-D delta deadband',
  }),

  derivativeSampleCount: eeprom(0x51, 1, 'u8', {
    default: 20,
    unit: 'control ticks',
    description: 'Position-controller derivative sampling interval',
  }),

  motionRateScale: eeprom(0x52, 1, 'u8', {
    default: 50,
    description: 'Central motion-rate scale used by speed sampling and velocity/profile conversion',
  }),

  minimumVelocity: eeprom(0x53, 1, 'u8', {
    default: 1,
    description: 'Vmin',
  }),

  maximumVelocity: eeprom(0x54, 1, 'u8', {
    default: 150, // factory image; UI screenshot currently shows 65
    description: 'Vmax',
  }),

  maximumAcceleration: eeprom(0x55, 1, 'u8', {
    default: 100, // factory image; UI screenshot currently shows 254
    description: 'Amax',
  }),

  accelerationCoefficient: eeprom(0x56, 1, 'u8', {
    default: 1,
    description: 'KAcc',
  }),
});

const ServoStatus = Object.freeze({
  VOLTAGE: 0x01,
  SENSOR: 0x02,
  TEMPERATURE: 0x04,
  CURRENT: 0x08,
  ANGLE: 0x10,
  OVERLOAD: 0x20,
});

function decodeServoStatus(status) {
  if (!Number.isInteger(status) || status < 0 || status > 0xFF) {
    throw new TypeError('servo status must be a byte');
  }

  return Object.entries(ServoStatus)
    .filter(([, mask]) => status & mask)
    .map(([name]) => name);
}

module.exports = {
  Access,
  ControlTable,
  decodeServoStatus,
  ServoStatus,
  Storage,
};
