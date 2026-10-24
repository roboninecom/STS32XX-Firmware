'use strict';
const { METRICS, assert } = require('./plan');
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const rms = a => Math.sqrt(mean(a.map(x => x * x)));
const median = a => { const s = [...a].sort((x, y) => x - y); return (s[Math.floor(s.length / 2)] + s[Math.floor((s.length - 1) / 2)]) / 2; };

function score(samples, trial, plan) {
  const reasons = [], a = plan.acceptance;
  if (samples.length < 10) return { valid: false, passed: false, reasons: ['too few samples'] };
  const numeric = ['t', 'hostMs', 'sampleMs', 'sampleSequence', 'ageMs', 'measuredPositionQ8', 'referencePositionQ8', 'referenceVelocityQ8PerS', 'temperatureValidated', 'session', 'acceptedSequence'];
  if (!Number.isFinite(trial.referenceEndMs) || samples.some(s => numeric.some(k => !Number.isFinite(s[k])))) return { valid: false, passed: false, reasons: ['missing/nonfinite evidence'] };
  if (samples.some(s => s.session !== samples[0].session || s.acceptedSequence !== samples[0].acceptedSequence)) reasons.push('control identity changed within trial');
  const move = samples.filter(s => s.t < trial.referenceEndMs), hold = samples.filter(s => s.t >= trial.referenceEndMs);
  if (hold.length < 5 || hold.at(-1).t - hold[0].t < trial.holdMs - plan.sampling.maxGapMs) reasons.push('incomplete hold');
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].t - samples[i - 1].t;
    const ticks = (samples[i].sampleMs - samples[i - 1].sampleMs) >>> 0;
    const seq = (samples[i].sampleSequence - samples[i - 1].sampleSequence) & 0xffff;
    if (dt <= 0 || dt > plan.sampling.maxGapMs || !ticks || ticks > plan.sampling.maxGapMs || !seq || seq > 32767) reasons.push('sample gap/duplicate/out-of-order');
  }
  if (samples.some(s => !s.armed || !s.driveEnabled || !s.outputReady || !s.fresh || s.ageMs > 2 || s.faults || !s.temperatureValid)) reasons.push('unusable control sample');
  if (!hold.length) return { valid: false, passed: false, reasons: [...new Set([...reasons, 'no hold'])] };
  const errors = samples.map(s => Math.abs(s.measuredPositionQ8 / 256 - trial.target));
  // Settling is the beginning of the FINAL in-band suffix. Early crossings are
  // deliberately not credited, and the suffix must last the requested dwell.
  let lastOutside = -1;
  errors.forEach((e, i) => { if (e > a.settleBand) lastOutside = i; });
  const settled = samples[lastOutside + 1];
  const responseMs = settled && samples.at(-1).t - settled.t >= a.settleDwellMs ? settled.t : null;
  // Separate sustained holding from the permitted post-reference settling time.
  // Keep at least half of a short screening hold; long validation uses all of
  // the remaining hold, so slow oscillations cannot hide in a one-second tail.
  const steady = hold.filter(s => s.t >= trial.referenceEndMs + Math.min(a.settlingMs, trial.holdMs / 2));
  if (!steady.length) return { valid: false, passed: false, reasons: ['no steady hold'] };
  const q = steady.map(s => s.measuredPositionQ8 / 256);
  const direction = Math.sign(trial.target - trial.from);
  const metrics = {
    trackingRms: move.length ? rms(move.map(s => (s.referencePositionQ8 - s.measuredPositionQ8) / 256)) : 0,
    holdError: Math.max(...steady.map(s => Math.abs(s.measuredPositionQ8 / 256 - trial.target))),
    holdSpan: Math.max(...q) - Math.min(...q),
    overshoot: Math.max(0, ...samples.map(s => direction * (s.measuredPositionQ8 / 256 - trial.target))),
    settlingMs: responseMs === null ? null : Math.max(0, responseMs - trial.referenceEndMs),
    responseMs,
    saturationFraction: samples.filter(s => s.saturated).length / samples.length,
  };
  const failures = METRICS.filter(k => metrics[k] === null || metrics[k] > a[k]);
  return { valid: !reasons.length, passed: !reasons.length && !failures.length, reasons: [...new Set(reasons)], failures, metrics,
    score: responseMs === null ? null : Math.max(...METRICS.map(k => metrics[k] / a[k])),
    observation: { samples: samples.length, referenceEndMs: trial.referenceEndMs,
      temperatureMax: Math.max(...samples.map(s => s.temperatureValidated)),
      holdDrift: q.at(-1) - q[0], maxGapMs: Math.max(...samples.slice(1).map((s, i) => s.t - samples[i].t)) } };
}
function aggregate(trials) {
  const valid = trials.length > 0 && trials.every(t => t.result.valid);
  return { valid, passed: valid && trials.every(t => t.result.passed), trials: trials.length,
    score: valid && trials.every(t => t.result.score !== null) ? median(trials.map(t => t.result.score)) : null,
    worst: valid ? Object.fromEntries(METRICS.map(k => [k, trials.some(t => t.result.metrics[k] === null) ? null : Math.max(...trials.map(t => t.result.metrics[k]))])) : null,
    failures: [...new Set(trials.flatMap(t => [...(t.result.failures ?? []), ...t.result.reasons]))] };
}
function drift(before, after, plan) {
  if (!before.valid || !after.valid) return { stable: false, reason: 'invalid bracketing baseline' };
  const changes = Object.fromEntries(METRICS.map(k => [k, before.worst[k] === null || after.worst[k] === null
    ? (before.worst[k] === after.worst[k] ? 0 : 1)
    : Math.abs(after.worst[k] - before.worst[k]) / Math.max(plan.acceptance[k], before.worst[k])]));
  return { stable: Object.values(changes).every(x => x <= plan.batch.driftRatio), changes };
}

