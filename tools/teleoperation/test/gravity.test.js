'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GravityModel } = require('../../../host/arm-control/GravityModel');
const { ArmController } = require('../../../host/arm-control/ArmController');
const { TeleoperationInput } = require('../Teleoperation');
const { Instruction } = require('../../../host/servo-driver');
const { profile, configuration, poses, session, rig, targets, torqueOff } = require('./fake-arm');
const model = (ids = [1]) => new GravityModel({ format: 'sts-gravity', version: 1, units: 'pwm-effort',
  name: 'test', calibration: 'counts', mounting: 'test', payload: 'empty',
  encoderCalibration: Object.fromEntries(ids.map(id => [id, { positionCorrection: 0, resolution: 1, reverse: false }])),
  models: Object.fromEntries(ids.map(id => [id, { maxEffort: 100, note: 'test',
    terms: [{ fn: 'sin', coefficient: 50, offsetRad: 0, weights: { [id]: 0.001 } }] }])) });
const gravityCalls = r => r.calls.filter(c => c.type === 'gravity');

test('gravity is measured, primed and confirmed before the first replay target', async () => {
  const r = rig(poses([1500]), configuration(), model());
  const feedback = r.follower.arm.feedback;
  r.follower.arm.feedback = async id => { const s = await feedback(id); r.calls.push({ type: 'feedback', id, accepted: s.gravitySequence }); return s; };
  await r.controller.preflight(); assert.equal(gravityCalls(r).length, 0);
  await r.controller.run();
  const first = gravityCalls(r)[0];
  assert.equal(first.effort, Math.round(50 * Math.sin(1))); // measured=1000, desired=1500
  const index = r.calls.findIndex(c => c.type === 'target');
  assert(r.calls.slice(0, index).some(c => c.type === 'feedback' && c.accepted === first.sequence));
  assert.equal(gravityCalls(r).at(-1).effort, Math.round(50 * Math.sin(1.5)));
  assert.equal(r.motors.get(1).torque, 1); assert.equal(torqueOff(r).length, 0);
});

for (const kind of ['poses', 'session']) test(`${kind}: gravity refreshes throughout holds and recorded gaps`, async () => {
  const config = configuration(); config.replay.holdMs = 500;
  const raw = kind === 'poses' ? poses([1500, 2000]) : session(config,
    [{ timestamp: 0, positions: { 1: 1500 } }, { timestamp: 500, positions: { 1: 2000 } }]);
  const r = rig(raw, config, model()); await r.controller.preflight(); await r.controller.run();
  const updates = gravityCalls(r);
  assert(updates.length > 15);
  for (let i = 1; i < updates.length; i++) assert(updates[i].at - updates[i - 1].at <= 70);
  assert.equal(targets(r).length, 2);
});

test('live input at 1 Hz still services gravity between leader frames', async () => {
  const config = { ...configuration(), hz: 1 }, r = rig(poses(), config, model());
  const leader = { ...r.follower, protocol: { ...r.follower.protocol,
    read: async (id, address, length, options) => address === 40 ? Buffer.from([0]) : r.follower.protocol.read(id, address, length, options) } };
  r.controller.source = new TeleoperationInput({ leader, config });
  await r.controller.preflight();
  await r.controller.run({ shouldStop: () => r.controller.clock() >= 1100 });
  assert.equal(targets(r).length, 2);
  assert(gravityCalls(r).filter(c => c.at < 1000).length >= 19);
});

test('coupled model reads all axes while only ready motors receive startup gravity', async () => {
  const config = configuration(); delete config.joints; config.profiles[2] = profile;
  const g = model([1, 2]); g.document.models[1].terms[0].weights = { 2: 0.001 };
  const r = rig(poses([1500], [1, 2]), config, g); r.motors.get(2).position = 2000;
  await r.controller.preflight(); await r.controller.run();
  assert.equal(gravityCalls(r)[0].effort, Math.round(50 * Math.sin(2)));
  for (const id of [1, 2]) {
    const enabled = r.calls.findIndex(c => c.type === 'write' && c.id === id && c.address === 40 && c.value === 1);
    const primed = r.calls.findIndex(c => c.type === 'gravity' && c.id === id);
    assert(primed > enabled); assert(primed < r.calls.findIndex(c => c.type === 'target'));
  }
});

for (const failure of ['acceptance', 'sensor', 'queue', 'logging', 'cap', 'session'])
  test(`${failure} failure stops gravity replay and verifies torque-off`, async () => {
    const r = rig(poses([1500]), configuration(), model()); await r.controller.preflight();
    const feedback = r.follower.arm.feedback;
    r.follower.arm.feedback = async id => {
      const s = await feedback(id);
      if (gravityCalls(r).length) {
        if (failure === 'acceptance') s.gravitySequence = 999;
        if (failure === 'sensor') s.ageMs = 3;
        if (failure === 'session') s.session = 0;
      }
      return s;
    };
    const transaction = r.follower.protocol.transaction;
    if (failure === 'queue') r.follower.protocol.transaction = async fn => { r.advance(101); return transaction(fn); };
    if (failure === 'cap') r.controller.gravity.document.models[1].maxEffort = 1;
    await assert.rejects(r.controller.run({ onTelemetry: () => {
      if (failure === 'logging') r.advance(101);
    } }), /gravity|stale|sensor|cap|extension/i);
    assert.equal(targets(r).length, 0); assert.equal(torqueOff(r).length, 1);
  });

