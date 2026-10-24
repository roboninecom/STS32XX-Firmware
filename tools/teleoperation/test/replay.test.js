'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Replay } = require('../Replay');
const { Teleoperation } = require('../Teleoperation');
const { run, parse } = require('../cli');
const { argumentsForReplay } = require('../../pose-recorder/replay');

const profile = { kpQ8: 256, kdQ8: 32, kiQ8: 0, integralLimit: 0, effortLimit: 100,
  velocityLimit: 500, velocityFilterQ8: 64, gravitySlewEffortPerS: 1000,
  velocityFeedforward: { positiveGainQ8: 0, negativeGainQ8: 0, effortLimit: 0 } };
const configuration = () => ({ followerPort: 'COM4', protocol: 'extension', acceleration: 1000, rampTimeMs: 50,
  joints: [{ leaderId: 1, followerId: 1, mapping: 'angle' }], profiles: { 1: profile },
  replay: { speed: 300, holdMs: 0, moveTimeoutMs: 100, toleranceCounts: 2 } });
function poses(positions = [1500, 2000], ids = [1]) {
  return JSON.stringify({ format: 'sts-poses', version: 1, units: 'encoder-counts', ids,
    poses: positions.map((value, index) => ({ name: `pose-${index + 1}`, positions: Object.fromEntries(ids.map(id => [id, value])),
      capturedAt: '2026-10-24T12:00:00Z', durationMs: 5 })) });
}
function session(config, frames = [{ timestamp: 10, positions: { 1: 1500 } }, { timestamp: 110, positions: { 1: 2000 } }]) {
  return [{ type: 'preflight', config, limits: { leader: { 1: { min: 100, max: 4000, position: 1500 } } } },
    ...frames.map(frame => ({ type: 'command', ...frame }))].map(event => JSON.stringify(event)).join('\n');
}
function rig(raw = poses(), config = configuration()) {
  const replay = new Replay(raw, config), calls = [], motors = new Map();
  for (const joint of replay.joints) motors.set(joint.followerId, { position: 1000, torque: 0, selected: false, session: 0, sequence: 0 });
  let now = 0, sample = 0;
  const follower = new EventEmitter();
  follower.open = async () => { calls.push({ type: 'open' }); };
  follower.close = async () => { calls.push({ type: 'close' }); follower.emit('disconnect'); };
  follower.bus = { discover: async () => ({ ids: [...motors.keys()], alarms: new Map() }) };
  follower.protocol = {
    read: async (id, address, length) => {
      const motor = motors.get(id), bytes = Buffer.alloc(length);
      if (address === 0) { bytes[8] = 1; bytes[55] = 1; bytes.writeUInt16LE(100, 9); bytes.writeUInt16LE(4000, 11); bytes.writeUInt16LE(motor.position, 56); }
      if (address === 40) bytes[0] = motor.torque;
      if (address === 56) bytes.writeUInt16LE(motor.position);
      return bytes;
    },
    syncRead: async ids => ({ responses: new Map(ids.map(id => { const bytes = Buffer.alloc(2); bytes.writeUInt16LE(motors.get(id).position); return [id, bytes]; })) }),
    write: async (id, address, bytes) => {
      calls.push({ type: 'write', id, address, value: bytes[0] });
      if (address === 40) motors.get(id).torque = bytes[0];
    },
    transaction: async operation => operation(follower.protocol),
    armCommand: async (id, instruction, bytes) => {
      for (let offset = 2; offset < bytes.length; offset += 9) {
        const motorId = bytes[offset], motor = motors.get(motorId);
        motor.sequence = bytes.readUInt16LE(offset + 1);
        motor.position = bytes.readInt32LE(offset + 3) / 256;
        calls.push({ type: 'target', id: motorId, position: motor.position,
          sequence: motor.sequence, speed: bytes.readUInt16LE(offset + 7), at: now, session: bytes.readUInt16LE(0) });
      }
    },
    syncWrite: async (address, entries) => {
      for (const entry of entries) {
        motors.get(entry.id).position = entry.data.readUInt16LE();
        calls.push({ type: 'target', id: entry.id, position: entry.data.readUInt16LE(), speed: entry.data.readUInt16LE(4), at: now });
      }
    },
  };
  follower.arm = {
    capabilities: async () => ({ major: 9 }),
    configure: async (id, config) => { calls.push({ type: 'configure', id, config }); },
    select: async (id, selected, session) => {
      Object.assign(motors.get(id), { selected, session }); calls.push({ type: 'select', id, selected, session });
    },
    feedback: async id => {
      const motor = motors.get(id);
      return { sampleMs: ++sample, sampleSequence: sample, temperatureValid: true, temperatureValidated: 30,
        ageMs: 0, faults: 0, fresh: true, outputReady: true, driveEnabled: true, selected: motor.selected,
        armed: !!motor.torque, session: motor.session, acceptedSequence: motor.sequence,
        measuredPositionQ8: motor.position * 256, running: false };
    },
  };
  const controller = new Teleoperation({ follower, config, replay, clock: () => now, sleep: async ms => { now += ms; } });
  return { replay, controller, follower, calls, config, motors, advance: ms => { now += ms; } };
}
const targets = r => r.calls.filter(call => call.type === 'target');
const torqueOff = r => r.calls.filter(call => call.type === 'write' && call.address === 40 && call.value === 0);

