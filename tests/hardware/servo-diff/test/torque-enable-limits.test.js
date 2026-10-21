'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const [entry] = require('../src/cases/torque_enable_limits');
const { persistentBytes } = require('../src/register-image');

function observation(deltas) {
  return { evidence: { trials: ['below-minimum', 'above-maximum', 'inside-limits',
    'limits-disabled-old-goal'].map((name, n) => ({ name,
    enableDelta: deltas[n], peakEnableDelta: Math.abs(deltas[n]), commandError: 0 })) } };
}

test('comparator detects both limit directions and old-goal replay', () => {
  const held = observation([0, 0, 0, 0]);
  const replay = observation([64, -64, 0, 96]);
  assert.equal(entry.compare(held, held).matched, true);
  assert.deepEqual(entry.compare(held, replay).checks.map(c => c.matched),
    [false, false, true, false]);
  assert.equal(entry.compare(replay, replay).matched, false,
    'equally incorrect targets must not pass');
  const frozen = observation([0, 0, 0, 0]);
  frozen.evidence.trials[0].commandError = -160;
  assert.equal(entry.compare(frozen, frozen).matched, false);
});

test('torque-enable comparison is motion-gated without durable writes', () => {
  const { loadCases } = require('../src/load-cases');
  const discovered = loadCases().find(c => c.id === entry.id);
  assert.equal(discovered.risk, 'motion');
  assert.equal(discovered.requiresPersistenceWrite, undefined);
  assert.deepEqual(discovered.stages, ['torque-enable-limits']);
});

class ProfileRig {
  constructor(fault) {
    this.fault = fault;
    this.events = [];
    this.calls = [];
    this.image = Buffer.alloc(87);
    this.image[5] = 5;
    this.image[30] = 1;
    this.image[55] = 1;
    this.image[21] = 16;
    this.image.writeUInt16LE(1000, 48);
    this.image.writeUInt16LE(2000, 56);
    this.image.writeUInt16LE(2000, 67);
    this.original = Buffer.from(this.image);
  }

  async exchange(label, packet) {
    return { error: 0, parameters: Buffer.from(this.image.subarray(packet[5], packet[5] + packet[6])) };
  }

  async write(id, address, values) {
    this.calls.push([address, [...values]]);
    if (address !== 55) assert.equal(this.image[55], 2, 'all writes must be RAM-only');
    if (this.fault === 'ignored-cap' && address === 48) return { error: 0 };
    const enable = address === 42 || (address === 40 && values[0] === 1);
    if (enable) {
      assert.equal(this.image.readUInt16LE(48), 0, 'cap verified before torque');
      assert.deepEqual([...this.image.subarray(21, 25)], [0, 0, 0, 0]);
    }
    this.image.set(values, address);
    if (address === 40 && values[0] === 0) this.image.writeUInt16LE(2000, 67);
    if (address === 42 || (address === 40 && values[0] === 1 && this.fault === 'replay')) {
      this.image[40] = 1;
      let goal = this.image.readUInt16LE(42);
      const low = this.image.readUInt16LE(9), high = this.image.readUInt16LE(11);
      if (low !== high) goal = Math.max(low, Math.min(high, goal));
      this.image.writeUInt16LE(goal, 67);
    }
    if (enable && this.fault === 'pwm') this.image.writeUInt16LE(1, 60);
    return { error: 0 };
  }

  async reset() { this.image = Buffer.from(this.original); }

  assertRestored() {
    assert.deepEqual(persistentBytes(this.image), persistentBytes(this.original));
    assert.equal(this.image[40], 0);
    assert.equal(this.image[55], 1);
    assert.ok(this.calls.every(([address, values]) => address !== 55 || values[0] === 2));
  }
}

test('hardware sequence captures the mismatch without moving or committing settings', async () => {
  const rig = new ProfileRig('replay');
  const result = await entry.run({ rig, id: 5 });
  assert.deepEqual(result.evidence.trials.map(t => t.enableDelta), [64, -64, 0, 96]);
  assert.deepEqual(result.exact.holds, [false, false, true, false]);
  assert.ok(result.evidence.trials.every(t => t.commandError === 0));
  rig.assertRestored();
});

test('failed cap setup aborts before any goal or torque enable and restores settings', async () => {
  const rig = new ProfileRig('ignored-cap');
  await assert.rejects(entry.run({ rig, id: 5 }), assert.AssertionError);
  assert.ok(!rig.calls.some(([address, v]) => address === 42 || (address === 40 && v[0] === 1)));
  rig.assertRestored();
});

test('unexpected PWM stops the comparison and restores settings', async () => {
  const rig = new ProfileRig('pwm');
  await assert.rejects(entry.run({ rig, id: 5 }), /unexpected PWM/);
  rig.assertRestored();
});
