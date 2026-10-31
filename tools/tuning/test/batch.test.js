'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { rig, poses, configuration } = require('../../../host/arm-control/test/fake-arm');
const { ArmController } = require('../../../host/arm-control/ArmController');
const { BatchSource } = require('../BatchSource');
const { validate } = require('../plan');
const { analyse, execute, main } = require('../cli');
const { score, fit } = require('../analysis');
function fixture() {
  const plan = structuredClone(require('../example.json')), config = configuration();
  config.joints = config.joints.map(({ followerId }) => ({ followerId }));
  plan.batch.screenHoldMs = 500; plan.batch.validateHoldMs = 2000;
  plan.config = 'unused'; config.acceleration = 500;
  const r = rig(poses(), config), events = [];
  const feedback = r.follower.arm.feedback;
  r.follower.arm.tuning = async id => { const s = await feedback(id); return { ...s, voltageRaw: 120,
    referencePositionQ8: s.measuredPositionQ8, referenceVelocityQ8PerS: 0,
    overrunCount: 0, gravityEffort: 0, appliedEffort: 0, saturated: false }; };
  const write = r.follower.protocol.write;
  r.follower.protocol.write = async (id, address, data, options) => {
    await write(id, address, data, options);
    if (address === 40 && data[0] === 1) r.motors.get(id).sequence = 0;
  };
  const source = new BatchSource(plan, config, { record: e => events.push(structuredClone(e)) });
  const controller = new ArmController({ follower: r.follower, source, config, clock: r.controller.clock, sleep: r.controller.sleep });
  return { ...r, controller, source, plan, config, events };
}
test('one shared controller runs screening, held-out validation and restores baseline', async () => {
  const r = fixture(); validate(r.plan, r.config);
  await r.controller.preflight(); await r.controller.run();
  assert.equal(r.source.summary.status, 'complete'); assert.equal(r.source.summary.trials, 24);
  assert.equal(r.source.summary.validation.length, 1); assert.equal(r.source.summary.recommendation, null);
  assert.equal(r.controller.profiles[1].kpQ8, r.config.profiles[1].kpQ8);
  assert.equal(r.motors.get(1).torque, 1);
  const trials = r.events.filter(e => e.type === 'trial-end');
  assert(trials.every(e => e.trial.result.valid));
  assert(trials.some(e => e.trial.from > e.trial.target)); assert(trials.some(e => e.trial.from < e.trial.target));
});

