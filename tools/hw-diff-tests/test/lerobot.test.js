'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cases = require('../src/cases/lerobot');
const { decodeOffset } = require('../src/position');
const { persistentBytes } = require('../src/register-image');
const { CleanupError } = require('../src/errors');

// A stationary encoder plus durable register storage. Faults reproduce the
// observed failure externally, without importing the case's assertions.
class OffsetRig {
  constructor(fault) {
    this.fault = fault;
    this.events = [];
    this.calls = [];
    this.image = Buffer.alloc(87);
    this.image[5] = 5;
    this.image[18] = 0x10;
    this.image[55] = 1;
    this.image[62] = 125;
    this.image[63] = 35;
    this.image.writeUInt16LE(0x800 + 557, 31);
    this.publish();
    this.original = Buffer.from(this.image);
    this.storage = Buffer.from(this.image);
    this.resets = 0;
    this.offsetWrites = 0;
  }

  publish() {
    const position = 1367 - decodeOffset(this.image.readUInt16LE(31));
    this.image.writeUInt16LE(position < 0 ? -position | 0x8000 : position, 56);
  }

  response(address, length) {
    const parameters = Buffer.from(this.image.subarray(address, address + length));
    const active = this.resets === 0 && this.offsetWrites > 0;
    let error = 0;
    if (active && this.fault === 'header') error = 8;
    if (active && length === 87) {
      if (this.fault === 'voltage') parameters[62] = 0;
      if (this.fault === 'temperature') parameters[63] = 7;
      if (this.fault === 'temperature-spike' && !this.spiked) {
        parameters[63] = 45;
        this.spiked = true;
      }
      if (this.fault === 'current') parameters.writeUInt16LE(1021, 69);
      if (this.fault === 'status') parameters[65] = 1;
    }
    // An old sensor sample becomes visible only after the first immediate
    // read has already returned its stale coordinates.
    this.publish();
    return { id: 5, error, parameters };
  }

  async exchange(label, packet) {
    assert.equal(packet[4], 2);
    const address = packet[5], length = packet[6];
    this.calls.push(['read', address, length]);
    return this.response(address, length);
  }

  async syncRead(ids, address, length) {
    assert.deepEqual(ids, [5]);
    this.calls.push(['sync', address, length]);
    const response = this.response(address, length);
    if (this.resets === 0 && this.fault === 'sync-header') response.error = 8;
    return { responses: new Map([[5, response]]) };
  }

  async write(id, address, values) {
    assert.equal(id, 5);
    this.calls.push(['write', address, [...values]]);
    if (this.resets > 0 && this.fault === 'cleanup' && address === 31) {
      throw new Error('restoration transport failure');
    }
    if (address === 31) {
      assert.equal(this.image[55], 0, 'case must really enable durable writes');
      this.offsetWrites++;
    }
    this.image.set(values, address);
    if (address === 31) {
      this.storage.set(values, address);
      const raw = this.image.readUInt16LE(31);
      const stale = this.resets === 0 &&
        ((this.fault === 'stale-clear' && raw === 0) ||
         (this.fault === 'stale-home' && raw === (0x800 + 680)));
      if (!stale) this.publish();
    }
    const error = this.resets === 0 && address === 31 && this.fault === 'write-header' ? 1 : 0;
    return { id, error, parameters: Buffer.alloc(0) };
  }

  async reset(id) {
    assert.equal(id, 5);
    this.calls.push(['reset']);
    this.resets++;
    this.image = Buffer.from(this.storage);
    this.image[40] = 0;
    this.image[55] = 1;
    this.publish();
  }

  assertRestored() {
    assert.deepEqual(persistentBytes(this.image), persistentBytes(this.original));
    assert.equal(this.image[40], 0);
    assert.equal(this.image[55], 1);
    assert.equal(this.resets, 2);
  }
}

const stress = cases[0], homing = cases[1];
const run = (entry, rig) => entry.run({ rig, id: 5 });

test('LeRobot regressions are discovered, torque-off and persistence-gated', () => {
  const { loadCases } = require('../src/load-cases');
  assert.deepEqual(loadCases().filter(c => c.stages.includes('lerobot')).map(c => c.id),
    cases.map(c => c.id));
  assert.ok(cases.every(c => c.risk === 'safe' && c.requiresPersistenceWrite));
});

test('100 real offset changes check 3000 reads before resetting, then restore', async () => {
  const rig = new OffsetRig();
  const result = await run(stress, rig);
  assert.equal(result.exact.writes, 100);
  assert.equal(result.exact.telemetryReads, 3000);
  const exercise = rig.calls.slice(0, rig.calls.findIndex(c => c[0] === 'reset'));
  const writes = exercise.filter(c => c[0] === 'write' && c[1] === 31);
  assert.equal(writes.length, 100);
  for (let n = 1; n < writes.length; n++) assert.notDeepEqual(writes[n][2], writes[n - 1][2]);
  assert.equal(exercise.filter(c => c[0] === 'read' && c[2] === 87).length, 3001);
  rig.assertRestored();
});

for (const fault of ['header', 'write-header', 'voltage', 'temperature', 'current', 'status']) {
  test(`persistent acquisition detects ${fault} and still restores settings`, async () => {
    const rig = new OffsetRig(fault);
    await assert.rejects(run(stress, rig), assert.AssertionError);
    rig.assertRestored();
  });
}

test('20 homings cover individual and group reads immediately after each critical write', async () => {
  const rig = new OffsetRig();
  const result = await run(homing, rig);
  assert.equal(result.evidence.trials.length, 20);
  assert.equal(result.evidence.trials.filter(t => t.read === 'sync').length, 10);
  assert.ok(result.evidence.trials.every(t => t.clearedPosition === 1367 &&
    t.offset === -680 && t.immediatePosition === 2047));
  for (let n = 0; n < rig.calls.findIndex(c => c[0] === 'reset'); n++) {
    const c = rig.calls[n];
    if (c[0] !== 'write' || c[1] !== 31 || c[2][0] === 64) continue;
    const next = rig.calls[n + 1];
    assert.ok(['read', 'sync'].includes(next[0]));
    assert.deepEqual(next.slice(1), [56, 2]);
  }
  rig.assertRestored();
});

test('isolated factory temperature spike stays visible without masking alarm checks', async () => {
  const rig = new OffsetRig('temperature-spike');
  const result = await run(stress, rig);
  assert.equal(result.evidence.temperatureOutlierReads, 1);
  rig.assertRestored();
});

for (const fault of ['stale-clear', 'stale-home', 'sync-header']) {
  test(`immediate homing detects ${fault} and still restores settings`, async () => {
    const rig = new OffsetRig(fault);
    await assert.rejects(run(homing, rig), assert.AssertionError);
    rig.assertRestored();
  });
}

test('restoration failure is a hard-stop CleanupError', async () => {
  await assert.rejects(run(homing, new OffsetRig('cleanup')), CleanupError);
});

test('torque-enabled entry fails before any write or reset', async () => {
  const rig = new OffsetRig();
  rig.image[40] = 1;
  await assert.rejects(run(homing, rig), /requires torque off/);
  assert.deepEqual(rig.calls, [['read', 0, 87]]);
});