test('pose replay caps targets to saved limits and sends each pose once with configured speed', async () => {
  const r = rig(poses([10, 5000])); await r.controller.preflight();
  assert.equal(r.controller.replaySummary.cappedTargets, 2);
  assert.equal(r.calls.length, 0);
  await r.controller.run();
  assert.deepEqual(targets(r).map(t => [t.position, t.speed, t.sequence]), [[100, 300, 1], [4000, 300, 2]]);
  assert(targets(r).every(t => t.session === r.controller.session));
  assert.equal(torqueOff(r).length, 0);
  assert.equal(r.motors.get(1).torque, 1);
});

test('pose holds start after arrival and repeats use new command sequences', async () => {
  const config = configuration(); config.replay = { ...config.replay, holdMs: 80, repeat: 2 };
  const r = rig(poses([1500]), config); await r.controller.preflight(); await r.controller.run();
  assert.deepEqual(targets(r).map(t => t.sequence), [1, 2]);
  assert(targets(r)[1].at - targets(r)[0].at >= 83);
});

test('session replay uses recorded spacing and mapping with a fresh session and sequences', async () => {
  const config = configuration(); config.joints[0].direction = -1;
  const raw = session(config, [{ timestamp: 100, positions: { 1: 100 }, sequence: 600 },
    { timestamp: 200, positions: { 1: 5000 }, sequence: 601 }]);
  const r = rig(raw, config); await r.controller.preflight(); await r.controller.run();
  assert.deepEqual(targets(r).map(t => [t.position, t.sequence]), [[4000, 1], [100, 2]]);
  assert.equal(targets(r)[1].at - targets(r)[0].at, 100);
});

test('late processing stretches replay instead of issuing catch-up bursts', async () => {
  const config = configuration(), r = rig(session(config, [0, 100, 200].map(timestamp => ({ timestamp, positions: { 1: 1500 } }))), config);
  await r.controller.preflight();
  await r.controller.run({ onFrame: frame => { if (frame.replay.index === 0) r.advance(160); } });
  const times = targets(r).map(t => t.at - targets(r)[0].at);
  assert.deepEqual(times, [0, 160, 260]);
});

test('long recorded gaps keep health checks active', async () => {
  const config = configuration(), r = rig(session(config, [{ timestamp: 0, positions: { 1: 1500 } },
    { timestamp: 1000, positions: { 1: 2000 } }]), config);
  await r.controller.preflight(); let reads = 0;
  await r.controller.run({ onTelemetry: () => { reads++; } });
  assert(reads >= 4); assert.equal(targets(r).length, 2);
});

