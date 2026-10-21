'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { CleanupError } = require('../errors');
const { persistentBytes } = require('../register-image');

const byteValues = [0, 1, 31, 127, 254, 255];
const byteRegisters = [21, 22, 23, 24, 25, 41];

async function checkValues({ rig, id }, address, values, width) {
  const before = await rig.read(id, 0, 87);
  assert.equal(before[40], 0, 'value matrix requires torque off');
  assert.equal(before[55], 1, 'value matrix requires locked EEPROM at entry');
  const observations = [];
  let operationError;
  try {
    await rig.write(id, 55, [2]);
    for (const value of values) {
      const bytes = width === 1 ? [value] : [value & 0xff, value >> 8];
      await rig.write(id, address, bytes);
      if (address === 41 && value > before[85]) await delay(25);
      const readback = await rig.read(id, address, width);
      // The control loop clamps acceleration to maximumAcceleration (85),
      // but an immediate READ can race that update.
      const expected = address === 41 && value !== 0
        ? [Math.min(value, before[85])] : bytes;
      assert.deepEqual([...readback], expected,
        `register ${address} did not read back value ${value}`);
      observations.push({ value, readback: [...readback] });
    }
  } catch (error) { operationError = error; }
  try {
    await rig.reset(id);
    const after = await rig.read(id, 0, 87);
    assert.deepEqual(persistentBytes(after), persistentBytes(before),
      `value matrix at ${address} changed persistent settings`);
    assert.deepEqual(after.subarray(address, address + width),
      before.subarray(address, address + width),
      `register ${address} was not reset`);
    assert.equal(after[40], 0);
    assert.equal(after[55], 1);
  } catch (cleanupError) {
    throw new CleanupError(`value matrix cleanup failed at ${address}`,
      operationError, cleanupError);
  }
  if (operationError) throw operationError;
  return { exact: { valuesAccepted: values.length, resetRestored: true },
    evidence: { address, width, observations } };
}

module.exports = [
  ...byteRegisters.map(address => ({
    id: `test_value_matrix_byte_${address}`, scope: 'device', risk: 'safe',
    stages: ['value-matrix'],
    covers: { registers: [address, 55], values: byteValues },
    run: context => checkValues(context, address, byteValues, 1),
  })),
  { id: 'test_value_matrix_runtime_output_cap', scope: 'device', risk: 'safe',
    stages: ['value-matrix'],
    covers: { registers: [48, 49, 55], values: [0, 1, 100, 500, 1000] },
    run: context => checkValues(context, 48, [0, 1, 100, 500, 1000], 2) },
];