for (const changed of [false, true]) test(`next tuning batch automatically continues with ${changed ? 'changed' : 'unchanged'} baseline settings`, async () => {
  const r = fixture(); r.plan.candidates = [];
  await r.controller.preflight(); await r.controller.run();
  const config = structuredClone(r.config);
  if (changed) config.profiles[1].kpQ8 += 256;
  // Firmware decode order differs from configuration JSON order.
  const read = r.follower.arm.configuration;
  r.follower.arm.configuration = async id => Object.fromEntries(Object.entries(await read(id)).reverse());
  const source = new BatchSource(r.plan, config);
  const c = new ArmController({ follower: r.follower, source, config,
    clock: r.controller.clock, sleep: r.controller.sleep });
  await c.preflight(); const before = r.calls.length;
  await c.run();
  assert.equal(source.summary.status, 'complete');
  assert.equal(c.session, r.controller.session);
  assert.equal(r.motors.get(1).config.kpQ8, config.profiles[1].kpQ8);
  const releases = r.calls.slice(before).filter(c => c.type === 'write' && c.address === 40 && c.value === 0);
  assert.equal(releases.length, changed ? 1 : 0);
});
test('plans reject obsolete fields, leaked validation and unbounded candidates', () => {
  const { plan, config } = fixture();
  for (const change of [p => { p.heartbeat = 50; }, p => { p.poses.support = { 1: 1000 }; }, p => { p.poses.validate = p.poses.screen; },
    p => { p.candidates[0].changes.effortLimit = 1000; }, p => { p.motion.speeds = [NaN]; },
    p => { p.candidates[0].changes.timeoutMs = 100; }]) {
    const bad = structuredClone(plan); change(bad); assert.throws(() => validate(bad, config));
  }
});
test('limits cap endpoints before execution and report the effective path', async () => {
  const r = fixture(); r.plan.poses.screen = [[50, 200]]; r.plan.poses.validate = [[150, 250]];
  await r.controller.preflight(); assert.equal(r.source.cappedTargets, 1); assert.deepEqual(r.source.poses.screen, [[100, 200]]);
});
test('overrun and logger failure cause shared torque-off cleanup', async () => {
  for (const mode of ['overrun', 'logger']) {
    const r = fixture(); let count = 0;
    if (mode === 'logger') r.source.record = event => { if (event.type === 'sample') throw Error('disk failed'); };
    else { const read = r.follower.arm.tuning; r.follower.arm.tuning = async id => ({ ...await read(id), overrunCount: ++count > 8 ? 1 : 0 }); }
    await r.controller.preflight(); await assert.rejects(r.controller.run(), mode === 'logger' ? /disk failed/ : /overrun/);
    assert.equal(r.motors.get(1).torque, 0); assert.equal(r.source.summary.status, 'incomplete');
  }
});
test('batch timeout and cancellation cannot become a completed recommendation', async () => {
  for (const mode of ['budget', 'cancel']) {
    const r = fixture(); r.plan.batch.maxDurationMs = mode === 'budget' ? 100 : 100000;
    await r.controller.preflight(); await assert.rejects(r.controller.run({ shouldStop: () => mode === 'cancel' && r.controller.clock() > 150 }), /budget|interrupted/);
    assert.equal(r.motors.get(1).torque, 0); assert.equal(r.source.summary.recommendation, null);
  }
});
test('CLI records replayable evidence and read-only preflight sends no writes', async t => {
  for (const move of [false, true]) {
    const r = fixture(); r.plan.candidates = [];
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-tune-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    await execute(r, { move, directory, output: () => {}, createServo: () => r.follower,
      createController: options => new ArmController({ ...options, source: options.source, clock: r.controller.clock, sleep: r.controller.sleep }) });
    const result = analyse(path.join(directory, 'events.ndjson'));
    assert.equal(result.complete, move);
    if (!move) assert(!r.calls.some(c => ['write', 'configure', 'select'].includes(c.type)));
    else {
      assert.equal(result.trials.length, 8);
      const file = path.join(directory, 'events.ndjson'); let raw = fs.readFileSync(file, 'utf8');
      fs.writeFileSync(file, raw.trim().split('\n').slice(0, -1).join('\n'));
      assert.equal(analyse(file).complete, false);
    }
  }
});
test('scoring does not credit an early crossing followed by a long-hold oscillation', () => {
  const { plan } = fixture(), trial = { from: 1000, target: 1100, referenceEndMs: 500, holdMs: 2000 };
  const samples = Array.from({ length: 51 }, (_, i) => ({ t: i*50, hostMs: i*50, sampleMs: i*50, sampleSequence: i,
    session: 1, acceptedSequence: 1, ageMs: 0, fresh: true, armed: true, driveEnabled: true, outputReady: true,
    measuredPositionQ8: (i < 35 ? 1100 : i%2 ? 1080 : 1120)*256, referencePositionQ8: 1100*256,
    referenceVelocityQ8PerS: 0, temperatureValidated: 30, temperatureValid: true, faults: 0 }));
  const result = score(samples, trial, plan);
  assert.equal(result.valid, true); assert.equal(result.passed, false); assert.equal(result.metrics.responseMs, null);
  assert.equal(result.metrics.holdSpan, 40);
});
test('identification fitting rejects trajectory leakage and rank deficiency', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ split: i<8?'train':'validate', group: i<8?'a':'b', eligible:true, x:[1,i], y:2+3*i }));
  const dataset = { version:1, featureNames:['bias','velocity'], rows };
  const result = fit(dataset); assert(Math.abs(result.coefficients.velocity - 3) < 1e-9);
  const bad = structuredClone(dataset); bad.rows[9].group = 'a'; assert.throws(() => fit(bad), /leak/);
  bad.rows = rows.map(r => ({...r,x:[1,1]})); assert.throws(() => fit(bad), /Rank/);
});

