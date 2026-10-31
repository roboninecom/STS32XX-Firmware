'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PoseCapture, validateRecording, saveRecording } = require('../capture');
const { parse, run } = require('../record');

function rig(ids = [2, 5]) {
  const writes = [], reads = [];
  const bus = {
    has: id => ids.includes(id),
    syncWrite: async entries => { writes.push(entries); },
    read: async (id, fields) => { reads.push([id, fields]); return { torqueEnable: 0, presentPosition: id * 100, servoStatus: 0 }; },
  };
  return { bus, writes, reads };
}
async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sts-poses-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
const record = () => ({ format: 'sts-poses', version: 1, units: 'encoder-counts', ids: [2, 5],
  poses: [{ name: 'first', capturedAt: new Date().toISOString(), durationMs: 5, positions: { 2: 200, 5: 500 } }] });

test('CLI requires explicit port and unique selected IDs', () => {
  const options = parse(['--port', 'PORT', '--ids', '2,5']);
  assert.deepEqual(options.ids, [2, 5]);
  assert.equal(options.baudRate, 1000000);
  for (const ids of ['0', '254', '1,1', '1,', '1,2,3,4,5,6,7'])
    assert.throws(() => parse(['--port', 'PORT', '--ids', ids]));
  assert.throws(() => parse(['--ids', '2']));
  assert.throws(() => parse(['--port', 'PORT', '--ids', '2', '--baud', '123']));
});

test('capture uses selected IDs, preserves counts, and never enables torque', async () => {
  const { bus, writes } = rig();
  const capture = new PoseCapture(bus, [5, 2]);
  await capture.release();
  const pose = await capture.read();
  assert.deepEqual(pose.positions, { 2: 200, 5: 500 });
  assert.ok(pose.durationMs >= 0);
  assert.deepEqual(writes, [[{ id: 5, values: { torqueEnable: 0 } }, { id: 2, values: { torqueEnable: 0 } }]]);
  assert.throws(() => new PoseCapture(bus, [1]), /not discovered/);
});

test('release verifies every motor even after write and read failures', async () => {
  const { bus, reads } = rig();
  bus.syncWrite = async () => { throw new Error('write failed'); };
  bus.read = async id => { reads.push(id); throw new Error('read failed'); };
  await assert.rejects(new PoseCapture(bus, [2, 5]).release(), error => error.errors.length === 3);
  assert.deepEqual(reads, [2, 5]);
});

test('capture rejects missing data, torque, alarms and cancellation', async () => {
  const { bus } = rig();
  const capture = new PoseCapture(bus, [2]);
  for (const state of [{}, { torqueEnable: 1, presentPosition: 20, servoStatus: 0 },
    { torqueEnable: 0, presentPosition: 20, servoStatus: 1 }]) {
    bus.read = async () => state;
    await assert.rejects(capture.read());
  }
  const abort = new AbortController(); abort.abort(new Error('cancelled'));
  await assert.rejects(capture.read({ signal: abort.signal }), /cancelled/);
});

test('record format requires exact ID keys and unique names', () => {
  assert.equal(validateRecording(record()).version, 1);
  const wrong = record(); delete wrong.poses[0].positions[5]; wrong.poses[0].positions[3] = 500;
  assert.throws(() => validateRecording(wrong), /every selected ID/);
  const duplicate = record(); duplicate.poses.push(duplicate.poses[0]);
  assert.throws(() => validateRecording(duplicate), /unique/);
});

test('atomic save retains the previous recording if replacement fails', async t => {
  const dir = await directory(t), filename = path.join(dir, 'poses.json');
  await saveRecording(filename, record());
  const original = await fs.readFile(filename, 'utf8');
  await assert.rejects(saveRecording(filename, record(), { ...fs, rename: async () => { throw new Error('disk error'); } }), /disk error/);
  assert.equal(await fs.readFile(filename, 'utf8'), original);
  assert.deepEqual(await fs.readdir(dir), ['poses.json']);
});

test('interactive run saves each pose and releases torque again on exit', async t => {
  const { bus, writes } = rig(); let closed = false;
  const answers = ['', '', 'home', 'done'];
  const result = await run({ port: 'PORT', ids: [2, 5], baudRate: 1000000, timeoutMs: 100, output: await directory(t) }, {
    createServo: () => ({ bus, connect: async () => ({ ids: [2, 5] }), close: async () => { closed = true; } }),
    question: async () => answers.shift(), output: () => {},
  });
  assert.equal(result.poses, 2); assert.equal(writes.length, 2); assert.ok(closed);
  const saved = JSON.parse(await fs.readFile(result.filename, 'utf8'));
  assert.deepEqual(saved.poses.map(p => p.name), ['position-1', 'home']);
  validateRecording(saved);
});

test('cancellation before release does not write; disk failure still cleans up', async t => {
  for (const cancel of [true, false]) {
    const { bus, writes } = rig(); let closed = false;
    const answers = cancel ? ['cancel'] : ['', 'first'];
    await assert.rejects(run({ port: 'PORT', ids: [2, 5], baudRate: 1000000, timeoutMs: 100, output: await directory(t) }, {
      createServo: () => ({ bus, connect: async () => ({ ids: [2, 5] }), close: async () => { closed = true; } }),
      question: async () => answers.shift(), output: () => {}, save: async () => { throw new Error('disk error'); },
    }), cancel ? /cancelled/ : /disk error/);
    assert.equal(writes.length, cancel ? 0 : 2); assert.ok(closed);
  }
});

test('calibration can skip temporary read errors per motor while default capture stays strict', async () => {
  const { RequestTimeoutError, ServoStatusError } = require('../../../host/servo-driver');
  const { bus } = rig();
  bus.read = async id => {
    if (id === 2) throw new RequestTimeoutError('timeout');
    return { torqueEnable: 0, servoStatus: 0, presentPosition: 500 };
  };
  const capture = new PoseCapture(bus, [2, 5]);
  const sample = await capture.read({ tolerateReadErrors: true });
  assert.deepEqual(sample.positions, { 5: 500 });
  assert.deepEqual(sample.errors, { 2: 'timeout' });
  await assert.rejects(capture.read(), /timeout/);
  bus.read = async () => { throw new ServoStatusError(2, 1, ['voltage']); };
  assert.match((await capture.read({ tolerateReadErrors: true })).errors[2], /voltage/);
  await assert.rejects(capture.read(), /voltage/);
  bus.read = async () => ({ torqueEnable: 1, servoStatus: 0, presentPosition: 100 });
  assert.match((await capture.read({ tolerateReadErrors: true })).errors[2], /torque is not off/);
  await assert.rejects(capture.read(), /torque is not off/);
});
