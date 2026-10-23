'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { withCleanup } = require('./errors');
const { persistentBytes } = require('./register-image');

async function persist(rig, id, address, values) {
  await rig.write(id, 55, [0]);
  await rig.write(id, address, values);
  await delay(60);
  await rig.write(id, 55, [1]);
  await rig.reset(id);
}

async function withPersistedSettings(context, address, values, body) {
  const { rig, id } = context;
  const before = await rig.read(id, 0, 87);
  assert.equal(before[5], id, 'bus ID and register ID differ');
  assert.equal(before[40], 0, 'persistence case requires torque off');
  assert.equal(before[55], 1, 'persistence case requires locked entry');
  rig.events.push({ label: `persistence-pretest-snapshot:${id}:${address}`,
    kind: 'evidence', registerBytes: before.toString('hex') });
  const original = [...before.subarray(address, address + values.length)];
  assert.notDeepEqual(values, original, 'persistence marker must change a byte');
  const result = await withCleanup(async () => {
    await persist(rig, id, address, values);
    const changed = await rig.read(id, 0, 87);
    const expected = Buffer.from(before);
    expected.set(values, address);
    assert.deepEqual(persistentBytes(changed), persistentBytes(expected),
      'persistent marker did not survive reset or altered other settings');
    assert.equal(changed[40], 0);
    assert.equal(changed[55], 1);
    return body(rig, id, before, changed);
  }, async () => {
    await rig.write(id, 40, [0]);
    await persist(rig, id, address, original);
    const after = await rig.read(id, 0, 87);
    assert.deepEqual(persistentBytes(after), persistentBytes(before),
      'original persistent settings were not restored');
    assert.equal(after[40], 0);
    assert.equal(after[55], 1);
  }, `persistence cleanup failed on ID ${id} at ${address}`);
  return { before: before.toString('hex'), original, changed: values, result };
}

module.exports = { withPersistedSettings };