for (const fail of [false, true]) test(`${fail ? 'fault' : 'normal stop'} during replay gap sends no later target`, async () => {
  const config = configuration(), r = rig(session(config), config);
  await r.controller.preflight();
  const sleep = r.controller.sleep;
  r.controller.sleep = async ms => { await sleep(ms); if (targets(r).length) {
    if (fail) r.controller.fail(new Error('lost cable')); else r.controller.stopping = true;
  } };
  if (fail) await assert.rejects(r.controller.run(), /lost cable/);
  else await r.controller.run();
  assert.equal(targets(r).length, 1); assert.equal(torqueOff(r).length, fail ? 1 : 0);
});

test('arrival timeout turns off every prepared motor', async () => {
  const config = configuration(); delete config.joints; config.profiles[2] = profile;
  const r = rig(poses([1500], [1, 2]), config);
  const feedback = r.follower.arm.feedback;
  r.follower.arm.feedback = async id => ({ ...await feedback(id), measuredPositionQ8: 1000 * 256 });
  await r.controller.preflight(); await assert.rejects(r.controller.run(), /arrival timeout/);
  assert.deepEqual(torqueOff(r).map(t => t.id), [1, 2]);
});

test('arrival waits for planner completion even when measured position is within tolerance', async () => {
  const r = rig(poses([1500])); const feedback = r.follower.arm.feedback;
  let checks = 0;
  r.follower.arm.feedback = async id => ({ ...await feedback(id), running: targets(r).length > 0 && ++checks < 3 });
  await r.controller.preflight(); await r.controller.run(); assert(checks >= 3);
});

test('logging failures and stale frames use shared torque-off cleanup', async () => {
  for (const stale of [false, true]) {
    const r = rig(); await r.controller.preflight();
    await assert.rejects(r.controller.run({ onCommand: async () => {
      if (stale) r.advance(101); else throw new Error('disk full');
    } }), stale ? /stale/ : /disk full/);
    assert.equal(targets(r).length, 0); assert.equal(torqueOff(r).length, 1);
  }
});

test('hot feedback during a recorded pause stops before the next command', async () => {
  const config = configuration(), r = rig(session(config, [{ timestamp: 0, positions: { 1: 1500 } },
    { timestamp: 1000, positions: { 1: 2000 } }]), config);
  const feedback = r.follower.arm.feedback;
  r.follower.arm.feedback = async id => ({ ...await feedback(id), temperatureValidated: r.controller.clock() > 250 ? 60 : 30 });
  await r.controller.preflight(); await assert.rejects(r.controller.run(), /temperature/);
  assert.equal(targets(r).length, 1); assert.equal(torqueOff(r).length, 1);
});

test('recording validation rejects malformed paths and incompatible mappings before I/O', () => {
  const config = configuration();
  assert.throws(() => new Replay(poses([]), config), /no poses/);
  assert.throws(() => new Replay(poses(), { ...config, replay: { repeat: 0 } }), /repeat/);
  assert.throws(() => new Replay(poses(), { ...config, replay: { mystery: 1 } }), /Unknown/);
  const wrong = JSON.parse(poses()); wrong.poses[1].positions = { 2: 300 };
  assert.throws(() => new Replay(JSON.stringify(wrong), config), /every selected ID/);
  assert.throws(() => new Replay(session(config, []), config), /no command/);
  assert.throws(() => new Replay(session(config, [{ timestamp: 1, positions: { 1: 2 } }, { timestamp: 0, positions: { 1: 3 } }]), config), /monotonic/);
  assert.throws(() => new Replay(session(config, [{ timestamp: 1, positions: {} }]), config), /leader position/);
  assert.throws(() => new Replay(session(config), { ...config, joints: [{ ...config.joints[0], direction: -1 }] }), /mapping differs/);
  assert.throws(() => new Replay(session(config) + '\n{"broken":', config), /line/);
});

