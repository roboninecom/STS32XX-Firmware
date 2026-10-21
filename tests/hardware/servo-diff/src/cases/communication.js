'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { Instruction, PacketEncoder } = require('../../../../../host/servo-driver');
const { positionDelta } = require('../position');
const { CleanupError } = require('../errors');
const { persistentBytes } = require('../register-image');

function decodedPosition(bytes, signed) {
  const raw = bytes[0] | (bytes[1] << 8);
  return signed && (raw & 0x8000) ? -(raw & 0x7fff) : raw;
}

async function verifyAfterReset(rig, id, before) {
  const after = await rig.read(id, 0, 87);
  assert.deepEqual(persistentBytes(after), persistentBytes(before),
    'persistent settings changed during communication case');
  assert.equal(after[40], 0, 'torque remained enabled after reset');
  assert.equal(after[55], 1, 'persistence lock not restored after reset');
  return after;
}

module.exports = [
  {
    id: 'test_encoder_home_command', scope: 'device', risk: 'safe', stages: ['communication'],
    covers: { commands: ['ENCODER_HOME'], registers: [31, 32, 40, 56] },
    async run({ rig, id }) {
      const before = await rig.read(id, 0, 87);
      assert.equal(before[40], 0, 'torque must be off before encoder home');
      const signed = (before[18] & 0x10) !== 0;
      const priorPosition = decodedPosition(before.subarray(56, 58), signed);
      await rig.command(id, Instruction.ENCODER_HOME);
      await delay(30);
      const after = await rig.read(id, 0, 87);
      const currentPosition = decodedPosition(after.subarray(56, 58), signed);
      assert.deepEqual(persistentBytes(after), persistentBytes(before),
        'encoder home changed persistent registers');
      assert.equal(after[40], 0, 'encoder home did not leave torque off');
      assert.ok(Math.abs(positionDelta(currentPosition, priorPosition, signed)) <= 4,
        `encoder home shifted reported position ${priorPosition} -> ${currentPosition}`);
      return { exact: { acknowledged: true, offsetUnchanged: true,
        torqueOff: true, positionStable: true },
      evidence: { priorPosition, currentPosition } };
    },
  },
  {
    id: 'test_temporary_id_and_reset', scope: 'device', risk: 'safe', stages: ['communication'],
    covers: { commands: ['WRITE', 'PING', 'SYSTEM_RESET'], registers: [5, 55] },
    async run({ rig, id, ids }) {
      const temporaryId = id === ids[0] ? 250 : 251;
      const before = await rig.read(id, 0, 87);
      assert.equal(before[5], id, 'ID register does not match bus ID');
      assert.equal(before[40], 0, 'torque must be off before ID change');
      assert.ok(await rig.expectSilence(`unused-id:${temporaryId}`,
        PacketEncoder.frame(temporaryId, Instruction.PING), temporaryId),
      `temporary ID ${temporaryId} is already in use`);
      let mayHaveChanged = false;
      let resetCompleted = false;
      let operationError;
      try {
        mayHaveChanged = true;
        await rig.write(id, 55, [2]);
        await rig.write(id, 5, [temporaryId]);
        assert.equal((await rig.read(temporaryId, 5, 1))[0], temporaryId);
        assert.ok(await rig.expectSilence(`old-id-silent:${id}`,
          PacketEncoder.frame(id, Instruction.PING), id), 'old ID still replies');
        await rig.reset(temporaryId, id);
        await verifyAfterReset(rig, id, before);
        resetCompleted = true;
      } catch (error) { operationError = error; }
      if (!resetCompleted) {
        try {
          if (mayHaveChanged) {
            // The temporary address was verified free before mutation. Probe
            // both addresses because a timed-out WRITE may still have applied.
            const temporaryAlive = !await rig.expectSilence(`recover-temp:${temporaryId}`,
              PacketEncoder.frame(temporaryId, Instruction.PING), temporaryId);
            if (temporaryAlive) await rig.reset(temporaryId, id);
            else await rig.reset(id);
          }
          await verifyAfterReset(rig, id, before);
        } catch (cleanupError) {
          throw new CleanupError(`temporary ID ${temporaryId} recovery failed`,
            operationError, cleanupError);
        }
      }
      if (operationError) throw operationError;
      return { exact: { changedId: true, oldIdSilent: true,
        resetRestoredId: true, settingsUnchanged: true },
      evidence: { temporaryId } };
    },
  },
  {
    id: 'test_invalid_baud_index_clamp', scope: 'device', risk: 'safe', stages: ['communication'],
    covers: { commands: ['WRITE', 'READ', 'SYSTEM_RESET'], registers: [6, 55] },
    async run({ rig, id, config }) {
      const before = await rig.read(id, 0, 87);
      assert.equal(config.baudRate, 1_000_000, 'invalid-baud clamp case requires 1 Mbaud');
      assert.equal(before[6], 0, 'servo must start at baud index zero');
      assert.equal(before[40], 0, 'torque must be off before baud probe');
      let operationError;
      let clamped;
      try {
        await rig.write(id, 55, [2]);
        await rig.write(id, 6, [0xff]);
        await delay(30);
        clamped = (await rig.read(id, 6, 1))[0];
        assert.equal(clamped, 0, 'invalid baud index did not clamp to zero');
      } catch (error) { operationError = error; }
      try {
        await rig.reset(id);
        await verifyAfterReset(rig, id, before);
      } catch (cleanupError) {
        throw new CleanupError('invalid-baud recovery failed', operationError, cleanupError);
      }
      if (operationError) throw operationError;
      return { exact: { clampedToZero: true, oneMbaudRecovered: true,
        settingsUnchanged: true }, evidence: { written: 255, clamped } };
    },
  },
];