test('final summary write failure still turns off motors before the serial port closes', async t => {
  const r = fixture(); r.plan.candidates = [];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-tune-final-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'summary.json')); // A deterministic final-write failure.
  await assert.rejects(execute(r, { move: true, directory, output: () => {}, createServo: () => r.follower,
    createController: options => new ArmController({ ...options, source: options.source,
      clock: r.controller.clock, sleep: r.controller.sleep }) }), /EISDIR/);
  assert.equal(r.motors.get(1).torque, 0);
  assert.equal(analyse(path.join(directory, 'events.ndjson')).complete, false);
});


test('run accepts a plan directly and rejects extra execution flags before opening a port', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-tune-cli-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const missing = path.join(directory, 'missing.json');
  await assert.rejects(main(['run', missing]), { code: 'ENOENT' });
  await assert.rejects(main(['run', missing, '--execute']), /npm run tune/);
  await assert.rejects(main(['run', missing, '--resume']), /npm run tune/);
});

test('stationary tests retain current firmware targets without a setup move', async () => {
  const r = fixture(); r.plan.candidates = [];
  await r.controller.preflight(); await r.controller.run();
  const targets = r.calls.filter(c => c.type === 'target');
  assert.equal(targets[0].position, r.plan.poses.screen[0][0]);
  assert(r.events.some(e => e.type === 'support-ready' && e.targets[1] === 1000));
  assert.equal(r.motors.get(1).torque, 1);
});
test('recapturing a batch preserves the hold target despite steady position error', async () => {
  const r = fixture(); await r.controller.preflight(); await r.controller.initialize();
  const read = r.follower.arm.tuning;
  r.follower.arm.tuning = async id => ({ ...await read(id), referencePositionQ8: 1020 * 256 });
  r.source.block = async () => {};
  r.plan.candidates = [];
  await r.source.play(r.controller, { shouldStop: () => false, onTelemetry: () => {} });
  assert.equal(r.source.anchors[1], 1020);
});

test('crossing the settling band does not manufacture a large physical baseline drift', () => {
  const { drift } = require('../analysis'), { plan } = fixture();
  plan.batch.driftRatio = 0.35;
  const before = { valid: true, worst: { trackingRms: 41, holdError: 12, holdSpan: 1,
    overshoot: 0, settlingMs: null, responseMs: null, saturationFraction: 0 } };
  const after = { valid: true, worst: { ...before.worst, holdError: 9, settlingMs: 77, responseMs: 1048 } };
  const result = drift(before, after, plan);
  assert.equal(result.stable, true); assert(result.incomparable.includes('settlingMs'));
  after.worst.trackingRms = 80; assert.equal(drift(before, after, plan).stable, false);
});
test('inconclusive comparison stops further experiments and retains powered hold', async () => {
  const r = fixture();
  r.source.compareCandidates = async () => [{ stability: { stable: false }, eligible: false }];
  await r.controller.preflight(); await r.controller.run();
  assert.equal(r.source.summary.status, 'inconclusive');
  assert.equal(r.source.summary.recommendation, null);
  assert.equal(r.motors.get(1).torque, 1);
});
test('long holds do not dilute moving saturation', () => {
  const { plan } = fixture(), trial = { from: 1000, target: 1100, referenceEndMs: 500, holdMs: 2000 };
  const samples = Array.from({length: 51}, (_, i) => ({t:i*50,hostMs:i*50,sampleMs:i*50,sampleSequence:i,
    session:1,acceptedSequence:1,ageMs:0,fresh:true,armed:true,driveEnabled:true,outputReady:true,
    measuredPositionQ8:1100*256,referencePositionQ8:1100*256,referenceVelocityQ8PerS:0,
    measuredVelocityQ8PerS:0,temperatureValidated:30,temperatureValid:true,faults:0,saturated:i<10}));
  assert.equal(score(samples,trial,plan).metrics.saturationFraction,1);
});