test('replay CLI accepts only a follower and preview opens no leader or motor control', async () => {
  const r = rig(), logs = []; let clients = 0;
  await run(r.config, { replay: r.replay, createServo: () => { clients++; return r.follower; },
    createTeleoperation: () => r.controller, output: () => {},
    createLog: async () => ({ filename: 'test', write: async event => logs.push(event), close: async () => {} }) });
  assert.equal(clients, 1); assert.equal(targets(r).length, 0);
  assert.deepEqual(r.calls.map(c => c.type), ['open', 'close']);
  assert.equal(logs.find(e => e.type === 'preflight').replay.kind, 'poses');
  assert.equal(r.follower.listenerCount('disconnect'), 0);
});

test('CLI and pose shortcut parse replay paths without permitting accidental run', () => {
  assert.deepEqual(parse(['config.json', '--replay', 'file.json']), { filename: 'config.json', move: false, replayFile: 'file.json' });
  assert.deepEqual(argumentsForReplay(['config.json', 'poses.json']), ['config.json', '--replay', 'poses.json']);
  assert.equal(parse(argumentsForReplay(['config.json', 'poses.json', '--run'])).move, true);
  assert.throws(() => parse(['config.json', '--replay', '--run']));
  assert.throws(() => parse(['config.json', '--replay', 'x', '--replay', 'y']));
  assert.throws(() => argumentsForReplay(['config.json', 'poses.json', '--unknown']));
});

test('legacy session replay retains its wire format and completes without a leader', async () => {
  const config = { ...configuration(), protocol: 'legacy' }, r = rig(session(config), config);
  await r.controller.preflight(); await r.controller.run();
  assert.deepEqual(targets(r).map(t => t.position), [1500, 2000]); assert.equal(torqueOff(r).length, 0);
});

test('replay wraps sequences without reusing the recording identity', async () => {
  const r = rig(); await r.controller.preflight(); r.controller.sequence = 65534;
  await r.controller.run(); assert.deepEqual(targets(r).map(t => t.sequence), [65535, 0]);
});

for (const scaled of [false, true]) test(`legacy poses convert speed using ${scaled ? 'stored scale' : 'counts/s flag'}`, async () => {
  const config = { ...configuration(), protocol: 'legacy' }, r = rig(poses([1500]), config);
  const read = r.follower.protocol.read;
  r.follower.protocol.read = async (id, address, length) => {
    const bytes = await read(id, address, length);
    if (address === 0) bytes[18] = scaled ? 0 : 4;
    if (address === 82) bytes[0] = 50;
    return bytes;
  };
  await r.controller.preflight(); await r.controller.run();
  assert.equal(targets(r)[0].speed, scaled ? 6 : 300);
  assert.equal(targets(r)[0].position, 1500);
});

test('ordinary transport time fits inside recorded spacing instead of accumulating drift', async () => {
  const config = configuration(), r = rig(session(config, [0, 100, 200].map(timestamp => ({ timestamp, positions: { 1: 1500 } }))), config);
  const send = r.follower.protocol.armCommand;
  r.follower.protocol.armCommand = async (...args) => { r.advance(5); await send(...args); };
  await r.controller.preflight(); await r.controller.run();
  assert.deepEqual(targets(r).map(t => t.at - targets(r)[0].at), [0, 100, 200]);
});

test('published pose replay example passes read-only preflight without a joints map', async () => {
  const config = require('../../pose-recorder/replay.example.json');
  const r = rig(poses(), config); await r.controller.preflight();
  assert.equal(r.calls.length, 0); assert.equal(r.controller.profiles[1].velocityLimit, 500);
  assert.equal(r.controller.replaySummary.speed, 500);
});
