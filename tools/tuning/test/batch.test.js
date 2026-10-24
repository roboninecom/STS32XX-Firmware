'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { rig, poses, configuration } = require('../../teleoperation/test/fake-arm');
const { ArmController } = require('../../../host/arm-control/ArmController');
const { BatchSource } = require('../BatchSource');
const { validate } = require('../plan');
const { analyse, execute } = require('../cli');
const { score, fit } = require('../analysis');
function fixture() {
  const plan = structuredClone(require('../example.json')), config = configuration();
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
test('plans reject obsolete fields, leaked validation and unbounded candidates', () => {
  const { plan, config } = fixture();
  for (const change of [p => { p.heartbeat = 50; }, p => { p.poses.validate = p.poses.screen; },
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
      createController: options => new ArmController({ ...options, source: options.replay, clock: r.controller.clock, sleep: r.controller.sleep }) });
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
