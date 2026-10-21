'use strict';

const assert = require('node:assert/strict');
const { Instruction, PacketEncoder, BROADCAST_ID } = require('../../../../../host/servo-driver');
const { CleanupError } = require('../errors');
const { persistentBytes } = require('../register-image');

module.exports = [
  {
    id: 'test_malformed_packet_recovery', scope: 'device', risk: 'safe', stages: ['malformed'],
    covers: { malformed: ['bad-checksum', 'bad-write-checksum', 'missing-write-checksum',
      'length-0', 'length-1',
      '128-vs-129-parameters', 'noise-prefix'] },
    async run({ rig, id }) {
      const valid = PacketEncoder.frame(id, Instruction.PING);
      const badChecksum = Buffer.from(valid);
      badChecksum[badChecksum.length - 1] ^= 0x80;
      const before = (await rig.read(id, 41, 1))[0];
      const badWrite = PacketEncoder.frame(id, Instruction.WRITE, [41, before ^ 0xff]);
      badWrite[badWrite.length - 1] ^= 0x01;
      const incompleteWrite = PacketEncoder.frame(id, Instruction.WRITE, [41, before ^ 0xff]);
      const oversized = PacketEncoder.frame(id, Instruction.PING, Buffer.alloc(129, 0));
      const frames = [
        ['bad-checksum', badChecksum],
        ['bad-write-checksum', badWrite],
        ['missing-write-checksum', incompleteWrite.subarray(0, -1)],
        ['length-0', Buffer.from([0xff, 0xff, id, 0, Instruction.PING, 0])],
        ['length-1', Buffer.from([0xff, 0xff, id, 1, Instruction.PING, 0])],
        ['oversized-parameters', oversized],
      ];
      for (const [label, bytes] of frames) {
        assert.ok(await rig.expectSilence(`malformed:${label}:${id}`, bytes, id), `${label} received reply`);
        await rig.ping(id);
      }
      assert.equal((await rig.read(id, 41, 1))[0], before,
        'bad-checksum WRITE changed a control byte');
      const accepted = await rig.command(id, Instruction.PING, Buffer.alloc(128, 0));
      assert.equal(accepted.parameters.length, 0);
      // Noise is allowed before a complete valid frame; parser must resync.
      const response = await rig.exchange(`noise-prefix:${id}`,
        Buffer.concat([Buffer.from([0x12, 0xff, 0x00, 0x34]), valid]), {
          match: packet => packet.id === id && packet.parameters.length === 0,
        });
      assert.equal(response.id, id);
      return { exact: { rejected: frames.map(([label]) => label),
        maxOrdinaryParametersAccepted: 128, badWriteIgnored: true,
        recovered: true, noiseResynchronized: true } };
    },
  },
  {
    id: 'test_unrelated_id_silence', scope: 'pair', risk: 'safe', stages: ['malformed'],
    covers: { malformed: ['unrelated-id'] },
    async run({ rig, ids }) {
      const unusedId = [253, 252, 251].find(id => !ids.includes(id));
      assert.ok(await rig.expectSilence(`unrelated-id:${unusedId}`,
        PacketEncoder.frame(unusedId, Instruction.PING), unusedId), 'unexpected third servo response');
      await rig.health(ids);
      return { exact: { unrelatedIdSilent: true, recovered: true }, evidence: { unusedId } };
    },
  },
  {
    id: 'test_header_pair_inside_write_payload', scope: 'device', risk: 'safe',
    stages: ['malformed'],
    covers: { malformed: ['embedded-header-in-payload'], commands: ['WRITE', 'PING', 'SYSTEM_RESET'],
      registers: [50, 51, 52] },
    async run({ rig, id }) {
      const before = await rig.read(id, 0, 87);
      assert.equal(before[40], 0, 'embedded-header case requires torque off');
      assert.equal(before[55], 1, 'embedded-header case requires persistence locked');
      let operationError;
      try {
        await rig.write(id, 55, [2]);
        const packet = PacketEncoder.frame(id, Instruction.WRITE,
          [50, before[50] ^ 1, 0xff, 0xff]);
        assert.ok(await rig.expectSilence(`embedded-header-write:${id}`, packet, id),
          'WRITE with embedded header pair was acknowledged');
        assert.deepEqual([...await rig.read(id, 50, 3)], [...before.subarray(50, 53)],
          'embedded-header WRITE changed RAM bytes');
        await rig.ping(id);
      } catch (error) { operationError = error; }
      try {
        await rig.reset(id);
        const after = await rig.read(id, 0, 87);
        assert.deepEqual(persistentBytes(after), persistentBytes(before),
          'embedded-header probe changed persistent settings');
        assert.equal(after[40], 0);
        assert.equal(after[55], 1);
      } catch (cleanupError) {
        throw new CleanupError('embedded-header WRITE cleanup failed',
          operationError, cleanupError);
      }
      if (operationError) throw operationError;
      return { exact: { embeddedHeaderRejected: true, writeIgnored: true,
        pingRecovered: true, resetRestored: true } };
    },
  },
  {
    id: 'test_bad_checksum_broadcast_write_is_ignored', scope: 'pair', risk: 'safe',
    stages: ['malformed'],
    covers: { commands: ['WRITE', 'PING', 'SYSTEM_RESET'], registers: [50, 55],
      malformed: ['broadcast-bad-checksum'] },
    async run({ rig, ids }) {
      const before = new Map();
      for (const id of ids) {
        const snapshot = await rig.read(id, 0, 87);
        assert.equal(snapshot[40], 0, `servo ${id} torque must be off`);
        assert.equal(snapshot[55], 1, `servo ${id} persistence must be locked`);
        before.set(id, snapshot);
      }
      let operationError;
      try {
        for (const id of ids) await rig.write(id, 55, [2]);
        const packet = PacketEncoder.frame(BROADCAST_ID, Instruction.WRITE, [50, 0x5a]);
        packet[packet.length - 1] ^= 1;
        const result = await rig.exchange('bad-checksum-broadcast-write', packet, {
          kind: 'collect', expectedIds: ids, strict: false, timeoutMs: 75,
          match: response => ids.includes(response.id),
        });
        assert.equal(result.responses.size, 0, 'bad broadcast WRITE received a response');
        for (const id of ids) {
          assert.equal((await rig.read(id, 50, 1))[0], before.get(id)[50],
            `servo ${id} applied bad broadcast WRITE`);
          await rig.ping(id);
        }
      } catch (error) { operationError = error; }
      try {
        for (const id of ids) {
          await rig.reset(id);
          const after = await rig.read(id, 0, 87);
          assert.deepEqual(persistentBytes(after), persistentBytes(before.get(id)),
            `servo ${id} persistent settings changed`);
          assert.equal(after[50], before.get(id)[50]);
          assert.equal(after[40], 0);
          assert.equal(after[55], 1);
        }
      } catch (cleanupError) {
        throw new CleanupError('bad broadcast WRITE cleanup failed', operationError, cleanupError);
      }
      if (operationError) throw operationError;
      return { exact: { ignoredByBoth: true, communicationRecovered: true,
        resetRestored: true } };
    },
  },
  {
    id: 'test_bad_checksum_sync_write_is_ignored', scope: 'pair', risk: 'safe',
    stages: ['malformed', 'sync'],
    covers: { commands: ['SYNC_WRITE', 'PING', 'SYSTEM_RESET'], registers: [50, 55],
      malformed: ['sync-write-bad-checksum'] },
    async run({ rig, ids }) {
      const before = new Map();
      for (const id of ids) {
        const snapshot = await rig.read(id, 0, 87);
        assert.equal(snapshot[40], 0, `servo ${id} torque must be off`);
        assert.equal(snapshot[55], 1, `servo ${id} persistence must be locked`);
        before.set(id, snapshot);
      }
      let operationError;
      try {
        for (const id of ids) await rig.write(id, 55, [2]);
        const packet = PacketEncoder.syncWrite(Instruction.SYNC_WRITE, 50,
          ids.map(id => ({ id, data: Buffer.from([before.get(id)[50] ^ 0x5a]) })));
        packet[packet.length - 1] ^= 0x01;
        const result = await rig.exchange('bad-checksum-sync-write', packet, {
          kind: 'collect', expectedIds: ids, strict: false, timeoutMs: 75,
          match: response => ids.includes(response.id),
        });
        assert.equal(result.responses.size, 0, 'bad SYNC_WRITE received a response');
        for (const id of ids) {
          assert.equal((await rig.read(id, 50, 1))[0], before.get(id)[50],
            `servo ${id} applied bad SYNC_WRITE`);
          await rig.ping(id);
        }
      } catch (error) { operationError = error; }
      try {
        for (const id of ids) {
          await rig.reset(id);
          const after = await rig.read(id, 0, 87);
          assert.deepEqual(persistentBytes(after), persistentBytes(before.get(id)),
            `servo ${id} persistent settings changed`);
          assert.equal(after[50], before.get(id)[50]);
          assert.equal(after[40], 0);
          assert.equal(after[55], 1);
        }
      } catch (cleanupError) {
        throw new CleanupError('bad SYNC_WRITE cleanup failed', operationError, cleanupError);
      }
      if (operationError) throw operationError;
      return { exact: { ignoredByBoth: true, communicationRecovered: true,
        resetRestored: true } };
    },
  },
  {
    id: 'test_truncated_sync_write_recovery', scope: 'pair', risk: 'safe',
    stages: ['malformed', 'sync'],
    covers: { commands: ['SYNC_WRITE', 'PING', 'SYSTEM_RESET'], registers: [50, 55],
      malformed: ['sync-write-missing-checksum'] },
    async run({ rig, ids }) {
      const before = new Map();
      for (const id of ids) {
        const snapshot = await rig.read(id, 0, 87);
        assert.equal(snapshot[40], 0, `servo ${id} torque must be off`);
        assert.equal(snapshot[55], 1, `servo ${id} persistence must be locked`);
        before.set(id, snapshot);
      }
      let operationError;
      try {
        for (const id of ids) await rig.write(id, 55, [2]);
        const complete = PacketEncoder.syncWrite(Instruction.SYNC_WRITE, 50,
          ids.map(id => ({ id, data: Buffer.from([before.get(id)[50] ^ 0x69]) })));
        const partial = complete.subarray(0, -1);
        const result = await rig.exchange('truncated-sync-write', partial, {
          kind: 'collect', expectedIds: ids, strict: false, timeoutMs: 75,
          match: response => ids.includes(response.id),
        });
        assert.equal(result.responses.size, 0, 'truncated SYNC_WRITE received a response');
        for (const id of ids) {
          assert.equal((await rig.read(id, 50, 1))[0], before.get(id)[50],
            `servo ${id} applied truncated SYNC_WRITE`);
        }
        await rig.health(ids);
      } catch (error) { operationError = error; }
      try {
        for (const id of ids) {
          await rig.reset(id);
          const after = await rig.read(id, 0, 87);
          assert.deepEqual(persistentBytes(after), persistentBytes(before.get(id)),
            `servo ${id} persistent settings changed`);
          assert.equal(after[50], before.get(id)[50]);
          assert.equal(after[40], 0);
          assert.equal(after[55], 1);
        }
      } catch (cleanupError) {
        throw new CleanupError('truncated SYNC_WRITE cleanup failed', operationError, cleanupError);
      }
      if (operationError) throw operationError;
      return { exact: { noReply: true, ignoredByBoth: true,
        communicationRecovered: true, resetRestored: true } };
    },
  },
];
