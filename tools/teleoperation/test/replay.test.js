'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Replay } = require('../Replay');
const { parse } = require('../cli');
const { run } = require('../../../host/arm-control/session');

const { profile, configuration, poses, session, rig, targets, torqueOff } = require('./fake-arm');

function coupledRig(waypoints, changes = {}) {
  const ids = Object.keys(waypoints[0]).map(Number), config = configuration();
  config.joints = ids.map(id => ({ leaderId: id, followerId: id, mapping: 'angle' }));
  config.profiles = Object.fromEntries(ids.map(id => [id, { ...profile, ...changes[id] }]));
  const recording = JSON.parse(poses(waypoints.map(() => 1000), ids));
  recording.poses.forEach((pose, index) => { pose.positions = waypoints[index]; });
  return rig(JSON.stringify(recording), config);
}

test('pose replay scales speeds from actual starting positions and leaves stationary joints idle', async () => {
  const r = coupledRig([{ 1: 2000, 2: 1750, 3: 1000 }]);
  r.motors.get(2).position = 1500;
  await r.controller.preflight();
  assert.deepEqual(r.replay.sample(r.controller).targets.map(t => t.speedLimit), [300, 75, 1]);
  await r.controller.run();
  assert.deepEqual(targets(r).map(t => [t.id, t.position, t.speed]), [[1, 2000, 300], [2, 1750, 75], [3, 1000, 1]]);
  assert.equal(new Set(targets(r).map(t => t.sequence)).size, 1);
});

test('coordination uses capped travel and slows the group for a lower motor speed limit', async () => {
  const r = coupledRig([{ 1: 5000, 2: 2500 }], { 2: { velocityLimit: 100 } });
  await r.controller.preflight();
  assert.equal(r.controller.sourceSummary.cappedTargets, 1);
  await r.controller.run();
  assert.deepEqual(targets(r).map(t => [t.position, t.speed]), [[4000, 200], [2500, 100]]);
});

test('coordination retains previous targets across repeats despite measured hold error', async () => {
  const r = coupledRig([{ 1: 1100, 2: 1000 }, { 1: 1100, 2: 1200 }]);
  r.replay.repeat = 2;
  await r.controller.preflight();
  await r.controller.run({ onFrame: () => { r.motors.get(1).position += 1; } });
  assert.deepEqual(targets(r).filter(t => t.id === 1).map(t => t.speed), [300, 1, 1, 1]);
  assert.deepEqual(targets(r).filter(t => t.id === 2).map(t => t.speed), [1, 300, 300, 300]);
});

test('first coordinated move uses the active reference, but ignores inactive reference fields', async () => {
  const r = coupledRig([{ 1: 2000, 2: 3000 }]);
  await r.controller.preflight();
  const sample = { active: true, armed: true, referencePositionQ8: 1000 * 256, measuredPositionQ8: 1100 * 256 };
  r.controller.lastFeedback.set(1, sample);
  assert.deepEqual(r.replay.sample(r.controller).targets.map(t => t.speedLimit), [150, 300]);
  sample.active = false;
  assert.deepEqual(r.replay.sample(r.controller).targets.map(t => t.speedLimit), [135, 300]);
});

test('tiny and zero-distance coordinated moves always have valid nonzero integer speeds', async () => {
  const r = coupledRig([{ 1: 1001, 2: 2000 }, { 1: 1001, 2: 2000 }]);
  await r.controller.preflight();
  await r.controller.run();
  assert.deepEqual(targets(r).map(t => t.speed), [1, 300, 1, 1]);
});

for (const kind of ['poses', 'session']) test(`${kind} replay logs firmware reference positions using one detailed feedback reader`, async () => {
  const config = configuration();
  const r = rig(kind === 'poses' ? poses() : session(config), config);
  const feedback = r.follower.arm.feedback;
  let reads = 0;
  r.follower.arm.feedback = async () => { throw new Error('Unexpected compact feedback read'); };
  r.follower.arm.tuning = async id => {
    reads++;
    return { ...await feedback(id), referencePositionQ8: 1234 * 256, referenceVelocityQ8PerS: 50 * 256 };
  };
  const samples = [];
  await r.controller.preflight();
  await r.controller.run({ onTelemetry: sample => samples.push(sample) });
  assert.equal(r.controller.monitorIntervalMs, 50);
  assert(reads > 0 && samples.length > 0);
  assert(samples.every(s => s.telemetry.referencePositionQ8 === 1234 * 256 &&
    s.telemetry.referenceVelocityQ8PerS === 50 * 256));
  assert.equal(targets(r).at(-1).position, 2000);
});

for (const position of [99, 4001]) test(`startup refusal reports measured position ${position} and saved limits`, async () => {
  const r = rig();
  r.motors.get(1).position = position;
  await r.controller.preflight();
  const feedback = r.follower.arm.feedback;
  r.follower.arm.feedback = async id => ({ ...await feedback(id), armed: false });
  await assert.rejects(r.controller.run(), new RegExp(`position ${position} is outside saved limits 100–4000`));
  assert.equal(targets(r).length, 0);
  assert.equal(r.motors.get(1).torque, 0);
});

