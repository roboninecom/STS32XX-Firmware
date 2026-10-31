'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LegacyReplay, motionValues } = require('../LegacyReplay');
const { parse, run } = require('../cli');
const { RequestTimeoutError } = require('../../../host/servo-driver');

function record(positions = [{ 1: 2000, 2: 1250 }, { 1: 1000, 2: 1250 }]) {
  return { format: 'sts-poses', version: 1, units: 'encoder-counts', ids: [1, 2],
    poses: positions.map((p, i) => ({ name: `pose-${i}`, positions: p,
      capturedAt: '2026-10-30T00:00:00.000Z', durationMs: 0 })) };
}
function rig({ factory = false } = {}) {
  const motors = Object.fromEntries([1, 2, 3].map(id => [id, {
    responseStatusLevel: 1, minAngleLimit: 100, maxAngleLimit: 4000, configurationFlags: 4, positionPGain: 16,
    positionDGain: 32, positionIGain: 0, positionScalingDivisor: 1, positionCorrection: -100,
    operationMode: 0, lock: 1, asyncWritePending: 0, motionRateScale: 50, minimumVelocity: 1,
    maximumVelocity: 150, maximumAcceleration: 100, torqueEnable: 1, targetPosition: 3000,
    presentPosition: 1000, presentSpeed: 0, presentPWM: 0, presentVoltage: 124,
    presentTemperature: 40, servoStatus: 0, activeProfileGoalPosition: 1000, activeProfileVelocity: 0,
  }]));
  const writes = [], selections = [], events = [];
  const servo = new EventEmitter();
  servo.connect = async () => ({ ids: [1, 2, 3] });
  servo.close = async () => { servo.closed = true; };
  servo.arm = { capabilities: async () => { if (factory) throw new RequestTimeoutError('unsupported'); return { major: 9 }; },
    select: async (...args) => selections.push(args), feedback: async () => ({ selected: false, armed: false }) };
  servo.bus = {
    read: async (id, keys) => Object.fromEntries(keys.map(key => [key, motors[id][key]])),
    write: async (id, values) => { writes.push({ id, values: { ...values } }); Object.assign(motors[id], values); },
    syncWrite: async entries => {
      writes.push({ group: entries });
      for (const { id, values } of entries) Object.assign(motors[id], values, {
        activeProfileGoalPosition: values.targetPosition, activeProfileVelocity: 0,
        presentPosition: values.targetPosition - 20, // Legacy PID can retain static error.
      });
    },
  };
  let now = 0;
  const options = { speed: 1000, acceleration: 5000, holdMs: 100 };
  const dependencies = { clock: () => now, sleep: async ms => { now += ms; }, emit: async e => events.push(e) };
  const controller = new LegacyReplay(servo, record(), options, dependencies);
  return { servo, motors, writes, selections, events, options, dependencies, controller };
}

test('CLI has one explicit run flag and validates units, unknown and duplicate arguments', () => {
  assert.equal(parse(['poses.json', '--port', '/dev/test']).move, false);
  assert.equal(parse(['poses.json', '--run', '--port', '/dev/test']).move, true);
  for (const args of [[], ['--run'], ['poses.json', '--port', 'x', '--speed', '0'],
    ['poses.json', '--port', 'x', '--acceleration', '5050'], ['poses.json', '--port', 'x', '--run', '--run'],
    ['poses.json', '--port', 'x', '--pid', '16'], ['poses.json', '--port', 'x', '--baud', '12']])
    assert.throws(() => parse(args));
});

test('motion encoding respects saved rate and acceleration cap without writing settings', () => {
  assert.deepEqual(motionValues({ configurationFlags: 0, motionRateScale: 50, maximumAcceleration: 30 }, -100, 999, 5000),
    { acceleration: 30, targetPosition: -100, goalPWM: 0, goalVelocity: 19 });
  assert.equal(motionValues({ configurationFlags: 4, maximumAcceleration: 0 }, 100, 1, 5000).goalVelocity, 1);
});