test('a slow coupled scan is rejected before any gravity write', async () => {
  const r = rig(poses(), configuration(), model()); await r.controller.preflight();
  const feedback = r.follower.arm.feedback;
  r.follower.arm.feedback = async id => { r.advance(101); return feedback(id); };
  await assert.rejects(r.controller.run(), /Stale coupled/);
  assert.equal(gravityCalls(r).length, 0); assert.equal(torqueOff(r).length, 1);
});

test('normal interruption finishes remaining motion with gravity; no later target is sent', async () => {
  const config = configuration(), r = rig(session(config), config, model());
  const feedback = r.follower.arm.feedback;
  r.follower.arm.feedback = async id => ({ ...await feedback(id), running: targets(r).length > 0 && r.controller.clock() < 500 });
  await r.controller.preflight();
  await r.controller.run({ onFrame: () => { r.controller.stopping = true; } });
  assert.equal(targets(r).length, 1);
  assert(gravityCalls(r).at(-1).at >= 700);
  assert.equal(torqueOff(r).length, 0);
});

test('final hold waits for the configured gravity slew, and times out if motion never ends', async () => {
  for (const running of [false, true]) {
    const config = configuration(); config.profiles = { 1: { ...profile, gravitySlewEffortPerS: 10 } };
    const r = rig(poses([1500]), config, model());
    const feedback = r.follower.arm.feedback;
    r.follower.arm.feedback = async id => ({ ...await feedback(id), running });
    await r.controller.preflight();
    // Stop input immediately after setup to exercise shared completion, not replay's arrival timeout.
    r.controller.source.play = async () => {};
    if (running) { await assert.rejects(r.controller.run(), /completion timeout/); assert.equal(torqueOff(r).length, 1); }
    else { await r.controller.run(); assert(gravityCalls(r).at(-1).at >= 4400); }
  }
});

test('gravity sequence wraps independently of motion sequence', async () => {
  const r = rig(poses([1500]), configuration(), model()); await r.controller.preflight(); await r.controller.initialize();
  r.controller.gravitySent.get(1).sequence = 65535; r.motors.get(1).gravitySequence = 65535;
  await r.controller.monitor(); assert.equal(gravityCalls(r).at(-1).sequence, 0); assert.equal(r.controller.sequence, 0);
});

test('gravity configuration errors are rejected before opening hardware', () => {
  assert.throws(() => new ArmController({ config: { protocol: 'legacy' }, gravity: model() }), /Unknown controller setting: protocol/);
  assert.throws(() => new ArmController({ config: { gravityModel: 'x' } }), /Load gravityModel/);
});

test('loss of a gravity write acknowledgement still removes torque', async () => {
  const r = rig(poses(), configuration(), model()); await r.controller.preflight();
  const command = r.follower.protocol.armCommand;
  r.follower.protocol.armCommand = async (...args) => { await command(...args); if (args[1] === Instruction.ARM_GRAVITY) throw new Error('lost ACK'); };
  await assert.rejects(r.controller.run(), /lost ACK/); assert.equal(torqueOff(r).length, 1);
});

test('runtime gravity ownership loss during a hold stops before the next target', async () => {
  const config = configuration(); config.replay.holdMs = 500;
  const r = rig(poses(), config, model()), feedback = r.follower.arm.feedback;
  r.follower.arm.feedback = async id => ({ ...await feedback(id),
    ...(targets(r).length && r.controller.clock() > 100 ? { gravityReceived: false } : {}) });
  await r.controller.preflight(); await assert.rejects(r.controller.run(), /gravity acceptance/);
  assert.equal(targets(r).length, 1); assert.equal(torqueOff(r).length, 1);
});

