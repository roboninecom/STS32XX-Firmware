'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { Instruction, PacketEncoder, BROADCAST_ID } = require('../../../../host/servo-driver');
const { CleanupError } = require('../errors');
const { persistentBytes } = require('../register-image');

module.exports = [
  {
    id: 'test_broadcast_ping_and_idle_action', scope: 'pair', risk: 'safe', stages: ['commands'],
    covers: { commands: ['PING', 'ACTION'], malformed: ['broadcast-response-policy'] },
    async run({ rig, ids }) {
      for (const id of ids) assert.equal((await rig.read(id, 64, 1))[0], 0,
        `device ${id} has a pending staged write`);
      const replies = await rig.exchange('broadcast-ping',
        PacketEncoder.frame(BROADCAST_ID, Instruction.PING), {
          kind: 'collect', expectedIds: ids, timeoutMs: 350,
          match: response => ids.includes(response.id) && response.parameters.length === 0,
        });
      assert.deepEqual([...replies.responses.keys()].sort(), [...ids].sort());
      await rig.exchange('broadcast-idle-action',
        PacketEncoder.frame(BROADCAST_ID, Instruction.ACTION), { kind: 'send' });
      for (const id of ids) assert.equal((await rig.read(id, 64, 1))[0], 0);
      return { exact: { broadcastPingReplies: 2, idleActionSilent: true,
        pendingUnchanged: true } };
    },
  },
  {
    id: 'test_broadcast_ram_write_no_reply', scope: 'pair', risk: 'safe', stages: ['commands'],
    covers: { commands: ['WRITE', 'SYSTEM_RESET'], registers: [50, 55],
      malformed: ['broadcast-response-policy'] },
    async run({ rig, ids }) {
      const before = new Map();
      for (const id of ids) {
        const snapshot = await rig.read(id, 0, 87);
        assert.equal(snapshot[40], 0, `servo ${id} torque must be off`);
        assert.equal(snapshot[55], 1, `servo ${id} persistence must be locked`);
        before.set(id, snapshot);
      }
      let operationError;
      const marker = 0x5a;
      try {
        for (const id of ids) await rig.write(id, 55, [2]);
        const packet = PacketEncoder.frame(BROADCAST_ID, Instruction.WRITE, [50, marker]);
        const silent = await rig.exchange('broadcast-ram-write', packet, {
          kind: 'collect', expectedIds: ids, strict: false, timeoutMs: 75,
          match: response => ids.includes(response.id),
        });
        assert.equal(silent.responses.size, 0, 'broadcast WRITE received a status response');
        for (const id of ids) assert.equal((await rig.read(id, 50, 1))[0], marker,
          `servo ${id} did not apply broadcast WRITE`);
      } catch (error) { operationError = error; }
      try {
        for (const id of ids) {
          await rig.reset(id);
          const after = await rig.read(id, 0, 87);
          const original = before.get(id);
          assert.deepEqual(persistentBytes(after), persistentBytes(original),
            `servo ${id} persistent settings changed`);
          assert.equal(after[50], original[50]);
          assert.equal(after[40], 0);
          assert.equal(after[55], 1);
        }
      } catch (cleanupError) {
        throw new CleanupError('broadcast RAM WRITE cleanup failed', operationError, cleanupError);
      }
      if (operationError) throw operationError;
      return { exact: { broadcastSilent: true, bothApplied: true,
        resetRestored: true }, evidence: { marker } };
    },
  },
  {
    id: 'test_broadcast_action_applies_distinct_staged_writes', scope: 'pair',
    risk: 'safe', stages: ['commands'],
    covers: { commands: ['REG_WRITE', 'ACTION', 'SYSTEM_RESET'], registers: [50, 55, 64],
      malformed: ['broadcast-response-policy'] },
    async run({ rig, ids }) {
      const before = new Map();
      for (const id of ids) {
        const snapshot = await rig.read(id, 0, 87);
        assert.equal(snapshot[40], 0, `servo ${id} torque must be off`);
        assert.equal(snapshot[55], 1, `servo ${id} persistence must be locked`);
        assert.equal(snapshot[64], 0, `servo ${id} has a pending staged write`);
        before.set(id, snapshot);
      }
      const markers = new Map([[ids[0], 0x21], [ids[1], 0x42]]);
      let operationError;
      try {
        for (const id of ids) {
          await rig.write(id, 55, [2]);
          await rig.command(id, Instruction.REG_WRITE, [50, markers.get(id)]);
          assert.equal((await rig.read(id, 64, 1))[0], 1);
          assert.equal((await rig.read(id, 50, 1))[0], before.get(id)[50]);
        }
        const action = await rig.exchange('broadcast-staged-action',
          PacketEncoder.frame(BROADCAST_ID, Instruction.ACTION), {
            kind: 'collect', expectedIds: ids, strict: false, timeoutMs: 75,
            match: response => ids.includes(response.id),
          });
        assert.equal(action.responses.size, 0, 'broadcast ACTION received a response');
        for (const id of ids) {
          assert.equal((await rig.read(id, 50, 1))[0], markers.get(id));
          assert.equal((await rig.read(id, 64, 1))[0], 0);
        }
      } catch (error) { operationError = error; }
      try {
        for (const id of ids) {
          await rig.reset(id);
          const after = await rig.read(id, 0, 87);
          assert.deepEqual(persistentBytes(after), persistentBytes(before.get(id)),
            `servo ${id} persistent settings changed`);
          assert.equal(after[50], before.get(id)[50]);
          assert.equal(after[64], 0);
          assert.equal(after[40], 0);
          assert.equal(after[55], 1);
        }
      } catch (cleanupError) {
        throw new CleanupError('broadcast ACTION cleanup failed', operationError, cleanupError);
      }
      if (operationError) throw operationError;
      return { exact: { distinctStagesApplied: true, broadcastSilent: true,
        pendingCleared: true, resetRestored: true },
      evidence: { markers: Object.fromEntries(markers) } };
    },
  },
  {
    id: 'test_unknown_instruction_status', scope: 'device', risk: 'safe', stages: ['commands'],
    covers: { commands: ['unknown 0x7f'] },
    async run({ rig, id }) {
      const response = await rig.command(id, 0x7f);
      assert.equal(response.parameters.length, 0);
      return { exact: { acknowledged: true }, evidence: { status: response.error } };
    },
  },
  {
    id: 'test_command_argument_counts', scope: 'device', risk: 'safe', stages: ['commands'],
    covers: { commands: ['PING', 'READ', 'WRITE', 'POSITION_CALIBRATE'], malformed: ['argument-count'] },
    async run({ rig, id }) {
      const before = await rig.read(id, 41, 1);
      const observations = [];
      const ping = await rig.command(id, Instruction.PING, [0x55]);
      assert.equal(ping.parameters.length, 0);
      observations.push({ instruction: 'PING', form: 'extra-argument', response: true });
      for (const params of [[], [41], [41, 1, 0]]) {
        const silent = await rig.expectSilence(`read-args:${params.length}`,
          PacketEncoder.frame(id, Instruction.READ, params), id);
        assert.ok(silent, `READ with ${params.length} arguments replied`);
        observations.push({ instruction: 'READ', count: params.length, silent });
      }
      const write = await rig.command(id, Instruction.WRITE);
      assert.equal(write.parameters.length, 0);
      assert.deepEqual(await rig.read(id, 41, 1), before);
      observations.push({ instruction: 'WRITE', form: 'no-arguments', acknowledged: true, unchanged: true });
      // A one-byte calibration argument is ignored by the dispatcher. Position
      // is deliberately not calibrated in this low-risk command case.
      const offsetBefore = await rig.read(id, 31, 2);
      await rig.command(id, Instruction.POSITION_CALIBRATE, [0]);
      assert.deepEqual(await rig.read(id, 31, 2), offsetBefore);
      observations.push({ instruction: 'POSITION_CALIBRATE', count: 1, offsetUnchanged: true });
      return { exact: { pingExtraAccepted: true, malformedReadSilent: true,
        emptyWriteUnchanged: true, shortCalibrationIgnored: true }, evidence: { observations } };
    },
  },
  {
    id: 'test_staged_write_action', scope: 'device', risk: 'safe', stages: ['commands'],
    covers: { commands: ['REG_WRITE', 'ACTION'], registers: [41, 64] },
    async run({ rig, id }) {
      const original = (await rig.read(id, 41, 1))[0];
      const beforePending = (await rig.read(id, 64, 1))[0];
      let operationError;
      try {
        // Stage an idempotent write: this proves command staging without motion
        // or persistence and leaves the original acceleration byte unchanged.
        await rig.command(id, Instruction.REG_WRITE, [41, original]);
        assert.equal((await rig.read(id, 64, 1))[0], 1);
        assert.equal((await rig.read(id, 41, 1))[0], original);
        await rig.command(id, Instruction.ACTION);
        assert.equal((await rig.read(id, 64, 1))[0], 0);
        assert.equal((await rig.read(id, 41, 1))[0], original);
        await rig.command(id, Instruction.ACTION);
        assert.equal((await rig.read(id, 64, 1))[0], 0);
      } catch (error) { operationError = error; }
      finally {
        try {
          if ((await rig.read(id, 64, 1))[0] !== 0) await rig.command(id, Instruction.ACTION);
          assert.equal((await rig.read(id, 64, 1))[0], 0);
          assert.equal((await rig.read(id, 41, 1))[0], original);
        } catch (cleanupError) {
          throw new CleanupError('staged write cleanup failed', operationError, cleanupError);
        }
      }
      if (operationError) throw operationError;
      return { exact: { pendingSet: true, actionApplied: true, secondActionNoOp: true },
        evidence: { initialPending: beforePending } };
    },
  },
  {
    id: 'test_status_return_level_zero', scope: 'device', risk: 'safe', stages: ['commands'],
    covers: { commands: ['PING', 'READ', 'WRITE'], registers: [8, 55] },
    async run({ rig, id }) {
      const originalLevel = (await rig.read(id, 8, 1))[0];
      const originalLock = (await rig.read(id, 55, 1))[0];
      let operationError;
      try {
        // The current return level acknowledges this write. Consume its reply
        // before issuing the next READ, or a late status frame can split it.
        await rig.write(id, 55, [2]);
        assert.equal((await rig.read(id, 55, 1))[0], 2);
        await rig.exchange(`set-return-level-zero:${id}`,
          PacketEncoder.frame(id, Instruction.WRITE, [8, 0]), { kind: 'send' });
        assert.equal((await rig.read(id, 8, 1))[0], 0,
          'READ should reply even with status return level zero');
        await rig.ping(id);
        const acceleration = (await rig.read(id, 41, 1))[0];
        assert.ok(await rig.expectSilence(`write-status-zero:${id}`,
          PacketEncoder.frame(id, Instruction.WRITE, [41, acceleration]), id),
        'WRITE replied with status return level zero');
      } catch (error) { operationError = error; }
      finally {
        try {
          // Return level zero suppresses WRITE acknowledgement, but READ and
          // PING remain available to verify recovery.
          await rig.exchange(`restore-return-level:${id}`,
            PacketEncoder.frame(id, Instruction.WRITE, [8, originalLevel]), { kind: 'send' });
          // A return-level transition can leave one immediate READ without a
          // reply. Always attempt the lock restoration before verification.
          await delay(20);
          await rig.exchange(`restore-lock:${id}`,
            PacketEncoder.frame(id, Instruction.WRITE, [55, originalLock]), { kind: 'send' });
          await delay(20);
          let restored = false;
          for (let attempt = 0; attempt < 3 && !restored; attempt++) {
            try {
              restored = (await rig.read(id, 8, 1))[0] === originalLevel &&
                (await rig.read(id, 55, 1))[0] === originalLock;
            } catch (error) {
              if (attempt === 2) throw error;
              await delay(35);
            }
          }
          assert.ok(restored, 'return level or persistence lock not restored');
        } catch (cleanupError) {
          throw new CleanupError('status-return-level cleanup failed', operationError, cleanupError);
        }
      }
      if (operationError) throw operationError;
      return { exact: { pingAndReadRespond: true, writeSilent: true, restored: true } };
    },
  },
];