// Offline identification takes independently labelled TRAIN and held-out groups,
// never random rows from the same trajectory. Modified Gram-Schmidt with a second
// orthogonalization pass avoids normal-equation squaring of the condition number.
function fit(dataset) {
  assert(dataset.status !== 'ineligible-dataset', 'Cannot fit an ineligible identification dataset');
  assert(dataset.version === 1 && Array.isArray(dataset.featureNames) && dataset.featureNames.length > 0 && dataset.featureNames.length <= 20, 'Invalid identification dataset');
  assert(new Set(dataset.featureNames).size === dataset.featureNames.length, 'Duplicate feature names');
  const rows = dataset.rows, n = dataset.featureNames.length;
  assert(Array.isArray(rows) && rows.length > n + 2 && rows.length <= 20000, 'Insufficient identification data');
  const groups = new Map();
  for (const r of rows) {
    assert(['train', 'validate'].includes(r.split) && typeof r.group === 'string' && r.group.length > 0, 'Rows require split and whole-trajectory group');
    assert(!groups.has(r.group) || groups.get(r.group) === r.split, 'A trajectory group cannot leak across splits'); groups.set(r.group, r.split);
    assert(r.eligible === true && Array.isArray(r.x) && r.x.length === n && r.x.every(Number.isFinite) && Number.isFinite(r.y), 'Only explicitly eligible, finite steady-motion rows can be fitted');
  }
  const train = rows.filter(r => r.split === 'train'), validation = rows.filter(r => r.split === 'validate');
  assert(train.length >= n * 2 && validation.length >= 2, 'Need >=2 rows per feature and >=2 held-out rows');
  const q = [], R = Array.from({ length: n }, () => Array(n).fill(0));
  const scales = Array.from({ length: n }, (_, j) => Math.hypot(...train.map(r => r.x[j])));
  for (let j = 0; j < n; j++) {
    assert(scales[j] > 1e-12, 'Unexcited feature');
    const v = train.map(r => r.x[j] / scales[j]);
    for (let pass = 0; pass < 2; pass++) for (let k = 0; k < j; k++) {
      const projection = v.reduce((s, x, i) => s + x * q[k][i], 0); R[k][j] += projection;
      for (let i = 0; i < v.length; i++) v[i] -= projection * q[k][i];
    }
    R[j][j] = Math.hypot(...v); assert(R[j][j] > 1e-6, 'Rank-deficient or poorly excited model');
    q.push(v.map(x => x / R[j][j]));
  }
  const c = q.map(col => col.reduce((s, x, i) => s + x * train[i].y, 0));
  for (let j = n - 1; j >= 0; j--) {
    for (let k = j + 1; k < n; k++) c[j] -= R[j][k] * c[k];
    c[j] /= R[j][j];
  }
  const coefficients = c.map((x, i) => x / scales[i]);
  const residual = data => {
    const e = data.map(r => r.y - r.x.reduce((s, x, j) => s + x * coefficients[j], 0));
    return { count: e.length, rms: rms(e), maxAbs: Math.max(...e.map(Math.abs)) };
  };
  return { version: 1, status: 'unreviewed-fit', sources: dataset.sources ?? [], definition: dataset.definition,
    evidenceKind: dataset.sources?.length && dataset.sources.every(s => s.backend === 'hardware') ? 'hardware-observations-unreviewed' : 'unqualified-offline', coefficients: Object.fromEntries(dataset.featureNames.map((name, i) => [name, coefficients[i]])), train: residual(train), validation: residual(validation), groups: Object.fromEntries(groups), note: 'Effort-space fit; not joint torque or automatic stage approval.' };
}
module.exports = { score, aggregate, drift, fit };