for (const factory of [false, true]) test(`${factory ? 'factory' : 'custom'} replay uses saved gains, seeds position, coordinates and holds`, async () => {
  const r = rig({ factory });
  const limits = await r.controller.preflight();
  assert.deepEqual(limits.follower[1].pid, { p: 16, d: 32, i: 0 });
  assert.equal(r.writes.length, 0);
  await r.controller.play();
  assert.equal(r.selections.length, factory ? 0 : 2);
  for (const id of [1, 2]) {
    const writes = r.writes.filter(w => w.id === id);
    assert.deepEqual(writes[0].values, { torqueEnable: 0 });
    assert.equal(writes[1].values.targetPosition, 1000);
    assert.deepEqual(writes[2].values, { torqueEnable: 1 });
    assert.equal(r.motors[id].torqueEnable, 1);
  }
  assert.equal(r.writes.some(w => w.id === 3 || w.group?.some(e => e.id === 3)), false);
  const moves = r.writes.filter(w => w.group);
  assert.deepEqual(moves[0].group.map(e => e.values.goalVelocity), [1000, 250]);
  assert.deepEqual(moves[1].group.map(e => e.values.goalVelocity), [1000, 1]);
  assert(r.writes.every(w => !w.values || Object.keys(w.values).every(k =>
    ['torqueEnable', 'acceleration', 'targetPosition', 'goalPWM', 'goalVelocity'].includes(k))));
  assert(r.events.some(e => e.type === 'telemetry' && e.telemetry.measuredPositionQ8 === 1980 * 256));
});

test('caps targets rather than rejecting poses, and handles equal limits as unrestricted', async () => {
  const r = rig(); await r.controller.preflight();
  let targets = r.controller.frame({ positions: { 1: 4500, 2: -10 } }, { 1: 1000, 2: 1000 });
  assert.deepEqual(targets.map(t => t.position), [4000, 100]);
  r.controller.settings[2].minAngleLimit = r.controller.settings[2].maxAngleLimit = 0;
  targets = r.controller.frame({ positions: { 1: 1000, 2: -10 } }, { 1: 1000, 2: 1000 });
  assert.equal(targets[1].position, -10);
});

for (const [key, value] of [['operationMode', 1], ['positionScalingDivisor', 2], ['lock', 0],
  ['asyncWritePending', 1], ['servoStatus', 4], ['maximumVelocity', 0]])
  test(`invalid ${key} fails preflight without changing any motor`, async () => {
    const r = rig(); r.motors[2][key] = value;
    await assert.rejects(r.controller.preflight()); assert.equal(r.writes.length, 0);
  });

test('capability errors other than timeout are not treated as factory firmware', async () => {
  const r = rig(); r.servo.arm.capabilities = async () => { throw new Error('malformed'); };
  await assert.rejects(r.controller.preflight(), /malformed/);
  assert.equal(r.writes.length, 0);
});

test('missing IDs and unsupported extensions fail before mutation', async () => {
  const r = rig(); r.servo.connect = async () => ({ ids: [1] });
  await assert.rejects(r.controller.preflight(), /missing: 2/);
  r.servo.connect = async () => ({ ids: [1, 2] });
  r.servo.arm.capabilities = async () => ({ major: 8 });
  await assert.rejects(r.controller.preflight(), /unsupported extension/);
  assert.equal(r.writes.length, 0);
});

async function session(t, r, { move = true, ...dependencies } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-replay-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'poses.json');
  await fs.writeFile(filename, JSON.stringify(record()));
  return run({ ...r.options, port: '/dev/fake', baudRate: 1000000, filename, move }, {
    createServo: () => r.servo, output: () => {}, ...r.dependencies,
    createLog: async () => ({ filename: 'memory', write: async e => r.events.push(e), close: async () => {} }),
    ...dependencies,
  });
}

test('read-only CLI session creates no motion log and does not change torque', async t => {
  const r = rig(); await session(t, r, { move: false, createLog: async () => { throw new Error('must not log preview'); } });
  assert.equal(r.writes.length, 0); assert(r.servo.closed);
});

test('normal session logs calibration and completes with torque on', async t => {
  const r = rig(); await session(t, r);
  assert.equal(r.events[0].limits.follower[1].encoderCalibration.positionCorrection, -100);
  assert.equal(r.events.at(-1).holdRetained, true);
  assert.equal(r.motors[1].torqueEnable, 1); assert(r.servo.closed);
});

