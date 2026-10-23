'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { upperMedian, withinTolerance, compareEvidence } = require('../src/measurements');
const { CleanupError, withCleanup } = require('../src/errors');
const { exercise } = require('../src/motion');
const { withPersistedSettings } = require('../src/persistence');

test('sample median retains upper-middle selection without changing the input', () => {
  const values = [8, -3, 2, 1];
  assert.equal(upperMedian(values), 2);
  assert.deepEqual(values, [8, -3, 2, 1]);
  assert.equal(upperMedian([8, -3, 1]), 1);
  assert.equal(upperMedian([]), undefined);
});

test('measurement comparisons include the tolerance boundary and reject missing samples', () => {
  assert.equal(withinTolerance(-10, 10, 20), true);
  assert.equal(withinTolerance(-10, 10, 19), false);
  for (const value of [undefined, null, NaN, Infinity, -Infinity, '10']) {
    assert.equal(withinTolerance(value, 10, 100), false);
    assert.equal(withinTolerance(10, value, 100), false);
  }
  const compare = compareEvidence([['speed', 20], ['position', 3]]);
  assert.deepEqual(compare({ evidence: { speed: 100, position: 5 } },
    { evidence: { speed: 120 } }), {
    matched: false,
    checks: [
      { name: 'speed', factory: 100, candidate: 120, tolerance: 20, matched: true },
      { name: 'position', factory: 5, candidate: undefined, tolerance: 3, matched: false },
    ],
  });
});

test('cleanup always runs and preserves the original failure when restoration succeeds', async () => {
  const calls = [];
  const failure = new Error('operation failed');
  await assert.rejects(withCleanup(async () => {
    calls.push('operation'); throw failure;
  }, async () => { calls.push('cleanup'); }, 'cleanup failed'), error => error === failure);
  assert.deepEqual(calls, ['operation', 'cleanup']);
  assert.equal(await withCleanup(async () => 42, async () => {}, 'cleanup failed'), 42);
});

test('cleanup failures retain both causes, including failure after a successful operation', async () => {
  for (const operationError of [undefined, new Error('operation failed')]) {
    const cleanupError = new Error('restore failed');
    await assert.rejects(withCleanup(async () => {
      if (operationError) throw operationError;
    }, async () => { throw cleanupError; }, 'unsafe to continue'), error => {
      assert.ok(error instanceof CleanupError);
      assert.equal(error.message, 'unsafe to continue');
      assert.equal(error.operationError, operationError);
      assert.equal(error.cleanupError, cleanupError);
      assert.equal(error.cause, cleanupError);
      return true;
    });
  }
});

test('driven setup failure still resets and verifies the servo without running the body', async () => {
  const before = Buffer.alloc(87);
  before[40] = 1; before[55] = 1;
  const after = Buffer.from(before); after[40] = 0;
  const calls = [];
  const rig = {
    async read() { calls.push('read'); return calls.length === 1 ? before : after; },
    async reset(id) { calls.push(`reset:${id}`); },
  };
  await assert.rejects(exercise({ rig, id: 2 }, 0,
    () => assert.fail('body must not run')), /torque must be off/);
  assert.deepEqual(calls, ['read', 'reset:2', 'read']);
});

test('persistent write failure restores original bytes in the existing command order', async () => {
  const before = Buffer.alloc(87);
  before[5] = 2; before[55] = 1; before[21] = 16;
  const live = Buffer.from(before);
  const failure = new Error('marker write failed');
  const calls = [];
  let rejectMarker = true;
  const rig = {
    events: [],
    async read() { calls.push('read'); return Buffer.from(live); },
    async write(id, address, values) {
      calls.push([address, ...values]);
      if (address === 21 && rejectMarker) { rejectMarker = false; throw failure; }
      live.set(values, address);
    },
    async reset() { calls.push('reset'); },
  };
  await assert.rejects(withPersistedSettings({ rig, id: 2 }, 21, [8],
    () => assert.fail('body must not run')), error => error === failure);
  assert.deepEqual(calls, ['read', [55, 0], [21, 8], [40, 0], [55, 0],
    [21, 16], [55, 1], 'reset', 'read']);
  assert.deepEqual(live, before);
});
