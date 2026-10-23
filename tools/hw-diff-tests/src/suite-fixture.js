'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { Instruction } = require('../../../host/servo-driver');
const { persistentBytes } = require('./register-image');

// Defined free-running suite stimulus, independent of the installed settings.
// Identity, baud, direction/topology bits, offsets and sensor limits are retained.
const baseline = new Map([
  [16, 232], [17, 3], // Maximum output 1000; individual cases use lower RAM caps.
  [21, 32], [22, 32], [23, 4], [24, 16], [25, 0], [26, 2], [27, 2],
  [30, 1], [33, 0],
  [34, 40], [35, 80], [36, 80], // Factory stall release, duration and onset.
  [37, 25], [38, 0], [39, 50],
  [80, 2], [81, 20], [82, 50], [83, 1], [84, 150], [85, 100], [86, 1],
]);
const writable = [...Array.from({ length: 36 }, (_, i) => i + 4),
  ...Array.from({ length: 9 }, (_, i) => i + 78)];

function suiteImage(before) {
  const image = Buffer.from(before);
  for (const [address, value] of baseline) image[address] = value;
  image[18] = (before[18] | 0x1c) & ~0x20; // Signed/direct units, zero-speed policy, current ADC.
  image[19] = before[19] | 0x2f; // Retain every original shutdown bit; add tested protections.
  if ((before[28] | before[29] << 8) <= 20) {
    image[28] = 100;
    image[29] = 0;
  }
  return image;
}

async function applyImage(rig, id, expected) {
  await rig.write(id, 40, [0]);
  await rig.write(id, 55, [0]);
  try {
    const live = await rig.read(id, 0, 87);
    for (let index = 0; index < writable.length;) {
      const address = writable[index++];
      if (live[address] === expected[address]) continue;
      // Never change the live bus identity or rate while recovering settings.
      assert.ok(address !== 5 && address !== 6, 'suite cannot restore changed bus identity/rate');
      const bytes = [expected[address]];
      while (index < writable.length && writable[index] === address + bytes.length &&
             writable[index] !== 5 && writable[index] !== 6 &&
             live[writable[index]] !== expected[writable[index]]) {
        bytes.push(expected[writable[index++]]);
      }
      await rig.write(id, address, bytes);
      await delay(60);
    }
  } finally {
    await rig.write(id, 55, [1]);
  }
  await rig.reset(id);
  const after = await rig.read(id, 0, 87);
  assert.deepEqual(persistentBytes(after), persistentBytes(expected),
    `servo ${id} suite persistent image mismatch`);
  assert.equal(after[40], 0, 'suite reset did not disable torque');
  assert.equal(after[55], 1, 'suite reset did not lock persistence');
  return after;
}

class SuiteFixture {
  constructor(rig, ids, saveSnapshots) {
    this.rig = rig;
    this.ids = ids;
    this.saveSnapshots = saveSnapshots;
    this.originals = new Map();

  }

  async prepare() {
    // Register snapshots are diagnostic evidence only; cleanup uses command 0x06.
    for (const id of this.ids) {
      const before = await this.rig.read(id, 0, 87);
      assert.equal(before[5], id, 'suite identity mismatch');
      assert.equal(before[6], 0, 'suite requires the connected bus at 1 Mbaud');
      assert.equal(before[40], 0, 'suite refuses an already powered servo');
      assert.equal(before[65], 0, 'suite refuses an existing alarm');
      this.originals.set(id, Buffer.from(before));
      this.rig.events.push({ label: `suite-original:${id}`, kind: 'evidence',
        registerBytes: before.toString('hex') });
    }
    await this.saveSnapshots?.();
    for (const [id, before] of this.originals) {
      const after = await applyImage(this.rig, id, suiteImage(before));
      this.rig.events.push({ label: `suite-prepared:${id}`, kind: 'evidence',
        registerBytes: after.toString('hex') });
    }
  }

  async restore() {
    const errors = [];
    for (const id of this.originals.keys()) {
      try {
        await this.rig.write(id, 40, [0]);
        await this.rig.command(id, Instruction.FACTORY_RESET);
        await delay(100);
        await this.rig.reset(id);
        const after = await this.rig.read(id, 0, 87);
        assert.equal(after[5], id, 'restore defaults changed servo ID');
        assert.equal(after[6], 0, 'restore defaults changed baud');
        assert.equal(after[40], 0, 'defaults cleanup left torque enabled');
        assert.equal(after[55], 1, 'defaults cleanup left persistence unlocked');
        this.rig.events.push({ label: `suite-defaults-restored:${id}`, kind: 'evidence',
          registerBytes: after.toString('hex'), command: 'FACTORY_RESET (0x06)' });
      } catch (error) { errors.push(`servo ${id}: ${error.message}`); }
    }
    if (errors.length) throw new Error(errors.join('; '));
  }

}

module.exports = { suiteImage, applyImage, SuiteFixture };