for (const failure of ['alarm', 'dropped-command', 'timeout', 'disconnect', 'log', 'cancel'])
  test(`${failure} stops replay and disables every prepared motor`, async t => {
    const r = rig(), abort = new AbortController(), syncWrite = r.servo.bus.syncWrite;
    r.servo.bus.syncWrite = async entries => {
      if (failure !== 'dropped-command' && failure !== 'timeout') await syncWrite(entries);
      if (failure === 'timeout') for (const e of entries) r.motors[e.id].targetPosition = e.values.targetPosition;
      if (failure === 'alarm') r.motors[1].servoStatus = 4;
      if (failure === 'disconnect') r.servo.emit('disconnect');
      if (failure === 'cancel') abort.abort(new Error('Cancelled'));
    };
    const extra = failure === 'log' ? { createLog: async () => ({ filename: 'memory',
      write: async e => { if (e.type === 'command') throw new Error('disk full'); }, close: async () => {} }) } : {};
    await assert.rejects(session(t, r, { signal: abort.signal, ...extra }));
    assert.equal(r.motors[1].torqueEnable, 0); assert.equal(r.motors[2].torqueEnable, 0);
    assert.equal(r.motors[3].torqueEnable, 1); assert(r.servo.closed);
  });

test('cleanup continues after one motor fails and reports the failure', async t => {
  const r = rig(), write = r.servo.bus.write;
  let failed = false;
  r.servo.bus.syncWrite = async () => { failed = true; throw new Error('send failed'); };
  r.servo.bus.write = async (id, values) => {
    if (failed && id === 1) throw new Error('offline');
    return write(id, values);
  };
  await assert.rejects(session(t, r), /send failed; Motor 1: offline/);
  assert.equal(r.motors[2].torqueEnable, 0); assert(r.servo.closed);
});

test('motors with write acknowledgements disabled use readback instead', async () => {
  const r = rig(), write = r.servo.bus.write;
  r.motors[1].responseStatusLevel = 0;
  r.servo.bus.write = async (id, values, options) => {
    assert.equal(options.expectResponse, id !== 1);
    return write(id, values);
  };
  await r.controller.preflight(); await r.controller.play();
  assert.deepEqual(await r.controller.disableTorque(), []);
});

test('cleanup verifies torque off after a lost acknowledgement and tolerates alarm replies', async () => {
  const r = rig();
  await r.controller.preflight(); await r.controller.play();
  const write = r.servo.bus.write, read = r.servo.bus.read;
  r.servo.bus.write = async (id, values, options) => {
    assert.equal(options.rejectOnAlarm, false);
    await write(id, values);
    throw new RequestTimeoutError('lost acknowledgement');
  };
  r.servo.bus.read = async (id, keys, options) => {
    assert.equal(options.rejectOnAlarm, false);
    return read(id, keys);
  };
  assert.deepEqual(await r.controller.disableTorque(), []);
  assert.equal(r.motors[1].torqueEnable, 0);
  assert.equal(r.motors[2].torqueEnable, 0);
});

test('real driver combines feedback into one read and motion into one contiguous group write', async () => {
  const { StsBus, RegisterCodec, ControlTable } = require('../../../host/servo-driver');
  const r = rig(), reads = [], groups = [];
  const images = Object.fromEntries(Object.entries(r.motors).map(([id, values]) => {
    const image = Buffer.alloc(87);
    for (const [key, value] of Object.entries(values)) {
      const field = ControlTable[key];
      if (field.access === 'read') image.writeUIntLE(value, field.address, field.size);
      else RegisterCodec.encodeInto(key, value, image, field.address);
    }
    return [id, image];
  }));
  const protocol = {
    ping: async () => ({ ids: [1, 2, 3] }), transaction: async fn => fn(protocol),
    read: async (id, address, length) => { reads.push({ id, address, length }); return images[id].subarray(address, address + length); },
    syncWrite: async (address, entries) => { groups.push({ address, entries }); },
  };
  r.servo.bus = new StsBus(protocol);
  r.servo.connect = () => r.servo.bus.discover();
  await r.controller.preflight();
  reads.length = 0;
  await r.controller.sample();
  assert.deepEqual(reads, [{ id: 1, address: 40, length: 33 }, { id: 2, address: 40, length: 33 }]);
  const frame = r.controller.frame(record().poses[0], { 1: 1000, 2: 1000 });
  await r.servo.bus.syncWrite(frame.map(({ id, values }) => ({ id, values })));
  assert.equal(groups[0].address, 41);
  assert.deepEqual(groups[0].entries.map(e => [...e.data]), [
    [50, 208, 7, 0, 0, 232, 3], [50, 226, 4, 0, 0, 250, 0],
  ]);
});
