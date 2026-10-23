'use strict';

function positionDelta(value, baseline, signed) {
  if (signed) return value - baseline;
  const difference = (value - baseline + 4096) % 4096;
  return difference > 2048 ? difference - 4096 : difference;
}

function nearbyLogicalPosition(displayed, signed) {
  return signed || displayed <= 2048 ? displayed : displayed - 4096;
}

function encodeSign15(value) {
  if (!Number.isInteger(value) || value < -32767 || value > 32767) {
    throw new RangeError('position goal is outside sign15 range');
  }
  const raw = value < 0 ? (-value | 0x8000) : value;
  return [raw & 0xff, raw >> 8];
}

function decodeOffset(raw) {
  if (raw < 0x0800) return raw;
  if (raw === 0x0800) return 0;
  if (raw < 0x1000) return 0x0800 - raw;
  if (raw < 0x1800) return raw - 0x0800;
  if (raw < 0x2000) return 0x1000 - raw;
  return 0;
}

const wrapPosition = value => ((value % 4096) + 4096) % 4096;

// Raw angle is inferred before each torque-off calibration, after the previous
// reset has cleared any runtime-only offset. It is device-specific evidence.
function calibrationExpectation(position, priorCorrection, target) {
  const rawAngle = wrapPosition(position + decodeOffset(priorCorrection));
  const offset = rawAngle - target;
  const storedOffset = offset > 4095 ? 0 : offset;
  return { rawAngle, storedOffset, expectedReset: wrapPosition(rawAngle - storedOffset) };
}

function circularError(actual, expected) {
  return wrapPosition(actual - expected + 2048) - 2048;
}

module.exports = { positionDelta, nearbyLogicalPosition, encodeSign15, decodeOffset,
  calibrationExpectation, circularError };
