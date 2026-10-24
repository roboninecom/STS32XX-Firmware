'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { extract } = require('../identification');
const { hash } = require('../plan');
const { fit } = require('../analysis');
const { configuration } = require('../../teleoperation/test/fake-arm');

test('current batch evidence extracts directional steady windows and fits held-out data', t => {
  const plan = structuredClone(require('../example.json')), config = configuration();
  plan.stage = 'velocity'; plan.candidates = []; plan.motion.speeds = [100, 200];
  const events = [{ type: 'run-start', backend: 'hardware', plan, config, planHash: hash(plan), configHash: hash(config) }];
  let id = 0;
  for (const split of ['screen', 'validate']) for (const speed of [100, 200]) for (const direction of [1, -1]) {
    const from = direction === 1 ? 1000 : 1400, target = from + direction * speed;
    const trial = { id: ++id, candidate: 'baseline', split, from, target, speed, pair: 0, holdMs: 2000, referenceEndMs: 1000 };
    events.push({ type: 'trial-start', trial });
    for (let ms = 0; ms <= 3000; ms += 50) {
      const q = from + direction * speed * Math.min(ms, 1000) / 1000;
      events.push({ type: 'sample', trialId: id, sample: { t: ms, hostMs: ms, sampleMs: ms, sampleSequence: ms / 50,
        session: 1, acceptedSequence: 1, ageMs: 0, measuredPositionQ8: q * 256, referencePositionQ8: q * 256,
        measuredVelocityQ8PerS: ms < 1000 ? direction * speed * 256 : 0, referenceVelocityQ8PerS: ms < 1000 ? direction * speed * 256 : 0,
        positions: { 1: q }, fresh: true, armed: true, driveEnabled: true, outputReady: true, faults: 0, temperatureValid: true,
        temperatureValidated: 30, saturated: false, gravityEffort: 5, appliedEffort: 5 + direction * 3 + (direction === 1 ? 0.1 : 0.2) * direction * speed } });
    }
    events.push({ type: 'trial-end', trial });
  }
  events.push({ type: 'run-end', summary: { status: 'complete', trials: id } });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-fit-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'events.ndjson'), save = () => fs.writeFileSync(file, events.map(e => JSON.stringify(e)).join('\n'));
  save(); const dataset = extract([file]), result = fit(dataset);
  assert(dataset.rows.length > 20); assert(Math.abs(result.coefficients['velocity:positive'] - 0.1) < 1e-8);
  assert(Math.abs(result.coefficients['velocity:negative'] - 0.2) < 1e-8); assert(result.validation.rms < 1e-8);
  events.at(-1).summary.status = 'failed'; save(); assert.throws(() => extract([file]), /Interrupted/);
});