test('gravity preview validates dependencies without motor writes and logs model identity', async () => {
  const { run } = require('../../../host/arm-control/session');
  const g = await GravityModel.load(require('node:path').resolve(__dirname, '../../../host/arm-control/models/arm-upright-empty.json'));
  const config = configuration(); delete config.joints;
  config.profiles = Object.fromEntries([1, 2, 3, 4, 5, 6].map(id => [id, { ...profile, effortLimit: 1000 }]));
  const r = rig(poses([1500], [1, 2, 3, 4, 5, 6]), config, g), logs = [];
  const read = r.follower.protocol.read;
  r.follower.protocol.read = async (id, address, length) => {
    const bytes = await read(id, address, length);
    if (address === 0) require('../../../host/servo-driver').RegisterCodec.encode('positionCorrection',
      g.document.encoderCalibration[id].positionCorrection).copy(bytes, 31);
    return bytes;
  };
  await run(config, { source: r.replay, gravity: g, createServo: () => r.follower,
    createController: () => r.controller, output: () => {},
    createLog: async () => ({ filename: 'test', write: async e => logs.push(e), close: async () => {} }) });
  assert.deepEqual(r.calls.map(c => c.type), ['open', 'close']);
  assert.equal(logs.find(e => e.type === 'preflight').gravityModel.sha256, g.identity.sha256);
  const missing = rig(poses([1500], [2]), { ...config, profiles: { 2: profile } }, g);
  await assert.rejects(missing.controller.preflight(), /requires measured motor/);
  assert.equal(missing.calls.length, 0);
});

test('health and gravity use one feedback pass and no tuning telemetry', async () => {
  const r = rig(poses(), configuration(), model()); await r.controller.preflight(); await r.controller.initialize();
  let reads = 0;
  const feedback = r.follower.arm.feedback;
  r.follower.arm.feedback = async id => { reads++; return feedback(id); };
  await r.controller.monitor(); assert.equal(reads, 1);
});

test('confirmation followed immediately by normal completion waits for fresh feedback', async () => {
  const r = rig(poses(), configuration(), model()), feedback = r.follower.arm.feedback;
  r.follower.arm.feedback = async id => {
    const s = await feedback(id), tick = Math.floor(r.controller.clock());
    return { ...s, sampleMs: tick, sampleSequence: tick & 65535 };
  };
  await r.controller.preflight();
  r.controller.source.play = async () => {};
  await r.controller.run(); assert.equal(torqueOff(r).length, 0);
});

test('group torque enable prevents later joints drifting during earlier readiness checks', async () => {
  const ids = [1, 2, 3, 4, 5, 6], config = configuration(); delete config.joints;
  config.profiles = Object.fromEntries(ids.map(id => [id, profile]));
  const r = rig(poses([1500], ids), config, model(ids));
  const sleep = r.controller.sleep, feedback = r.follower.arm.feedback;
  r.controller.sleep = async ms => {
    for (const motor of r.motors.values()) if (!motor.torque) motor.position = 4001;
    await sleep(ms);
  };
  r.follower.arm.feedback = async id => ({ ...await feedback(id),
    ...(r.motors.get(id).position > 4000 ? { armed: false, session: 0 } : {}) });
  await r.controller.preflight(); await r.controller.run();
  assert.equal(r.calls.filter(c => c.type === 'enable-group').length, 1);
  assert.deepEqual(r.calls.find(c => c.type === 'enable-group').ids, ids);
  assert.equal(torqueOff(r).length, 0);
});

for (const failure of ['broadcast', 'last motor']) test(`group enable ${failure} failure cleans up every prepared motor`, async () => {
  const ids = [1, 2, 3], config = configuration(); delete config.joints;
  config.profiles = Object.fromEntries(ids.map(id => [id, profile]));
  const r = rig(poses([1500], ids), config, model(ids)); await r.controller.preflight();
  if (failure === 'broadcast') r.follower.protocol.syncWrite = async () => { throw new Error('uncertain transmission'); };
  else {
    const feedback = r.follower.arm.feedback;
    r.follower.arm.feedback = async id => ({ ...await feedback(id), ...(id === 3 ? { armed: false } : {}) });
  }
  await assert.rejects(r.controller.run(), /uncertain transmission|startup ownership/);
  assert.equal(targets(r).length, 0); assert.deepEqual(torqueOff(r).map(c => c.id), ids);
});

test('calibration mismatch prevents all setup and motion writes', async () => {
  for (const address of [31, 18]) {
    const r = rig(poses(), configuration(), model()), read = r.follower.protocol.read;
    r.follower.protocol.read = async (id, start, length) => {
      const bytes = await read(id, start, length);
      if (start === 0) bytes[address] = address === 18 ? 0x80 : 1;
      return bytes;
    };
    await assert.rejects(r.controller.preflight(), /calibration mismatch/);
    assert.equal(r.calls.length, 0);
  }
});

for (const stage of ['readiness', 'gravity confirmation']) test(`interrupted grouped startup during ${stage} removes torque without a target`, async () => {
  const r = rig(poses(), configuration(), model()); await r.controller.preflight();
  const sleep = r.controller.sleep;
  if (stage === 'readiness') r.controller.sleep = async ms => { await sleep(ms); r.controller.stopping = true; };
  await assert.rejects(r.controller.run({ onTelemetry: () => {
    if (stage === 'gravity confirmation') r.controller.stopping = true;
  } }), /Startup cancelled/);
  assert.equal(targets(r).length, 0); assert.equal(torqueOff(r).length, 1);
});
