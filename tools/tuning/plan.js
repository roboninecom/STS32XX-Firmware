'use strict';
const { createHash } = require('node:crypto');
const { ArmCodec } = require('../../host/servo-driver');
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const METRICS = ['trackingRms', 'holdError', 'holdSpan', 'overshoot', 'settlingMs', 'responseMs', 'saturationFraction'];
const STAGES = ['baseline', 'gravity', 'velocity', 'pid', 'integral', 'validation'];
function keys(value, allowed, name) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `Invalid ${name}`);
  for (const key of Object.keys(value)) assert(allowed.includes(key), `Unknown ${name}.${key}`);
}
function number(value, min, max, name, integer = true) {
  assert(Number.isFinite(value) && (!integer || Number.isInteger(value)) && value >= min && value <= max, `Invalid ${name}`);
}
function validate(plan, config) {
  keys(plan, ['version', 'name', 'config', 'stage', 'probeId', 'poses', 'motion', 'batch', 'sampling', 'limits', 'acceptance', 'candidates'], 'plan');
  assert(plan.version === 2 && typeof plan.name === 'string' && plan.name.trim(), 'Expected named tuning plan version 2');
  assert(typeof plan.config === 'string' && plan.config.trim(), 'Shared controller config path required');
  assert(STAGES.includes(plan.stage), 'Unknown tuning stage');
  number(plan.probeId, 1, 253, 'probeId');
  assert(config.durationMs === undefined, 'Remove durationMs from tuning controller config; use batch.maxDurationMs');
  const ids = config.joints?.map(j => j.followerId);
  assert(ids?.includes(plan.probeId), 'probeId must be a configured follower');
  keys(plan.poses, ['screen', 'validate'], 'poses');
  for (const split of ['screen', 'validate']) {
    const pairs = plan.poses[split];
    assert(Array.isArray(pairs) && pairs.length >= 1 && pairs.length <= 8, `Expected 1–8 ${split} pose pairs`);
    for (const pair of pairs) {
      assert(Array.isArray(pair) && pair.length === 2 && pair[0] !== pair[1], 'Expected distinct endpoint pairs');
      pair.forEach(q => number(q, 0, 32767, 'endpoint'));
    }
  }
  const pairKey = p => [...p].sort((a, b) => a - b).join(':');
  assert(!plan.poses.validate.some(p => plan.poses.screen.some(s => pairKey(p) === pairKey(s))), 'Validation must use different pose pairs');
  keys(plan.motion, ['speeds', 'moveTimeoutMs'], 'motion');
  assert(Array.isArray(plan.motion.speeds) && plan.motion.speeds.length >= 1 && plan.motion.speeds.length <= 4, 'Expected 1–4 speeds');
  assert(new Set(plan.motion.speeds).size === plan.motion.speeds.length, 'Duplicate speeds');
  plan.motion.speeds.forEach(v => number(v, 1, config.profiles[plan.probeId].velocityLimit ?? 65535, 'speed'));
  number(plan.motion.moveTimeoutMs, 500, 60000, 'moveTimeoutMs');
  keys(plan.batch, ['screenRepeats', 'validateRepeats', 'screenHoldMs', 'validateHoldMs', 'finalists', 'maxDurationMs', 'driftRatio'], 'batch');
  for (const split of ['screen', 'validate']) {
    number(plan.batch[`${split}Repeats`], 2, 10, `${split}Repeats`);
    number(plan.batch[`${split}HoldMs`], split === 'screen' ? 500 : 2000, 60000, `${split}HoldMs`);
  }
  assert(plan.batch.validateHoldMs >= plan.batch.screenHoldMs, 'Validation holds must be at least as long as screening');
  number(plan.batch.finalists, 1, 4, 'finalists'); number(plan.batch.maxDurationMs, 1000, 1200000, 'maxDurationMs');
  number(plan.batch.driftRatio, 0.05, 1, 'driftRatio', false);
  keys(plan.sampling, ['intervalMs', 'maxGapMs'], 'sampling');
  number(plan.sampling.intervalMs, 25, 50, 'intervalMs'); number(plan.sampling.maxGapMs, plan.sampling.intervalMs * 2, 200, 'maxGapMs');
  keys(plan.limits, ['followingError', 'supportError', 'maxTemperature', 'minVoltageRaw', 'maxVoltageRaw'], 'limits');
  number(plan.limits.followingError, 1, 1000, 'followingError'); number(plan.limits.supportError, 1, 1000, 'supportError');
  number(plan.limits.maxTemperature, 20, 60, 'maxTemperature');
  number(plan.limits.minVoltageRaw, 1, 254, 'minVoltageRaw');
  number(plan.limits.maxVoltageRaw, plan.limits.minVoltageRaw + 1, 255, 'maxVoltageRaw');
  keys(plan.acceptance, [...METRICS, 'settleBand', 'settleDwellMs'], 'acceptance');
  for (const key of METRICS) number(plan.acceptance[key], 0.001, key === 'saturationFraction' ? 1 : 60000, key, false);
  number(plan.acceptance.settleBand, 0, 1000, 'settleBand', false); number(plan.acceptance.settleDwellMs, 100, plan.batch.screenHoldMs, 'settleDwellMs');
  assert(Array.isArray(plan.candidates) && plan.candidates.length <= 8, 'At most eight explicit candidates');
  assert(new Set(plan.candidates.map(c => c.name)).size === plan.candidates.length, 'Duplicate candidate names');
  const allowed = { baseline: [], gravity: [], velocity: ['velocityFeedforward'], pid: ['kpQ8', 'kdQ8', 'velocityFilterQ8'],
    integral: ['kiQ8', 'integralLimit'], validation: [] }[plan.stage];
  for (const candidate of plan.candidates) {
    keys(candidate, ['name', 'changes'], 'candidate');
    assert(typeof candidate.name === 'string' && /^[a-zA-Z0-9_-]{1,48}$/.test(candidate.name) && candidate.name !== 'baseline', 'Invalid candidate name');
    keys(candidate.changes, allowed, 'changes'); assert(Object.keys(candidate.changes).length, 'Empty candidate');
    if (candidate.changes.velocityFeedforward) keys(candidate.changes.velocityFeedforward, ['positiveGainQ8', 'negativeGainQ8', 'effortLimit'], 'velocityFeedforward');
    ArmCodec.encodeConfig(candidateProfile(config, plan.probeId, candidate.changes));
  }
  return plan;
}
function candidateProfile(config, id, changes = {}) {
  return { ...config.profiles[id], velocityLimit: config.profiles[id].velocityLimit ?? 65535,
    accelerationLimit: config.acceleration, rampTimeMs: config.rampTimeMs, ...changes };
}
function estimate(plan, config) {
  const n = config.joints.length, hz = 1000 / plan.sampling.intervalMs;
  // One C2 replaces C1 for the probe. Gravity uses existing measured samples.
  const bytesPerSecond = hz * (70 + (n - 1) * 48 + (config.gravityModel ? n * 18 : 0));
  const blocks = plan.candidates.length ? (plan.candidates.length + Math.min(plan.batch.finalists, plan.candidates.length)) * 3 : 2;
  return { bytesPerSecond, wireUtilization: bytesPerSecond * 10 / (config.baudRate ?? 1000000),
    maxDurationMs: plan.batch.maxDurationMs, blocks };
}
module.exports = { validate, candidateProfile, estimate, hash, assert, METRICS, STAGES };