test('candidate batches share baseline brackets and restore baseline once per split', async () => {
  const r = fixture();
  r.plan.candidates.push({ name: 'p2', changes: { kpQ8: 512 } }, { name: 'p3', changes: { kpQ8: 768 } });
  await r.controller.preflight(); await r.controller.run();
  assert.equal(r.source.summary.screen.length, 3);
  const blocks = r.source.blocks.filter(b => b.split === 'screen');
  assert.deepEqual(blocks.map(b => b.role), ['before', 'candidate', 'candidate', 'candidate', 'after']);
  assert.equal(r.source.summary.trials, 32); // Five screening blocks plus three validation blocks.
  assert.equal(r.controller.profiles[1].kpQ8, r.config.profiles[1].kpQ8);
  assert.equal(r.motors.get(1).torque, 1);
});

test('baseline drift allows encoder quantization but rejects a growing hold oscillation', () => {
  const { drift } = require('../analysis'), { plan } = fixture();
  plan.acceptance.holdSpan = 2;
  const worst = Object.fromEntries(Object.keys(plan.acceptance).map(k => [k, 0]));
  const before = { valid: true, worst: { ...worst, holdSpan: 1 } };
  const after = { valid: true, worst: { ...worst, holdSpan: 0 } };
  assert.equal(drift(before, after, plan).stable, true);
  after.worst.holdSpan = 4;
  assert.equal(drift(before, after, plan).stable, false);
});

test('tuning reuses a completed endpoint hold without duplicate setup commands', async () => {
  const r = fixture(); r.plan.candidates = [];
  await r.controller.preflight(); await r.controller.run();
  const commands = r.events.filter(e => e.type === 'trial-start');
  assert.equal(commands.length, 8);
  const sent = r.calls.filter(c => c.type === 'target');
  // Eight scored moves plus one setup per repeat. Returning to the current
  // endpoint needs no extra target or delay; every scored hold remains intact.
  assert.equal(sent.length, 12);
  assert(r.events.filter(e => e.type === 'trial-end').every(e => e.trial.result.valid));
});

test('short screening defers holding criteria, but validation enforces them after settling', () => {
  const { plan } = fixture(); Object.assign(plan.acceptance, { holdError: 3, holdSpan: 2, overshoot: 10, settlingMs: 1500 });
  const make = (end, persistent) => Array.from({ length: end / 25 + 1 }, (_, i) => {
    const t = i * 25, oscillating = t >= 500 && (persistent || t < 1700);
    return { t, hostMs: t, sampleMs: t, sampleSequence: i, session: 1, acceptedSequence: 1,
      ageMs: 0, fresh: true, armed: true, driveEnabled: true, outputReady: true,
      measuredPositionQ8: (1100 + (oscillating ? (i % 2 ? 6 : -6) : 0)) * 256,
      referencePositionQ8: 1100 * 256, referenceVelocityQ8PerS: 0,
      temperatureValidated: 30, temperatureValid: true, faults: 0 };
  });
  const trial = { from: 1000, target: 1100, referenceEndMs: 500, holdMs: 500, split: 'screen' };
  const screen = score(make(1000, true), trial, plan);
  assert.equal(screen.passed, true); assert(screen.deferredMetrics.includes('holdSpan'));
  const validation = { ...trial, holdMs: 2000, split: 'validate' };
  assert.equal(score(make(2500, false), validation, plan).passed, true);
  const bad = score(make(2500, true), validation, plan);
  assert.equal(bad.passed, false); assert(bad.failures.includes('holdSpan'));
  assert.deepEqual(bad.deferredMetrics, []);
});

// Load the published plan through the real path resolver, including its shared profile.
test('published tuning example needs only follower IDs', async () => {
  const { load } = require('../cli');
  const { plan, config } = await load(path.resolve(__dirname, '../example.json'));
  assert.deepEqual(config.joints, [{ followerId: 1 }]);
  assert.equal(config.profiles[1].velocityLimit, 500);
  const r = rig(poses(), config);
  const source = new BatchSource(plan, config);
  const controller = new ArmController({ follower: r.follower, source, config });
  await controller.preflight();
  assert.equal(controller.joints[0].leaderId, undefined);
});