test('in-range startup refusal reports session state without blaming travel limits', async () => {
  const r = rig(); await r.controller.preflight();
  const feedback = r.follower.arm.feedback;
  r.follower.arm.feedback = async id => ({ ...await feedback(id), session: 0 });
  await assert.rejects(r.controller.run(), /selected=true, armed=true, session=0, expected=/);
  assert.equal(targets(r).length, 0);
  assert.equal(r.motors.get(1).torque, 0);
});

test('pose replay caps targets to saved limits and sends each pose once with configured speed', async () => {
  const r = rig(poses([10, 5000])); await r.controller.preflight();
  assert.equal(r.controller.sourceSummary.cappedTargets, 2);
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
  await run(r.config, { source: r.replay, createServo: () => { clients++; return r.follower; },
    createController: () => r.controller, output: () => {},
    createLog: async () => ({ filename: 'test', write: async event => logs.push(event), close: async () => {} }) });
  assert.equal(clients, 1); assert.equal(targets(r).length, 0);
  assert.deepEqual(r.calls.map(c => c.type), ['open', 'close']);
  assert.equal(logs.find(e => e.type === 'preflight').replay.kind, 'poses');
  assert.equal(r.follower.listenerCount('disconnect'), 0);
});

test('one replay command accepts pose and session files with a read-only default', () => {
  for (const file of ['poses.json', 'session.ndjson']) {
    assert.deepEqual(parse(['config.json', file], 'replay'), { filename: 'config.json', move: false, replayFile: file });
    assert.equal(parse(['config.json', file, '--run'], 'replay').move, true);
  }
  for (const args of [[], ['config.json'], ['config.json', '--run'], ['config.json', 'file', '--bad'], ['config.json', 'file', '--run', '--run']])
    assert.throws(() => parse(args, 'replay'));
  assert.throws(() => parse(['config.json', '--replay', 'file']));
});

test('ordinary transport time fits inside recorded spacing instead of accumulating drift', async () => {
  const config = configuration(), r = rig(session(config, [0, 100, 200].map(timestamp => ({ timestamp, positions: { 1: 1500 } }))), config);
  const send = r.follower.protocol.armCommand;
  r.follower.protocol.armCommand = async (...args) => { r.advance(5); await send(...args); };
  await r.controller.preflight(); await r.controller.run();
  assert.deepEqual(targets(r).map(t => t.at - targets(r)[0].at), [0, 100, 200]);
});

test('replay rejects the removed resume option', () => {
  assert.deepEqual(parse(['config.json', 'poses.json', '--run'], 'replay'),
    { filename: 'config.json', replayFile: 'poses.json', move: true });
  for (const args of [['config.json', 'poses.json', '--resume'],
    ['config.json', 'poses.json', '--run', '--resume'],
    ['config.json', 'poses.json', '--run', '--run']])
    assert.throws(() => parse(args, 'replay'));
  assert.throws(() => parse(['config.json', '--run', '--resume']));
});

test('compact replay is optional, preserves preview, and rejects duplicate or live flags', () => {
  assert.deepEqual(parse(['config.json', 'poses.json', '--compact'], 'replay'),
    { filename: 'config.json', replayFile: 'poses.json', move: false, compact: true });
  for (const flags of [['--run', '--compact'], ['--compact', '--run']])
    assert.equal(parse(['config.json', 'poses.json', ...flags], 'replay').move, true);
  assert.throws(() => parse(['config.json', 'poses.json', '--compact', '--compact'], 'replay'));
  assert.throws(() => parse(['config.json', '--compact']));
});

for (const kind of ['poses', 'session']) test(`${kind} compact replay uses smaller feedback and retains motion and polling`, async () => {
  const config = configuration(), r = rig(kind === 'poses' ? poses() : session(config), config);
  r.replay.detailedAll = false;
  const feedback = r.follower.arm.feedback;
  let reads = 0;
  r.follower.arm.feedback = async id => { reads++; return feedback(id); };
  r.follower.arm.tuning = async () => { throw new Error('Unexpected detailed feedback during fresh compact replay'); };
  await r.controller.preflight();
  assert.equal(r.controller.sourceSummary.telemetry, 'compact');
  await r.controller.run();
  assert.equal(r.controller.monitorIntervalMs, 50);
  assert(reads > 0);
  assert.equal(targets(r).at(-1).position, 2000);
  assert.equal(r.motors.get(1).torque, 1);
});

test('published pose replay example passes read-only preflight without a joints map', async () => {
  const config = require('../../pose-recorder/replay.example.json');
  const r = rig(poses(), config); await r.controller.preflight();
  assert.equal(r.calls.length, 0); assert.equal(r.controller.profiles[1].velocityLimit, 500);
  assert.equal(r.controller.sourceSummary.speed, 500);
});
