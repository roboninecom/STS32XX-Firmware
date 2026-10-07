'use strict';

const { ControlTable, Access } = require('./ControlTable');

function descriptor(key) {
  const value = ControlTable[key];
  if (!value) throw new TypeError(`Unknown STS register: ${key}`);
  return value;
}

function validateValue(key, value, register = descriptor(key)) {
  if (!Number.isInteger(value)) throw new TypeError(`${key} must be an integer`);
  if (register.values && !register.values.includes(value)) {
    throw new RangeError(`${key} must be one of: ${register.values.join(', ')}`);
  }
  if (register.min != null && value < register.min) {
    throw new RangeError(`${key} must be at least ${register.min}`);
  }
  if (register.max != null && value > register.max) {
    throw new RangeError(`${key} must be at most ${register.max}`);
  }
}

function encodeInto(key, value, buffer, offset = 0) {
  const register = descriptor(key);
  if (register.access !== Access.READ_WRITE) throw new TypeError(`${key} is read-only`);
  validateValue(key, value, register);
  switch (register.encoding) {
    case 'u8': buffer.writeUInt8(value, offset); break;
    case 'u16': buffer.writeUInt16LE(value, offset); break;
    case 'sign10': writeSignMagnitude(buffer, offset, value, 10); break;
    case 'sign11': writeSignMagnitude(buffer, offset, value, 11); break;
    case 'sign15': writeSignMagnitude(buffer, offset, value, 15); break;
    case 'positionOffset': writePositionOffset(buffer, offset, value); break;
    default: throw new TypeError(`${key} has no writable encoding`);
  }
}

function encode(key, value) {
  const register = descriptor(key);
  const buffer = Buffer.allocUnsafe(register.size);
  encodeInto(key, value, buffer);
  return buffer;
}

function decode(key, buffer, offset = 0) {
  const register = descriptor(key);
  if (!Buffer.isBuffer(buffer) || offset < 0 || offset + register.size > buffer.length) {
    throw new RangeError(`Not enough data to decode ${key}`);
  }
  switch (register.encoding) {
    case 'u8': return buffer.readUInt8(offset);
    case 'u16': return buffer.readUInt16LE(offset);
    case 'sign10': return readSignMagnitude(buffer, offset, 10);
    case 'sign11': return readSignMagnitude(buffer, offset, 11);
    case 'sign15': return readSignMagnitude(buffer, offset, 15);
    case 'positionOffset': return readPositionOffset(buffer, offset);
    case 'bytes': return Buffer.from(buffer.subarray(offset, offset + register.size));
    default: throw new TypeError(`Unsupported encoding for ${key}`);
  }
}

function writeSignMagnitude(buffer, offset, value, signBit) {
  const encoded = Math.abs(value) | (value < 0 ? 1 << signBit : 0);
  buffer.writeUInt16LE(encoded, offset);
}

function readSignMagnitude(buffer, offset, signBit) {
  const encoded = buffer.readUInt16LE(offset);
  const magnitude = encoded & ((1 << signBit) - 1);
  return encoded & (1 << signBit) ? -magnitude : magnitude;
}

function writePositionOffset(buffer, offset, value) {
  let encoded;
  if (value < -2047) encoded = 0x1000 - value;
  else if (value < 0) encoded = 0x0800 - value;
  else if (value < 0x0800) encoded = value;
  else encoded = value + 0x0800;
  buffer.writeUInt16LE(encoded, offset);
}

function readPositionOffset(buffer, offset) {
  const encoded = buffer.readUInt16LE(offset);
  if (encoded < 0x0800) return encoded;
  if (encoded === 0x0800) return 0;
  if (encoded < 0x1000) return 0x0800 - encoded;
  if (encoded < 0x1800) return encoded - 0x0800;
  if (encoded < 0x2000) return 0x1000 - encoded;
  return 0;
}

module.exports = { decode, descriptor, encode, encodeInto, validateValue };
