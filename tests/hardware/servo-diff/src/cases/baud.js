'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { BAUD_RATES, BROADCAST_ID, Instruction, PacketEncoder } = require('../../../../../host/servo-driver');
const { CleanupError } = require('../errors');
const { persistentBytes } = require('../register-image');

async function broadcastBaud(rig, index, label) {
  await rig.exchange(label, PacketEncoder.frame(BROADCAST_ID, Instruction.WRITE, [6, index]),
    { kind: 'send' });
  await delay(80);
}

async function verifyBoth(rig, ids, expectedIndex) {
  const observations = [];
  for (const id of ids) {
    await rig.ping(id);
    const index = (await rig.read(id, 6, 1))[0];
    assert.equal(index, expectedIndex, `servo ${id} baud index`);
    observations.push({ id, index });
  }
  return observations;
}

async function recover(rig, ids, targetRate, before) {
  const errors = [];
  const reset = PacketEncoder.frame(BROADCAST_ID, Instruction.SYSTEM_RESET);
  for (const rate of [targetRate, 1_000_000]) {
    try {
      await rig.setHostBaud(rate);
      await rig.exchange(`baud-recovery-reset:${rate}`, reset, { kind: 'send' });
      await delay(1050);
    } catch (error) { errors.push(`${rate}: ${error.message}`); }
  }
  try {
    await rig.setHostBaud(1_000_000);
    await verifyBoth(rig, ids, 0);
    for (const id of ids) {
      const after = await rig.read(id, 0, 87);
      assert.deepEqual(persistentBytes(after), persistentBytes(before.get(id)),
        `servo ${id} settings changed during baud recovery`);
    }
  } catch (error) { errors.push(`final verification: ${error.message}`); }
  if (errors.length) throw new Error(errors.join('; '));
}

function baudCase(index) {
  const rate = BAUD_RATES[index];
  return {
    id: `test_supported_baud_index_${index}`, scope: 'pair', risk: 'safe', stages: ['baud'],
    covers: { commands: ['WRITE', 'PING', 'READ', 'SYSTEM_RESET'], registers: [6],
      baudIndex: index },
    async run({ rig, ids, config }) {
      assert.equal(config.baudRate, 1_000_000, 'baud sweep must begin at 1 Mbaud');
      const before = new Map();
      for (const id of ids) {
        const bytes = await rig.read(id, 0, 87);
        assert.equal(bytes[6], 0, `servo ${id} not at baud index zero`);
        assert.notEqual(bytes[55], 0, `servo ${id} persistence is unlocked`);
        assert.equal(bytes[40], 0, `servo ${id} torque must be off`);
        before.set(id, bytes);
      }
      let operationError;
      let atTarget;
      let atOriginal;
      try {
        await broadcastBaud(rig, index, `broadcast-baud-index:${index}`);
        await rig.setHostBaud(rate);
        atTarget = await verifyBoth(rig, ids, index);
        await broadcastBaud(rig, 0, 'broadcast-baud-index:0');
        await rig.setHostBaud(1_000_000);
        atOriginal = await verifyBoth(rig, ids, 0);
        for (const id of ids) {
          await rig.reset(id);
          const after = await rig.read(id, 0, 87);
          assert.deepEqual(persistentBytes(after), persistentBytes(before.get(id)),
            `servo ${id} settings changed during baud transition`);
          assert.equal(after[40], 0);
          assert.equal(after[55], 1);
        }
      } catch (error) { operationError = error; }
      if (operationError) {
        try { await recover(rig, ids, rate, before); }
        catch (cleanupError) {
          throw new CleanupError(`baud index ${index} recovery failed`, operationError, cleanupError);
        }
        throw operationError;
      }
      return { exact: { index, bothReachedTarget: true,
        bothRestoredOneMbaud: true, settingsUnchangedAfterReset: true },
      evidence: { rate, atTarget, atOriginal } };
    },
  };
}

module.exports = Array.from({ length: 7 }, (_, offset) => baudCase(offset + 1));

module.exports.push({
  id: 'test_sync_read_slot_timing_all_bauds', scope: 'pair', risk: 'safe',
  stages: ['baud', 'sync-timing'],
  covers: { commands: ['WRITE', 'PING', 'READ', 'SYNC_READ', 'SYSTEM_RESET'],
    registers: [6, 56, 72], baudIndex: [1, 2, 3, 4, 5, 6, 7],
    timing: ['paired-response-slot', 'reply-order', 'long-response'] },
  async run({ rig, ids, config }) {
    assert.equal(config.baudRate, 1_000_000, 'SYNC baud matrix must begin at 1 Mbaud');
    const before = new Map();
    for (const id of ids) {
      const bytes = await rig.read(id, 0, 87);
      assert.equal(bytes[6], 0);
      assert.equal(bytes[40], 0);
      assert.notEqual(bytes[55], 0);
      before.set(id, bytes);
    }
    const observations = [];
    let operationError;
    let activeRate = 1_000_000;
    try {
      for (let index = 1; index < BAUD_RATES.length; index++) {
        const rate = BAUD_RATES[index];
        await broadcastBaud(rig, index, `sync-timing-baud-index:${index}`);
        await rig.setHostBaud(rate);
        activeRate = rate;
        await verifyBoth(rig, ids, index);
        for (let repetition = 0; repetition < 3; repetition++) {
          for (const order of [ids, [...ids].reverse()]) {
            for (const length of [1, 17, 87]) {
              const result = await rig.syncRead(order, 0, length,
                { expectedIds: order, timeoutMs: 650 });
              assert.deepEqual([...result.responses.keys()], order,
                `SYNC_READ reply order at baud index ${index}`);
              const event = rig.events.at(-1);
              assert.equal(event.frames.length, 2,
                `SYNC_READ frame count at baud index ${index}`);
              assert.deepEqual(event.frames.map(frame => frame.id), order);
              const slotDeltaMs = event.frames[1].elapsedMs - event.frames[0].elapsedMs;
              assert.ok(slotDeltaMs > 0, `nonpositive response slot at baud index ${index}`);
              observations.push({ index, rate, repetition, order: [...order], length,
                firstFrameMs: event.frames[0].elapsedMs,
                secondFrameMs: event.frames[1].elapsedMs, slotDeltaMs });
            }
          }
        }
        await broadcastBaud(rig, 0, `sync-timing-baud-restore:${index}`);
        await rig.setHostBaud(1_000_000);
        activeRate = 1_000_000;
        await verifyBoth(rig, ids, 0);
      }
      for (const id of ids) {
        await rig.reset(id);
        const after = await rig.read(id, 0, 87);
        assert.deepEqual(persistentBytes(after), persistentBytes(before.get(id)));
        assert.equal(after[40], 0);
        assert.equal(after[55], 1);
      }
    } catch (error) { operationError = error; }
    if (operationError) {
      try { await recover(rig, ids, activeRate, before); }
      catch (cleanupError) {
        throw new CleanupError('SYNC_READ all-baud recovery failed', operationError, cleanupError);
      }
      throw operationError;
    }
    return { exact: { baudRates: BAUD_RATES.length - 1,
      exchanges: observations.length, allRepliesOrdered: true, settingsRestored: true },
    evidence: { observations } };
  },
});
