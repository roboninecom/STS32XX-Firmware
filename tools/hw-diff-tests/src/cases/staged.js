'use strict';

const assert = require('node:assert/strict');
const { Instruction } = require('../../../../host/servo-driver');
const { CleanupError } = require('../errors');
const { persistentBytes } = require('../register-image');

module.exports = [
  {
    id: 'test_staged_multiregister_ram_write', scope: 'device', risk: 'safe',
    stages: ['staged'],
    covers: { commands: ['REG_WRITE', 'ACTION', 'SYSTEM_RESET'],
      registers: [48, 49, 50, 51, 52, 55, 64] },
    async run({ rig, id }) {
      const before = await rig.read(id, 0, 87);
      assert.equal(before[40], 0, 'staged multi-register case requires torque off');
      assert.equal(before[55], 1, 'staged multi-register case requires persistence locked');
      assert.equal(before[64], 0, 'staged write already pending');
      const values = [244, 1, 0x21, 0x43, 0x65]; // Output cap 500, plus RAM bytes 50..52.
      let operationError;
      try {
        await rig.write(id, 55, [2]);
        await rig.command(id, Instruction.REG_WRITE, [48, ...values]);
        assert.equal((await rig.read(id, 64, 1))[0], 1);
        assert.deepEqual(await rig.read(id, 48, 5), before.subarray(48, 53),
          'staged multi-register values applied before ACTION');
        await rig.command(id, Instruction.ACTION);
        assert.deepEqual([...await rig.read(id, 48, 5)], values,
          'ACTION did not apply all five staged bytes');
        assert.equal((await rig.read(id, 64, 1))[0], 0);
      } catch (error) { operationError = error; }
      try {
        await rig.reset(id);
        const after = await rig.read(id, 0, 87);
        assert.deepEqual(persistentBytes(after), persistentBytes(before),
          'staged multi-register write changed persistent image');
        assert.deepEqual(after.subarray(48, 53), before.subarray(48, 53));
        assert.equal(after[40], 0);
        assert.equal(after[55], 1);
        assert.equal(after[64], 0);
      } catch (cleanupError) {
        throw new CleanupError('staged multi-register cleanup failed', operationError, cleanupError);
      }
      if (operationError) throw operationError;
      return { exact: { pendingBeforeAction: true, fiveBytesApplied: true,
        pendingCleared: true, resetRestored: true }, evidence: { values } };
    },
  },
  {
    id: 'test_staged_write_replacement_and_short_args',
    scope: 'device', risk: 'safe', stages: ['staged'],
    covers: { commands: ['REG_WRITE', 'ACTION', 'SYSTEM_RESET'], registers: [50, 64],
      malformed: ['short-reg-write'] },
    async run({ rig, id }) {
      const before = await rig.read(id, 0, 87);
      assert.equal(before[40], 0, 'torque must be off before staged write');
      let operationError;
      try {
        const first = before[50] ^ 0x11;
        const second = before[50] ^ 0x22;
        await rig.command(id, Instruction.REG_WRITE, [50, first]);
        assert.equal((await rig.read(id, 64, 1))[0], 1);
        assert.equal((await rig.read(id, 50, 1))[0], before[50]);
        await rig.command(id, Instruction.REG_WRITE, [50, second]);
        assert.equal((await rig.read(id, 50, 1))[0], before[50]);
        await rig.command(id, Instruction.ACTION);
        assert.equal((await rig.read(id, 50, 1))[0], second,
          'ACTION did not apply most recent staged value');
        assert.equal((await rig.read(id, 64, 1))[0], 0);
        await rig.command(id, Instruction.REG_WRITE, [50]);
        assert.equal((await rig.read(id, 64, 1))[0], 1);
        await rig.command(id, Instruction.ACTION);
        assert.equal((await rig.read(id, 50, 1))[0], second,
          'short REG_WRITE unexpectedly changed the register');
        assert.equal((await rig.read(id, 64, 1))[0], 0);
      } catch (error) { operationError = error; }
      try {
        await rig.reset(id);
        const after = await rig.read(id, 0, 87);
        assert.deepEqual(persistentBytes(after), persistentBytes(before),
          'staged write changed persistent settings');
        assert.equal(after[50], 0);
        assert.equal(after[64], 0);
      } catch (cleanupError) {
        throw new CleanupError('staged-write cleanup failed', operationError, cleanupError);
      }
      if (operationError) throw operationError;
      return { exact: { latestStageWins: true, shortStageIgnored: true,
        pendingCleared: true, resetRestored: true } };
    },
  },
  {
    id: 'test_staged_write_discarded_by_reset', scope: 'device', risk: 'safe',
    stages: ['staged'],
    covers: { commands: ['REG_WRITE', 'SYSTEM_RESET'], registers: [50, 64],
      malformed: ['pending-stage-reset'] },
    async run({ rig, id }) {
      const before = await rig.read(id, 0, 87);
      assert.equal(before[40], 0, 'staged reset case requires torque off');
      assert.equal(before[55], 1, 'staged reset case requires locked persistence');
      let operationError;
      let pending;
      try {
        await rig.command(id, Instruction.REG_WRITE, [50, before[50] ^ 0x40]);
        pending = (await rig.read(id, 64, 1))[0];
        assert.equal(pending, 1, 'REG_WRITE did not stage pending value');
        assert.equal((await rig.read(id, 50, 1))[0], before[50],
          'staged value applied before ACTION');
      } catch (error) { operationError = error; }
      try {
        await rig.reset(id);
        const after = await rig.read(id, 0, 87);
        assert.equal(after[64], 0, 'reset left staged-write flag set');
        assert.equal(after[50], before[50], 'reset applied staged value');
        assert.deepEqual(persistentBytes(after), persistentBytes(before),
          'staged reset case changed persistent image');
        assert.equal(after[40], 0);
        assert.equal(after[55], 1);
      } catch (cleanupError) {
        throw new CleanupError('staged reset cleanup failed', operationError, cleanupError);
      }
      if (operationError) throw operationError;
      return { exact: { pendingWasSet: true, resetDiscardedStage: true,
        persistentSettingsRestored: true }, evidence: { pending } };
    },
  },
];
