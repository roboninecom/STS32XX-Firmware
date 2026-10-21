'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { CleanupError } = require('../errors');
const { positionDelta } = require('../position');
const { persistentBytes } = require('../register-image');

const alignedPosition = 2048;

function position(bytes, signed) {
  const raw = bytes[0] | (bytes[1] << 8);
  return signed && (raw & 0x8000) ? -(raw & 0x7fff) : raw;
}

module.exports = [
  {
    id: 'test_prerequisite_ping', prerequisite: true, scope: 'device', risk: 'safe',
    stages: ['prerequisites'], covers: { commands: ['PING'] },
    async run({ rig, id }) {
      assert.equal((await rig.ping(id)).id, id);
      return { exact: { ping: true } };
    },
  },
  {
    id: 'test_prerequisite_read', prerequisite: true, scope: 'device', risk: 'safe',
    stages: ['prerequisites'], covers: { commands: ['READ'], registers: [40, 41, 55, 56] },
    async run({ rig, id }) {
      const data = await rig.read(id, 40, 17);
      assert.equal(data.length, 17);
      assert.equal(data[0], 0, 'torque must be off before prerequisite writes');
      return { exact: { read: true, torqueOff: true }, evidence: { bytes: data.toString('hex') } };
    },
  },
  {
    id: 'test_prerequisite_ram_write', prerequisite: true, scope: 'device', risk: 'safe',
    stages: ['prerequisites'], covers: { commands: ['WRITE'], registers: [41, 55] },
    async run({ rig, id }) {
      const original = (await rig.read(id, 41, 1))[0];
      const originalLock = (await rig.read(id, 55, 1))[0];
      const probe = original ^ 1;
      let operationError;
      try {
        await rig.write(id, 55, [2]);
        await rig.write(id, 41, [probe]);
        assert.equal((await rig.read(id, 41, 1))[0], probe);
      } catch (error) { operationError = error; }
      finally {
        try {
          await rig.write(id, 41, [original]);
          await rig.write(id, 55, [originalLock]);
          assert.equal((await rig.read(id, 41, 1))[0], original);
          assert.equal((await rig.read(id, 55, 1))[0], originalLock);
        } catch (cleanupError) {
          throw new CleanupError('prerequisite RAM write cleanup failed', operationError, cleanupError);
        }
      }
      if (operationError) throw operationError;
      return { exact: { ramWrite: true, restored: true } };
    },
  },
  {
    id: 'test_prerequisite_system_reset', prerequisite: true, scope: 'device', risk: 'safe',
    stages: ['prerequisites'], covers: { commands: ['SYSTEM_RESET'], registers: [40, 41, 55] },
    async run({ rig, id }) {
      const before = await rig.read(id, 0, 87);
      let resetStarted = false;
      try {
        await rig.write(id, 55, [2]);
        await rig.write(id, 41, [before[41] ^ 1]);
        assert.equal((await rig.read(id, 41, 1))[0], before[41] ^ 1);
        resetStarted = true;
        await rig.reset(id);
      } catch (error) {
        if (resetStarted) throw error;
        try { await rig.reset(id); }
        catch (cleanupError) {
          throw new CleanupError('prerequisite reset recovery failed', error, cleanupError);
        }
        throw error;
      }
      const after = await rig.read(id, 0, 87);
      assert.deepEqual(persistentBytes(after), persistentBytes(before),
        'reset changed persistent settings');
      assert.equal(after[40], 0, 'reset did not disable torque');
      assert.equal(after[41], 0, 'reset did not clear RAM acceleration');
      assert.equal(after[55], 1, 'reset did not restore lock');
      return { exact: { resetRecovered: true, ramCleared: true,
        persistenceUnchanged: true, torqueOff: true, locked: true } };
    },
  },
  {
    id: 'test_prerequisite_set_offset', prerequisite: true, scope: 'device', risk: 'safe',
    // Calibration commits the offset even while the ordinary EEPROM lock is set.
    requiresPersistenceWrite: true,
    stages: ['prerequisites'], covers: { commands: ['POSITION_CALIBRATE'], registers: [31, 32, 56] },
    async run({ rig, id }) {
      const before = await rig.read(id, 0, 87);
      assert.equal(before[40], 0, 'torque must be off before setting offset');
      assert.equal(before[55], 1, 'persistence lock must remain enabled');
      const signed = (before[18] & 0x10) !== 0;
      await rig.setOffset(id, alignedPosition);
      await delay(40);
      const live = await rig.read(id, 56, 2);
      const observed = position(live, signed);
      assert.ok(Math.abs(positionDelta(observed, alignedPosition, signed)) <= 4,
        `set offset produced position ${observed}, expected ${alignedPosition}`);
      await rig.reset(id);
      const after = await rig.read(id, 0, 87);
      const retained = position(after.subarray(56, 58), signed);
      assert.ok(Math.abs(positionDelta(retained, alignedPosition, signed)) <= 4,
        `offset position ${retained} not retained after reset`);
      assert.deepEqual(persistentBytes(after, true), persistentBytes(before, true),
        'set offset changed unrelated persistent settings');
      assert.equal(after[55], 1);
      return { exact: { offsetSet: true, positionAligned: true,
        retainedAfterReset: true, otherSettingsUnchanged: true },
      evidence: { target: alignedPosition, observed, retained,
        offsetBefore: [...before.subarray(31, 33)], offsetAfter: [...after.subarray(31, 33)] } };
    },
  },
];
