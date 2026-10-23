'use strict';

const assert = require('node:assert/strict');
const { positionDelta, nearbyLogicalPosition, encodeSign15 } = require('../position');
const { withinTolerance } = require('../measurements');
const { sample, trace, pacedWrite, exercise } = require('../motion');

function compareMeasurements(measurements) {
  const checks = measurements.map(([name, factory, candidate, tolerance]) => ({
    name, factory, candidate, tolerance,
    matched: withinTolerance(factory, candidate, tolerance),
  }));
  return { matched: checks.every(check => check.matched), checks };
}

function peakAbs(samples, key) {
  return Math.max(...samples.map(sample => Math.abs(sample[key])));
}

function timeToDisplacement(evidence, threshold) {
  return evidence.samples.find(sample =>
    positionDelta(sample.position, evidence.baseline.position, evidence.signed) >= threshold)?.elapsedMs;
}

function comparePosition(factory, candidate) {
  const a = factory.evidence;
  const b = candidate.evidence;
  return compareMeasurements([
    ['shaft displacement', a.peakPosition, b.peakPosition, 35],
    ['profile displacement', a.peakActive, b.peakActive, 12],
    ['time to 100 ticks', timeToDisplacement(a, 100), timeToDisplacement(b, 100), 150],
    ['peak speed', peakAbs(a.samples, 'speed'), peakAbs(b.samples, 'speed'), 100],
  ]);
}

function compareVelocity(factory, candidate) {
  const a = factory.evidence.segments;
  const b = candidate.evidence.segments;
  return compareMeasurements([
    ['positive profiled speed', Math.max(...a[0].samples.map(s => s.activeVelocity)),
      Math.max(...b[0].samples.map(s => s.activeVelocity)), 60],
    ['negative profiled speed', Math.min(...a[1].samples.map(s => s.activeVelocity)),
      Math.min(...b[1].samples.map(s => s.activeVelocity)), 60],
    ['positive measured speed', peakAbs(a[0].samples, 'speed'), peakAbs(b[0].samples, 'speed'), 100],
    ['negative measured speed', peakAbs(a[1].samples, 'speed'), peakAbs(b[1].samples, 'speed'), 100],
    ['zero-goal tail speed', a[2].samples.at(-1).activeVelocity,
      b[2].samples.at(-1).activeVelocity, 50],
  ]);
}

function comparePwm(factory, candidate) {
  const a = factory.evidence.segments;
  const b = candidate.evidence.segments;
  return compareMeasurements([
    ['positive PWM', Math.max(...a[0].samples.map(s => s.pwm)),
      Math.max(...b[0].samples.map(s => s.pwm)), 10],
    ['negative PWM', Math.min(...a[1].samples.map(s => s.pwm)),
      Math.min(...b[1].samples.map(s => s.pwm)), 10],
    ['zero-goal tail PWM', a[2].samples.at(-1).pwm,
      b[2].samples.at(-1).pwm, 5],
    ['peak measured speed', peakAbs(a[0].samples, 'speed'),
      peakAbs(b[0].samples, 'speed'), 100],
  ]);
}

function compareRelative(factory, candidate) {
  const a = factory.evidence.segments;
  const b = candidate.evidence.segments;
  return compareMeasurements(a.flatMap((segment, index) => [
    [`goal ${segment.goal} peak error`, segment.peakError, b[index].peakError, 20],
    [`goal ${segment.goal} final error`, segment.finalError, b[index].finalError, 10],
    [`goal ${segment.goal} peak profiled speed`, peakAbs(segment.samples, 'activeVelocity'),
      peakAbs(b[index].samples, 'activeVelocity'), 60],
  ]));
}

async function positionMode(rig, id, before) {
  await pacedWrite(rig, id, 41, [20]);
  await pacedWrite(rig, id, 46, encodeSign15(400));
  await pacedWrite(rig, id, 48, [244, 1]); // Live output cap 500.
  const baseline = await sample(rig, id);
  const signed = (before[18] & 0x10) !== 0;
  const goal = nearbyLogicalPosition(baseline.position, signed) + 256;
  await rig.write(id, 42, encodeSign15(goal));
  const samples = await trace(rig, id, 1350);
  const peakPosition = Math.max(...samples.map(value =>
    positionDelta(value.position, baseline.position, signed)));
  const peakActive = Math.max(...samples.map(value =>
    positionDelta(value.activePosition, baseline.activePosition, signed)));
  assert.ok(peakActive >= 150, `mode 0 profile advanced only ${peakActive} ticks`);
  assert.ok(peakPosition >= 100, `mode 0 shaft moved only ${peakPosition} ticks`);
  return { exact: { mode: 0, profileAdvanced: true, shaftMoved: true },
    evidence: { baseline, goal, signed, peakPosition, peakActive, samples } };
}

