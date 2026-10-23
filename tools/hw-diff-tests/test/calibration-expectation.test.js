 'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calibrationExpectation, circularError } = require('../src/position');
const { classify } = require('../src/calibration-classify');

test('reset calibration expectation follows each physical encoder', () => {
  assert.deepEqual(calibrationExpectation(3323, 0, -2048),
    { rawAngle: 3323, storedOffset: 0, expectedReset: 3323 });
  assert.deepEqual(calibrationExpectation(1649, 0, -2048),
    { rawAngle: 1649, storedOffset: 3697, expectedReset: 2048 });
  assert.equal(calibrationExpectation(0, 0, -4095).storedOffset, 4095);
  assert.equal(calibrationExpectation(1, 0, -4095).storedOffset, 0);
  assert.equal(calibrationExpectation(4095, 1, 2048).rawAngle, 0);
  assert.equal(circularError(0, 4095), 1);
});

test('pre-reset window establishes spontaneous recovery without claiming reset causality', () => {
  const p = (atMs, sensorStatus = 0) => ({ atMs, sensorStatus, correction: 0, torque: 0 });
  const i = { before: p(0), calibrationResponseAtMs: 1, calibrationResponseStatus: 2,
    afterZeroParameterCalibration: p(2, 2), postCalibrationWindow: [p(4, 2), p(8)],
    calibrationReset: { sentAtMs: 10 }, afterCalibrationReset: p(12), preRestoreWindow: [],
    afterPreRestoreWait: p(13), restoreResponseAtMs: 14, restoreResponseStatus: 0,
    afterRestoreWrite: p(15), afterImmediateReset: p(20), firstWindow: [],
    preMalformed: p(21), postMalformed: p(22), secondWindow: [], afterWait: p(23) };
  assert.equal(classify(i).classification, 'transient alarm that cleared without reset');
  i.postCalibrationWindow = [p(4, 2), p(8, 2)];
  assert.equal(classify(i).classification, 'alarm absent after reset; spontaneous recovery not established');
});

test('equal but incorrect device errors do not pass the calibration comparator', () => {
  const entry = require('../src/cases/calibration').find(item =>
    item.id === 'test_calibration_explicit_signed_targets');
  const result = error => ({ exact: { embeddedHeaderTargetRejected: true },
    evidence: { observations: [{ target: 2048, immediateError: error,
      resetError: 0, storedOffsetError: 0 }] } });
  assert.equal(entry.compare(result(0), result(0)).matched, true);
  assert.equal(entry.compare(result(10), result(10)).matched, false);
  assert.equal(entry.compare(result(0), result(10)).matched, false);
});
