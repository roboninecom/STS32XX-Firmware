'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { CleanupError } = require('../errors');
const { persistentBytes } = require('../register-image');

async function waitForAlarm(rig, id, bit, active, timeoutMs = 1500) {
  const started = process.hrtime.bigint();
  const samples = [];
  while (Number(process.hrtime.bigint() - started) / 1e6 < timeoutMs) {
    const data = await rig.read(id, 62, 4);
    const sample = {
      elapsedMs: Number(process.hrtime.bigint() - started) / 1e6,
      voltage: data[0], temperature: data[1], status: data[3],
    };
    samples.push(sample);
    if (Boolean(sample.status & bit) === active) {
      return { observed: true, samples, elapsedMs: sample.elapsedMs };
    }
    await delay(10);
  }
  return { observed: false, samples, elapsedMs: null };
}

function thresholdCase({ name, address, bit, threshold, preflight }) {
  return {
    id: `test_${name}_threshold`, scope: 'device', risk: 'safe', stages: ['protection'],
    covers: { registers: [address, 62, 63, 65], protection: [name] },
    async run({ rig, id }) {
      const before = await rig.read(id, 0, 87);
      assert.equal(before[40], 0, 'torque must be off for threshold injection');
      assert.equal(before[55], 1, 'persistence must start locked');
      assert.equal(before[65] & bit, 0, `${name} alarm already active`);
      preflight(before);
      const injected = threshold(before);
      let operationError;
      let onset;
      let recovery;
      try {
        await rig.write(id, 55, [2]);
        await rig.write(id, address, [injected]);
        assert.equal((await rig.read(id, address, 1))[0], injected);
        onset = await waitForAlarm(rig, id, bit, true);
        assert.ok(onset.observed, `${name} alarm did not assert`);
        assert.ok(((await rig.ping(id)).error & bit) !== 0,
          `${name} alarm missing from status response`);
        await rig.write(id, address, [before[address]]);
        recovery = await waitForAlarm(rig, id, bit, false);
        assert.ok(recovery.observed, `${name} alarm did not clear`);
        assert.equal((await rig.ping(id)).error & bit, 0,
          `${name} alarm remained in status response`);
      } catch (error) { operationError = error; }
      try {
        await rig.reset(id);
        const after = await rig.read(id, 0, 87);
        assert.deepEqual(persistentBytes(after), persistentBytes(before),
          `${name} test changed persistent settings`);
        assert.equal(after[40], 0);
        assert.equal(after[55], 1);
        const cleared = await waitForAlarm(rig, id, bit, false, 500);
        assert.ok(cleared.observed, `${name} alarm survived reset`);
      } catch (cleanupError) {
        throw new CleanupError(`${name} threshold cleanup failed`, operationError, cleanupError);
      }
      if (operationError) throw operationError;
      return { exact: { alarmAsserted: true, alarmCleared: true,
        replyStatusMatched: true, resetRestoredSettings: true },
      evidence: { sensorAtStart: { voltage: before[62], temperature: before[63] },
        originalThreshold: before[address], injectedThreshold: injected,
        onset, recovery } };
    },
  };
}

module.exports = [
  thresholdCase({
    name: 'overvoltage', address: 14, bit: 0x01,
    threshold: before => before[62] - 10,
    preflight: before => {
      assert.ok(before[62] >= 20 && before[62] <= 230, 'voltage out of safe injection range');
      assert.ok(before[14] > before[62] + 6, 'original high-voltage limit lacks recovery headroom');
    },
  }),
  thresholdCase({
    name: 'undervoltage', address: 15, bit: 0x01,
    threshold: before => before[62] + 10,
    preflight: before => {
      assert.ok(before[62] >= 20 && before[62] <= 230, 'voltage out of safe injection range');
      assert.ok(before[15] + 6 < before[62], 'original low-voltage limit lacks recovery headroom');
    },
  }),
  thresholdCase({
    name: 'overtemperature', address: 13, bit: 0x04,
    threshold: before => before[63] - 5,
    preflight: before => {
      assert.ok(before[63] >= 10 && before[63] <= 200, 'temperature out of safe injection range');
      assert.ok(before[13] > before[63] + 7, 'original temperature limit lacks hysteresis recovery headroom');
    },
  }),
  {
    id: 'test_overtemperature_hysteresis_boundary', scope: 'device', risk: 'safe',
    stages: ['protection'],
    covers: { registers: [13, 55, 63, 65], protection: ['overtemperature-hysteresis'] },
    async run({ rig, id }) {
      const before = await rig.read(id, 0, 87);
      assert.equal(before[40], 0);
      assert.equal(before[55], 1);
      assert.equal(before[65] & 0x04, 0);
      const temperature = before[63];
      assert.ok(temperature >= 10 && temperature <= 200);
      let operationError;
      let onset;
      let equalityHold;
      let recovery;
      try {
        await rig.write(id, 55, [2]);
        await rig.write(id, 13, [temperature - 5]);
        onset = await waitForAlarm(rig, id, 0x04, true);
        assert.ok(onset.observed, 'temperature alarm did not assert');
        await rig.write(id, 13, [temperature + 5]);
        equalityHold = await waitForAlarm(rig, id, 0x04, false, 140);
        assert.equal(equalityHold.observed, false,
          'temperature alarm cleared at the five-degree hysteresis boundary');
        await rig.write(id, 13, [temperature + 6]);
        recovery = await waitForAlarm(rig, id, 0x04, false, 500);
        assert.ok(recovery.observed, 'temperature alarm did not clear beyond hysteresis');
        await rig.write(id, 13, [before[13]]);
      } catch (error) { operationError = error; }
      try {
        await rig.reset(id);
        const after = await rig.read(id, 0, 87);
        assert.deepEqual(persistentBytes(after), persistentBytes(before));
        assert.equal(after[40], 0);
        assert.equal(after[55], 1);
      } catch (cleanupError) {
        throw new CleanupError('temperature hysteresis cleanup failed', operationError, cleanupError);
      }
      if (operationError) throw operationError;
      return { exact: { alarmAsserted: true, heldAtFiveDegrees: true,
        clearedBeyondFiveDegrees: true, settingsRestored: true },
      evidence: { temperature, onset, equalityHold, recovery } };
    },
  },
];
