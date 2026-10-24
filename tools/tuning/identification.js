'use strict';
const fs = require('node:fs');
const { assert, hash, validate } = require('./plan');
const { GravityModel, basis } = require('../../host/arm-control/GravityModel');
const { score } = require('./analysis');

// Average non-overlapping steady-motion windows, not individual correlated ticks.
// The effort observed includes the feedback needed to maintain velocity. Removing
// P/D would discard the very unmodelled load/friction we are identifying.
function extract(files) {
  const rows = [], rejected = {}, sources = []; let featureNames, definition, stage;
  const reject = reason => { rejected[reason] = (rejected[reason] ?? 0) + 1; };
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8'), fileHash = hash(text);
    const events = text.trim().split('\n').map(line => JSON.parse(line));
    const start = events[0], end = events.at(-1);
    assert(start?.type === 'run-start' && hash(start.plan) === start.planHash, 'Identification requires intact plan identity');
    assert(end?.type === 'run-end' && end.summary.status === 'complete', 'Interrupted batches cannot supply identification evidence');
    assert(!sources.length || sources[0].backend === start.backend, 'Cannot mix synthetic and hardware identification');
    const p = validate(start.plan, start.config);
    assert(hash(start.config) === start.configHash, 'Changed controller configuration identity');
    const ids = start.config.joints.map(j => j.followerId);
    if (start.gravityModel) new GravityModel(start.gravityModel);
    const model = start.gravityModel?.models[p.probeId];
    assert(['gravity', 'velocity'].includes(p.stage), 'Extract only gravity/velocity identification stages');
    const def = { stage: p.stage, probeId: p.probeId, terms: p.stage === 'gravity' ? (model?.terms ?? []).map(({ coefficient, ...t }) => t) : [] };
    assert(!definition || hash(definition) === hash(def), 'Cannot mix stages or gravity basis definitions'); definition = def; stage = p.stage;
    if (stage === 'gravity') assert(def.terms.length > 0, 'Declare gravity basis terms (zero initial coefficients allowed)');
    featureNames = [...def.terms.map((_, i) => `gravity:${i}`), 'friction:sign', 'velocity:positive', 'velocity:negative'];
    const pending = new Map();
    for (const e of events) {
      if (e.type === 'trial-start') pending.set(e.trial.id, []);
      if (e.type === 'sample') {
        assert(pending.has(e.trialId), 'Orphan sample'); pending.get(e.trialId).push(e.sample);
      }
      if (e.type !== 'trial-end') continue;
      const trial = e.trial, samples = pending.get(trial.id); assert(samples, 'Missing trial'); pending.delete(trial.id);
      assert(score(samples, trial, p).valid, 'Unusable trial cannot supply identification evidence');
      let window = [];
      for (const s of samples.filter(s => s.t < trial.referenceEndMs)) {
        window.push(s);
        if (window.at(-1).t - window[0].t < 200) continue;
        const w = window; window = [];
        const avg = fn => w.reduce((sum, s) => sum + fn(s), 0) / w.length;
        const v = avg(s => s.measuredVelocityQ8PerS / 256), direction = Math.sign(trial.target - trial.from);
        if (w.some(s => s.saturated)) { reject('saturation'); continue; }
        if (w.some(s => direction * s.measuredVelocityQ8PerS / 256 < 5 || Math.abs(s.measuredVelocityQ8PerS / 256 - v) > Math.abs(v) * 0.15)) { reject('not steady measured motion'); continue; }
        if (w.some(s => Math.abs(s.referenceVelocityQ8PerS / 256 - direction * trial.speed) > trial.speed * 0.05)) { reject('reference accelerating/braking'); continue; }
        if (Math.abs(w.at(-1).measuredPositionQ8 - w[0].measuredPositionQ8) / 256 < Math.abs(v) * 0.15) { reject('insufficient measured displacement'); continue; }
        const seconds = ((w.at(-1).sampleMs - w[0].sampleMs) >>> 0) / 1000;
        const observedSpeed = (w.at(-1).measuredPositionQ8 - w[0].measuredPositionQ8) / 256 / seconds;
        // A slow estimator can look steady while still lagging the actual
        // displacement. Allow one count of endpoint quantization, not a
        // silently biased speed feature for the effort-space regression.
        if (Math.abs(observedSpeed - v) > Math.abs(v) * 0.15 + 1 / seconds) {
          reject('velocity estimator inconsistent with displacement'); continue;
        }
        assert(w.every(s => s.positions && ids.every(id => Number.isFinite(s.positions[id]))), 'Coupled measured positions missing');
        if (ids.filter(id => id !== p.probeId).some(id => Math.max(...w.map(s => s.positions[id])) - Math.min(...w.map(s => s.positions[id])) > 1)) { reject('support joint moving'); continue; }
        const x = [...def.terms.map(t => avg(s => basis(t, s.positions))), direction, Math.max(0, v), Math.min(0, v)];
        rows.push({ split: trial.split === 'screen' ? 'train' : 'validate', group: `${fileHash.slice(0, 12)}:pair${trial.pair}:${trial.split}`, eligible: true,
          x, y: avg(s => s.appliedEffort - (stage === 'velocity' ? s.gravityEffort : 0)),
          source: { file, trial: trial.id, startMs: w[0].t, endMs: w.at(-1).t, speed: trial.speed } });
      }
    }
    assert(!pending.size, 'Incomplete trial in identification batch');
    sources.push({ file, sha256: fileHash, planHash: start.planHash, backend: start.backend });
  }
  const dataset = { version: 1, status: 'unreviewed-dataset', stage, definition, featureNames, rows, rejected, sources,
    extractorSha256: hash(fs.readFileSync(__filename, 'utf8')),
    note: 'Effort-space identification; steady-window assumptions and held-out pose coverage require review. Synthetic sources never qualify hardware.' };
  const fail = message => {
    const error = new Error(message);
    error.diagnostics = { ...dataset, status: 'ineligible-dataset', error: message };
    throw error;
  };
  if (!rows.length) fail('No eligible steady windows; lengthen strokes/reduce speed and inspect rejection reasons: ' + JSON.stringify(rejected));
  for (const split of ['train', 'validate']) {
    const r = rows.filter(r => r.split === split);
    if (![1, -1].every(sign => r.some(row => row.x[definition.terms.length] === sign))) fail(`Both actual directions required in ${split}`);
    if (new Set(r.map(row => row.source.speed)).size < 2) fail(`Multiple speeds required in ${split} to separate friction and velocity terms`);
    for (const direction of [1, -1]) {
      if (new Set(r.filter(row => row.x[definition.terms.length] === direction).map(row => row.source.speed)).size < 2)
        fail(`Multiple speeds required for direction ${direction} in ${split} to separate directional friction and velocity terms`);
    }
  }
  return dataset;
}
module.exports = { extract };
