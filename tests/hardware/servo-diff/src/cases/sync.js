'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { CleanupError } = require('../errors');
const { PacketEncoder, Instruction, BROADCAST_ID } = require('../../../../../host/servo-driver');
const { persistentBytes } = require('../register-image');

function replyOrder(result) { return [...result.responses.keys()]; }

module.exports = [
  {
    id: 'test_sync_read_duplicate_and_unlisted_ids', scope: 'pair', risk: 'safe', stages: ['sync'],
    covers: { commands: ['SYNC_READ'], malformed: ['duplicate-id', 'unlisted-ids'] },
    async run({ rig, ids }) {
      const observations = [];
      for (const order of [[ids[0], ids[0], ids[1]], [ids[1], ids[0], ids[0]]]) {
        const result = await rig.syncRead(order, 56, 2,
          { expectedIds: ids, timeoutMs: 300 });
        const expected = [...new Set(order)];
        assert.deepEqual(replyOrder(result), expected);
        observations.push({ order, replies: replyOrder(result) });
      }
      const unlisted = await rig.exchange('sync-read-unlisted',
        PacketEncoder.syncRead(Instruction.SYNC_READ, [250, 251], 56, 2), {
          kind: 'collect', expectedIds: ids, strict: false, timeoutMs: 75,
          match: response => ids.includes(response.id),
        });
      assert.equal(unlisted.responses.size, 0, 'unlisted servo replied to SYNC_READ');
      return { exact: { duplicateIdRepliesOnce: true,
        firstOccurrenceOrder: true, unlistedSilent: true }, evidence: { observations } };
    },
  },
  {
    id: 'test_sync_write_multi_entry_last_wins', scope: 'pair', risk: 'safe', stages: ['sync'],
    covers: { commands: ['SYNC_WRITE', 'SYSTEM_RESET'], registers: [50],
      malformed: ['duplicate-selected-entry'] },
    async run({ rig, ids }) {
      const before = new Map();
      for (const id of ids) {
        const snapshot = await rig.read(id, 0, 87);
        assert.equal(snapshot[40], 0, `servo ${id} torque must be off`);
        before.set(id, snapshot);
      }
      let operationError;
      try {
        const entries = [
          { id: ids[0], data: Buffer.from([0x21]) },
          { id: ids[1], data: Buffer.from([0x42]) },
          { id: ids[0], data: Buffer.from([0x63]) },
        ];
        await rig.exchange('sync-write-multi-entry',
          PacketEncoder.syncWrite(Instruction.SYNC_WRITE, 50, entries), { kind: 'send' });
        await delay(25);
        assert.equal((await rig.read(ids[0], 50, 1))[0], 0x63,
          'first servo did not use last selected entry');
        assert.equal((await rig.read(ids[1], 50, 1))[0], 0x42,
          'second servo did not use its entry');
      } catch (error) { operationError = error; }
      try {
        for (const id of ids) {
          await rig.reset(id);
          const after = await rig.read(id, 0, 87);
          assert.deepEqual(persistentBytes(after), persistentBytes(before.get(id)),
            `servo ${id} persistent settings changed`);
          assert.equal(after[50], 0);
        }
      } catch (cleanupError) {
        throw new CleanupError('multi-entry SYNC_WRITE cleanup failed', operationError, cleanupError);
      }
      if (operationError) throw operationError;
      return { exact: { selectedBoth: true, lastDuplicateWins: true,
        resetRestored: true } };
    },
  },
  {
    id: 'test_sync_write_selected_id_multibyte_isolation', scope: 'pair', risk: 'safe',
    stages: ['sync'],
    covers: { commands: ['SYNC_WRITE', 'SYSTEM_RESET'], registers: [50, 51, 52, 53, 54, 55],
      malformed: ['unlisted-id'] },
    async run({ rig, ids }) {
      const before = new Map();
      for (const id of ids) {
        const snapshot = await rig.read(id, 0, 87);
        assert.equal(snapshot[40], 0, `servo ${id} torque must be off`);
        assert.equal(snapshot[55], 1, `servo ${id} persistence must be locked`);
        before.set(id, snapshot);
      }
      const observations = [];
      let operationError;
      try {
        for (const id of ids) await rig.write(id, 55, [2]);
        for (const selected of ids) {
          const other = ids.find(id => id !== selected);
          const marker = Buffer.from([0x01, 0x7f, 0x80, 0xfe, 0x55]);
          const packet = PacketEncoder.syncWrite(Instruction.SYNC_WRITE, 50, [
            { id: 250, data: Buffer.alloc(5, 0xa5) },
            { id: selected, data: marker },
          ]);
          const result = await rig.exchange(`sync-write-selected:${selected}`, packet, {
            kind: 'collect', expectedIds: ids, strict: false, timeoutMs: 75,
            match: response => ids.includes(response.id),
          });
          assert.equal(result.responses.size, 0, 'SYNC_WRITE received a response');
          assert.deepEqual(await rig.read(selected, 50, 5), marker,
            `selected servo ${selected} did not apply all five bytes`);
          assert.deepEqual(await rig.read(other, 50, 5), before.get(other).subarray(50, 55),
            `unselected servo ${other} changed`);
          observations.push({ selected, unselected: other, values: [...marker] });
          await rig.write(selected, 50, [...before.get(selected).subarray(50, 55)]);
        }
      } catch (error) { operationError = error; }
      try {
        for (const id of ids) {
          await rig.reset(id);
          const after = await rig.read(id, 0, 87);
          assert.deepEqual(persistentBytes(after), persistentBytes(before.get(id)),
            `servo ${id} persistent settings changed`);
          assert.deepEqual(after.subarray(50, 55), before.get(id).subarray(50, 55));
          assert.equal(after[40], 0);
          assert.equal(after[55], 1);
        }
      } catch (cleanupError) {
        throw new CleanupError('selected SYNC_WRITE cleanup failed', operationError, cleanupError);
      }
      if (operationError) throw operationError;
      return { exact: { bothDirectionsSelected: true, fiveBytesApplied: true,
        unlistedAndUnselectedIgnored: true, silent: true, resetRestored: true },
      evidence: { observations } };
    },
  },
  {
    id: 'test_sync_read_interleaved_unknown_ids', scope: 'pair', risk: 'safe',
    stages: ['sync'],
    covers: { commands: ['SYNC_READ'], malformed: ['interleaved-unlisted-ids'] },
    async run({ rig, ids }) {
      const orders = [[250, ids[0], 251, ids[1]], [251, ids[1], 250, ids[0]]];
      const observations = [];
      for (const order of orders) {
        const result = await rig.syncRead(order, 56, 2, {
          expectedIds: ids, timeoutMs: 350,
        });
        const expected = order.filter(id => ids.includes(id));
        assert.deepEqual(replyOrder(result), expected,
          'interleaved unknown IDs changed SYNC_READ reply order');
        for (const id of ids) assert.equal(result.responses.get(id)?.parameters.length, 2);
        observations.push({ order, replies: replyOrder(result) });
      }
      return { exact: { listedRepliesInOrder: true, unknownIdsSilent: true },
        evidence: { observations } };
    },
  },
  {
    id: 'test_sync_write_partial_selected_entry', scope: 'pair', risk: 'safe',
    stages: ['sync', 'malformed'],
    covers: { commands: ['SYNC_WRITE', 'SYSTEM_RESET'], registers: [50, 51, 55],
      malformed: ['short-sync-header', 'partial-selected-entry'] },
    async run({ rig, ids }) {
      const before = new Map();
      for (const id of ids) {
        const snapshot = await rig.read(id, 0, 87);
        assert.equal(snapshot[40], 0, `servo ${id} torque must be off`);
        assert.equal(snapshot[55], 1, `servo ${id} persistence must be locked`);
        before.set(id, snapshot);
      }
      const observations = [];
      let operationError;
      try {
        for (const id of ids) await rig.write(id, 55, [2]);
        for (const selected of ids) {
          const other = ids.find(id => id !== selected);
          const marker = before.get(selected)[50] ^ 0x35;
          for (const parameters of [[], [50], [50, 2], [50, 2, selected],
            [50, 2, selected, marker]]) {
            const result = await rig.exchange(`short-sync:${selected}:${parameters.length}`,
              PacketEncoder.frame(BROADCAST_ID, Instruction.SYNC_WRITE, parameters), {
                kind: 'collect', expectedIds: ids, strict: false, timeoutMs: 65,
                match: response => ids.includes(response.id),
              });
            assert.equal(result.responses.size, 0, 'SYNC_WRITE received a response');
            const selectedValue = await rig.read(selected, 50, 2);
            const otherValue = await rig.read(other, 50, 2);
            const expected = parameters.length === 4 ? marker : before.get(selected)[50];
            assert.equal(selectedValue[0], expected,
              `selected byte 50 after ${parameters.length}-parameter SYNC_WRITE`);
            assert.equal(selectedValue[1], before.get(selected)[51],
              'partial SYNC_WRITE unexpectedly changed byte 51');
            assert.deepEqual(otherValue, before.get(other).subarray(50, 52),
              'unselected servo changed after partial SYNC_WRITE');
            observations.push({ selected, parameterCount: parameters.length,
              selectedBytes: [...selectedValue], otherBytes: [...otherValue] });
          }
          await rig.write(selected, 50, [before.get(selected)[50]]);
        }
        await rig.health(ids);
      } catch (error) { operationError = error; }
      try {
        for (const id of ids) {
          await rig.reset(id);
          const after = await rig.read(id, 0, 87);
          assert.deepEqual(persistentBytes(after), persistentBytes(before.get(id)),
            `servo ${id} persistent settings changed`);
          assert.deepEqual(after.subarray(50, 52), before.get(id).subarray(50, 52));
          assert.equal(after[40], 0);
          assert.equal(after[55], 1);
        }
      } catch (cleanupError) {
        throw new CleanupError('partial SYNC_WRITE cleanup failed', operationError, cleanupError);
      }
      if (operationError) throw operationError;
      return { exact: { shortHeadersIgnored: true, partialEntryAppliedOneByte: true,
        unselectedUnchanged: true, resetRestored: true }, evidence: { observations } };
    },
  },
  {
    id: 'test_sync_read_lengths_and_order', scope: 'pair', risk: 'safe', stages: ['sync'],
    covers: { commands: ['SYNC_READ'], registers: '0..86' },
    async run({ rig, ids }) {
      const lengths = [1, 2, 17, 64, 87];
      const observations = [];
      for (const length of lengths) {
        for (const order of [ids, [...ids].reverse()]) {
          const result = await rig.syncRead(order, 0, length);
          assert.deepEqual(replyOrder(result), order, `reply order at ${length} bytes`);
          for (const id of order) {
            assert.equal(result.responses.get(id)?.parameters.length, length);
          }
          observations.push({ length, order, replies: replyOrder(result) });
        }
      }
      return { exact: { lengths, ordersMatched: true }, evidence: { observations } };
    },
  },
  {
    id: 'test_sync_read_parameter_limit', scope: 'pair', risk: 'safe', stages: ['sync'],
    covers: { commands: ['SYNC_READ'], malformed: ['128-vs-129-parameters'] },
    async run({ rig, ids }) {
      const acceptedIds = [...ids, ...Array(124).fill(7)];
      const accepted = await rig.syncRead(acceptedIds, 0, 1, { expectedIds: ids, timeoutMs: 300 });
      assert.deepEqual(replyOrder(accepted), ids, '128-parameter SYNC_READ should return both IDs');
      const rejectedIds = [...acceptedIds, 7];
      const rejected = await rig.syncRead(rejectedIds, 0, 1, {
        expectedIds: ids, strict: false, timeoutMs: 80,
      });
      assert.equal(rejected.responses.size, 0, '129-parameter SYNC_READ should be rejected');
      await rig.health(ids);
      return { exact: { acceptedReplies: ids.length, rejectedReplies: 0, recovered: true } };
    },
  },
  {
    id: 'test_sync_read_register_bounds', scope: 'pair', risk: 'safe', stages: ['sync'],
    covers: { commands: ['SYNC_READ'], malformed: ['zero-length', 'end-clipping', 'past-end'] },
    async run({ rig, ids }) {
      const clipped = await rig.syncRead(ids, 86, 4, { replyLength: 1 });
      assert.deepEqual(replyOrder(clipped), ids, 'clipped SYNC_READ reply order');
      const zero = await rig.syncRead(ids, 0, 0, { replyLength: 87, timeoutMs: 300 });
      assert.deepEqual(replyOrder(zero), ids, 'zero-length SYNC_READ reply order');
      for (const id of ids) {
        assert.equal(clipped.responses.get(id).parameters.length, 1);
        assert.equal(zero.responses.get(id).parameters.length, 87);
      }
      const pastEnd = await rig.syncRead(ids, 87, 1,
        { expectedIds: ids, strict: false, timeoutMs: 80 });
      assert.equal(pastEnd.responses.size, 0, 'past-end SYNC_READ received reply');
      await rig.health(ids);
      return { exact: { clippedToOne: true, zeroLengthReadsAll: true,
        pastEndSilent: true, recovered: true },
      evidence: { clippedOrder: replyOrder(clipped), zeroOrder: replyOrder(zero) } };
    },
  },
  {
    id: 'test_sync_read_zero_length_nonzero_start', scope: 'pair', risk: 'safe', stages: ['sync'],
    covers: { commands: ['SYNC_READ'], registers: [1, 86], malformed: ['zero-length-nonzero-start'] },
    async run({ rig, ids }) {
      const observations = [];
      for (const start of [1, 86]) {
        for (const order of [ids, [...ids].reverse()]) {
          const result = await rig.syncRead(order, start, 0,
            { replyLength: 0, timeoutMs: 300 });
          assert.deepEqual(replyOrder(result), order,
            `zero-length SYNC_READ reply order at ${start}`);
          for (const id of ids) assert.equal(result.responses.get(id)?.parameters.length, 0);
          observations.push({ start, order, replies: replyOrder(result) });
        }
      }
      return { exact: { emptyRepliesAtNonzeroStart: true, orderPreserved: true },
        evidence: { observations } };
    },
  },
  {
    id: 'test_sync_write_data_limit', scope: 'device', risk: 'safe', stages: ['sync'],
    covers: { commands: ['SYNC_WRITE'], registers: ['accelerationCoefficient'] },
    async run({ rig, id }) {
      const original = (await rig.read(id, 86, 1))[0];
      const originalLock = (await rig.read(id, 55, 1))[0];
      const changed = original === 254 ? 253 : original + 1;
      let bodyError;
      try {
        await rig.write(id, 55, [2]);
        await rig.syncWrite(86, 125, id, [changed, ...Array(124).fill(0)]);
        await delay(25);
        assert.equal((await rig.read(id, 86, 1))[0], changed,
          '125-byte selected SYNC_WRITE did not clip and apply register 86');
        await rig.syncWrite(86, 126, id, [original, ...Array(125).fill(0)]);
        await delay(25);
        assert.equal((await rig.read(id, 86, 1))[0], changed,
          '126-byte SYNC_WRITE should be rejected by parser');
        await rig.health([id]);
      } catch (error) {
        bodyError = error;
      } finally {
        try {
          await rig.write(id, 86, [original]);
          await rig.write(id, 55, [originalLock]);
          assert.equal((await rig.read(id, 86, 1))[0], original, 'register 86 cleanup failed');
        } catch (cleanupError) {
          throw new CleanupError('SYNC_WRITE cleanup failed', bodyError, cleanupError);
        }
      }
      if (bodyError) throw bodyError;
      return { exact: { width125Applied: true, width126Rejected: true, restored: true } };
    },
  },
];