async function velocityMode(rig, id) {
  await pacedWrite(rig, id, 41, [10]);
  await pacedWrite(rig, id, 48, [44, 1]); // Output cap 300.
  const segments = [];
  for (const goal of [400, -400, 0]) {
    await rig.write(id, 46, encodeSign15(goal));
    segments.push({ goal, samples: await trace(rig, id, goal === 0 ? 450 : 650) });
  }
  assert.ok(segments[0].samples.some(value => value.activeVelocity > 0),
    'mode 1 never produced positive active velocity');
  assert.ok(segments[1].samples.some(value => value.activeVelocity < 0),
    'mode 1 never produced negative active velocity');
  assert.ok(Math.abs(segments[2].samples.at(-1).activeVelocity) <= 50,
    'mode 1 did not decelerate after zero goal');
  return { exact: { mode: 1, positive: true, negative: true, zeroSettled: true },
    evidence: { segments } };
}

async function pwmMode(rig, id) {
  await pacedWrite(rig, id, 48, [150, 0]);
  const segments = [];
  for (const [goal, bytes] of [[80, [80, 0]], [-80, [80, 4]], [0, [0, 0]]]) {
    await rig.write(id, 44, bytes);
    segments.push({ goal, samples: await trace(rig, id, goal === 0 ? 220 : 450) });
  }
  assert.ok(segments[0].samples.some(value => value.pwm > 0),
    'mode 2 never produced positive PWM');
  assert.ok(segments[1].samples.some(value => value.pwm < 0),
    'mode 2 never produced negative PWM');
  assert.equal(segments[2].samples.at(-1).pwm, 0,
    'mode 2 did not clear PWM after zero goal');
  return { exact: { mode: 2, positive: true, negative: true, zeroSettled: true },
    evidence: { segments } };
}

async function relativeMode(rig, id) {
  await pacedWrite(rig, id, 41, [20]);
  await pacedWrite(rig, id, 46, encodeSign15(400));
  await pacedWrite(rig, id, 48, [44, 1]);
  const segments = [];
  for (const goal of [256, -256]) {
    await rig.write(id, 42, encodeSign15(goal));
    const samples = await trace(rig, id, 1600);
    const peakError = Math.max(...samples.map(value => Math.abs(value.position)));
    const finalError = Math.abs(samples.at(-1).position);
    assert.ok(peakError >= 100, `relative mode did not expose goal ${goal}`);
    assert.ok(finalError <= 15, `relative goal ${goal} did not settle: ${finalError}`);
    segments.push({ goal, peakError, finalError, samples });
  }
  return { exact: { mode: 3, bothGoalsObserved: true, bothSettled: true },
    evidence: { segments } };
}

module.exports = [
  { id: 'test_mode0_position_motion', scope: 'device', risk: 'motion',
    stages: ['mode-motion'], covers: { modes: [0], registers: [41, 42, 46, 48] },
    compare: comparePosition,
    run: context => exercise(context, 0, positionMode) },
  { id: 'test_mode1_velocity_reversal', scope: 'device', risk: 'motion',
    stages: ['mode-motion'], covers: { modes: [1], registers: [33, 41, 46, 48] },
    compare: compareVelocity,
    run: context => exercise(context, 1, velocityMode) },
  { id: 'test_mode2_pwm_reversal', scope: 'device', risk: 'motion',
    stages: ['mode-motion'], covers: { modes: [2], registers: [33, 44, 48] },
    compare: comparePwm,
    run: context => exercise(context, 2, pwmMode) },
  { id: 'test_mode3_relative_motion', scope: 'device', risk: 'motion',
    stages: ['mode-motion'], covers: { modes: [3], registers: [33, 41, 42, 46, 48] },
    compare: compareRelative,
    run: context => exercise(context, 3, relativeMode) },
];
