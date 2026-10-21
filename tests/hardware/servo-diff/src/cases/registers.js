'use strict';

const assert = require('node:assert/strict');
const { Instruction, PacketEncoder } = require('../../../../../host/servo-driver');
const { CleanupError } = require('../errors');
const { persistentBytes } = require('../register-image');

const readableAddresses = Array.from({ length: 87 }, (_, address) => address);
const readOnlyAddresses = [0, 1, 2, 3,
  ...Array.from({ length: 22 }, (_, index) => index + 56)];

module.exports = [
  {
    id: 'test_every_register_byte_read', scope: 'device', risk: 'safe', stages: ['registers'],
    covers: { registers: '0..86', commands: ['READ'] },
    async run({ rig, id }) {
      const observations = [];
      for (const address of readableAddresses) {
        const data = await rig.read(id, address, 1);
        assert.equal(data.length, 1, `register ${address} not readable`);
        observations.push({ address, value: data[0] });
      }
      return { exact: { readableCount: observations.length }, evidence: { observations } };
    },
  },
  {
    id: 'test_read_only_register_permissions', scope: 'device', risk: 'safe', stages: ['registers'],
    covers: { registers: '0..3,56..77', commands: ['WRITE'] },
    async run({ rig, id }) {
      const observations = [];
      for (const address of readOnlyAddresses) {
        const before = (await rig.read(id, address, 1))[0];
        const firstProbe = before ^ 0xff;
        const secondProbe = before ^ 0x55;
        await rig.write(id, address, [firstProbe]);
        const firstRead = (await rig.read(id, address, 1))[0];
        await rig.write(id, address, [secondProbe]);
        const secondRead = (await rig.read(id, address, 1))[0];
        // Telemetry bytes may change independently; only two successive reads
        // tracking both distinct injected values prove a writable field.
        assert.ok(firstRead !== firstProbe || secondRead !== secondProbe,
          `read-only register ${address} tracked both writes`);
        observations.push({ address, before, firstProbe, firstRead, secondProbe, secondRead });
      }
      return { exact: { readOnlyCount: observations.length, writesIgnored: true },
        evidence: { observations } };
    },
  },
  {
    id: 'test_register_address_boundaries', scope: 'device', risk: 'safe', stages: ['registers'],
    covers: { registers: [0, 86, 87, 255], malformed: ['read-past-end', 'write-past-end'] },
    async run({ rig, id }) {
      const last = await rig.read(id, 86, 1);
      const clipped = await rig.exchange(`read-clipped:${id}:86:4`,
        PacketEncoder.frame(id, Instruction.READ, [86, 4]), {
          match: response => response.id === id && response.parameters.length === 1,
        });
      assert.deepEqual(clipped.parameters, last, 'read at 86 did not clip');
      const zeroLength = await rig.exchange(`read-zero-length:${id}`,
        PacketEncoder.frame(id, Instruction.READ, [0, 0]), {
          match: response => response.id === id && response.parameters.length === 87,
        });
      assert.equal(zeroLength.parameters.length, 87,
        'zero-length read from address 0 did not return full clipped register span');
      for (const address of [87, 255]) {
        assert.ok(await rig.expectSilence(`read-past-end:${id}:${address}`,
          PacketEncoder.frame(id, Instruction.READ, [address, 1]), id),
        `out-of-range read ${address} replied`);
        await rig.write(id, address, [0xa5]);
      }
      assert.deepEqual(await rig.read(id, 86, 1), last, 'out-of-range write changed register 86');
      return { exact: { readClipped: true, zeroLengthAtZeroReturnsFullSpan: true, outOfRangeReadSilent: true,
        outOfRangeWriteAcknowledged: true, lastRegisterUnchanged: true } };
    },
  },
  {
    id: 'test_zero_length_read_start_semantics', scope: 'device', risk: 'safe',
    stages: ['registers'],
    covers: { registers: [0, 1, 86], commands: ['READ'], malformed: ['zero-length-read'] },
    async run({ rig, id }) {
      const lengths = [];
      for (const [address, expectedLength] of [[0, 87], [1, 0], [86, 0]]) {
        const response = await rig.exchange(`read-zero:${id}:${address}`,
          PacketEncoder.frame(id, Instruction.READ, [address, 0]), {
            match: frame => frame.id === id && frame.parameters.length === expectedLength,
          });
        assert.equal(response.parameters.length, expectedLength,
          `zero-length READ at ${address} returned unexpected size`);
        lengths.push({ address, responseLength: response.parameters.length });
      }
      await rig.ping(id);
      return { exact: { zeroAtStartWrapsToFullSpan: true,
        zeroAtNonzeroStartReturnsEmpty: true, pingRecovered: true }, evidence: { lengths } };
    },
  },
  {
    id: 'test_write_permission_overlap_and_end_clip', scope: 'device', risk: 'safe',
    stages: ['registers'],
    covers: { registers: [54, 55, 56, 57, 85, 86], commands: ['WRITE', 'SYSTEM_RESET'],
      permissions: ['mixed-writable-read-only', 'end-clipped'] },
    async run({ rig, id }) {
      const before = await rig.read(id, 0, 87);
      assert.equal(before[40], 0, 'overlap test requires torque off');
      assert.equal(before[55], 1, 'overlap test requires locked persistence');
      const marker54 = before[54] ^ 1;
      const marker85 = before[85] ^ 1;
      const marker86 = before[86] ^ 1;
      let operationError;
      let evidence;
      try {
        await rig.write(id, 55, [2]);
        const attempts = [];
        for (const [low, high] of [[0xa5, 0x5a], [0x55, 0xaa]]) {
          await rig.write(id, 54, [marker54, 2, low, high]);
          const readback = await rig.read(id, 54, 4);
          assert.equal(readback[0], marker54);
          assert.equal(readback[1], 2);
          attempts.push({ injected: [low, high], observed: [...readback.subarray(2)] });
        }
        assert.ok(attempts.every(value =>
          value.injected.some((byte, index) => value.observed[index] !== byte)),
        'position telemetry followed injected read-only bytes');
        await rig.write(id, 85, [marker85, marker86, 0xa5]);
        assert.deepEqual([...await rig.read(id, 85, 2)], [marker85, marker86],
          'end-clipped WRITE did not update 85–86');
        evidence = { attempts, marker54, marker85, marker86 };
      } catch (error) { operationError = error; }
      try {
        await rig.reset(id);
        const after = await rig.read(id, 0, 87);
        assert.deepEqual(persistentBytes(after), persistentBytes(before),
          'overlap/end-clipped write changed persistent settings');
        assert.equal(after[40], 0);
        assert.equal(after[55], 1);
      } catch (cleanupError) {
        throw new CleanupError('overlap/end-clipped WRITE cleanup failed',
          operationError, cleanupError);
      }
      if (operationError) throw operationError;
      return { exact: { mixedPermissions: true, clippedAt86: true,
        persistentSettingsRestored: true }, evidence };
    },
  },
  {
    id: 'test_undocumented_ram_byte_value_edges', scope: 'device', risk: 'safe',
    stages: ['registers'],
    covers: { registers: [50, 51, 52, 53, 54, 55], commands: ['WRITE', 'READ', 'SYSTEM_RESET'],
      values: [0, 1, 127, 128, 254, 255] },
    async run({ rig, id }) {
      const before = await rig.read(id, 0, 87);
      assert.equal(before[40], 0, 'RAM edge case requires torque off');
      assert.equal(before[55], 1, 'RAM edge case requires persistence locked');
      const addresses = [50, 51, 52, 53, 54];
      const values = [0, 1, 127, 128, 254, 255];
      const observations = [];
      let operationError;
      try {
        await rig.write(id, 55, [2]);
        for (const address of addresses) {
          for (const value of values) {
            await rig.write(id, address, [value]);
            const observed = (await rig.read(id, address, 1))[0];
            assert.equal(observed, value, `RAM register ${address} did not retain ${value}`);
            observations.push({ address, value, observed });
          }
        }
        assert.equal((await rig.read(id, 40, 1))[0], 0, 'RAM edge writes enabled torque');
      } catch (error) { operationError = error; }
      try {
        await rig.reset(id);
        const after = await rig.read(id, 0, 87);
        assert.deepEqual(persistentBytes(after), persistentBytes(before),
          'RAM edge writes changed persistent settings');
        for (const address of addresses) assert.equal(after[address], before[address],
          `RAM register ${address} did not reset`);
        assert.equal(after[40], 0);
        assert.equal(after[55], 1);
      } catch (cleanupError) {
        throw new CleanupError('RAM value-edge cleanup failed', operationError, cleanupError);
      }
      if (operationError) throw operationError;
      return { exact: { testedWrites: observations.length,
        torqueStayedOff: true, resetRestored: true }, evidence: { observations } };
    },
  },
];
