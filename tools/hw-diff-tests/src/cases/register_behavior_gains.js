'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { encodeSign15 } = require('../position');
const { withinTolerance } = require('../measurements');
const { sample, trace, pacedWrite, exercise } = require('../motion');

function compare(factory, candidate) {
  const a = factory.evidence;
  const b = candidate.evidence;
  const checks = [
    ['baseline peak PWM', a.baseline.peakPwm, b.baseline.peakPwm, 100],
    ['changed peak PWM', a.changed.peakPwm, b.changed.peakPwm, 100],
    ['restored peak PWM', a.restored.peakPwm, b.restored.peakPwm, 100],
    ['gain treatment effect', a.treatmentEffect, b.treatmentEffect, 40],
  ].map(([name, factoryValue, candidateValue, tolerance]) => ({
    name, factory: factoryValue, candidate: candidateValue, tolerance,
    matched: withinTolerance(factoryValue, candidateValue, tolerance),
  }));
  if (Number.isFinite(a.trackingEffect) && Number.isFinite(b.trackingEffect)) {
    checks.push({ name: 'tracking-error treatment effect', factory: a.trackingEffect,
      candidate: b.trackingEffect, tolerance: 30,
      matched: Math.abs(a.trackingEffect - b.trackingEffect) <= 30 });
  }
  return { matched: checks.every(check => check.matched), checks };
}

async function positionTrial(rig, id, gain) {
  await rig.write(id, 40, [0]);
  await delay(100);
  await pacedWrite(rig, id, 21, [gain]);
  assert.equal((await rig.read(id, 21, 1))[0], gain, 'position P write did not read back');
  const origin = (await sample(rig, id)).position;
  await rig.write(id, 42, encodeSign15(origin + 256));
  const samples = await trace(rig, id, 850, 15);
  const early = samples.filter(value => value.elapsedMs <= 120);
  return { gain, origin, peakPwm: Math.max(...early.map(value => Math.abs(value.pwm))),
    fullPeakPwm: Math.max(...samples.map(value => Math.abs(value.pwm))),
    peakTrackingError: Math.max(...samples.map(value =>
      Math.abs(value.position - value.activePosition))),
    finalError: Math.abs(samples.at(-1).position - origin - 256), samples };
}

async function positionGain(context) {
  return exercise(context, 0, async (rig, id, before) => {
    assert.ok(before[18] & 0x10, 'position P case requires signed telemetry');
    assert.ok(before[21] > 8, 'position P baseline too small for contrast');
    await pacedWrite(rig, id, 22, [0]);
    await pacedWrite(rig, id, 23, [0]);
    await pacedWrite(rig, id, 24, [0]);
    await pacedWrite(rig, id, 26, [0, 0]);
    await pacedWrite(rig, id, 41, [30]);
    await pacedWrite(rig, id, 46, encodeSign15(600));
    await pacedWrite(rig, id, 48, [44, 1]);
    const baseline = await positionTrial(rig, id, before[21]);
    const changed = await positionTrial(rig, id, 4);
    const restored = await positionTrial(rig, id, before[21]);
    const treatmentEffect = baseline.peakPwm - changed.peakPwm;
    const trackingEffect = changed.peakTrackingError - baseline.peakTrackingError;
    if (context.role === 'factory') {
      assert.ok(treatmentEffect >= 10 && trackingEffect >= 20,
        `factory position P stimulus ineffective: PWM ${treatmentEffect}, tracking ${trackingEffect}`);
      assert.ok(Math.abs(restored.peakPwm - baseline.peakPwm) <= 35,
        'position P baseline did not return after restoring gain');
    }
    return { exact: { threeTrials: true, changedGain: 4, restoredGain: before[21],
      gainReadback: true },
      evidence: { baseline, changed, restored, treatmentEffect, trackingEffect } };
  });
}

async function velocityTrial(rig, id, gain) {
  await rig.write(id, 40, [0]);
  await delay(170);
  await pacedWrite(rig, id, 37, [gain]);
  assert.equal((await rig.read(id, 37, 1))[0], gain, 'velocity P write did not read back');
  await rig.write(id, 46, encodeSign15(5000));
  const samples = await trace(rig, id, 1050, 15);
  return { gain, peakPwm: Math.max(...samples.map(value => Math.abs(value.pwm))),
    peakSpeed: Math.max(...samples.map(value => value.speed)),
    peakProfileSpeed: Math.max(...samples.map(value => value.activeVelocity)), samples };
}

async function velocityGain(context) {
  return exercise(context, 1, async (rig, id, before) => {
    assert.ok(before[37] > 5, 'speed P baseline too small for contrast');
    await pacedWrite(rig, id, 39, [0]);
    await pacedWrite(rig, id, 24, [0]);
    await pacedWrite(rig, id, 41, [20]);
    await pacedWrite(rig, id, 48, [144, 1]); // Output cap 400.
    const baseline = await velocityTrial(rig, id, before[37]);
    const changed = await velocityTrial(rig, id, 3);
    const restored = await velocityTrial(rig, id, before[37]);
    const treatmentEffect = baseline.peakPwm - changed.peakPwm;
    if (context.role === 'factory') {
      assert.ok(baseline.peakPwm >= 30 && baseline.peakProfileSpeed >= 1000,
        'velocity P baseline did not excite a measurable output/profile');
      assert.ok(treatmentEffect >= 15,
        `velocity P stimulus had only ${treatmentEffect} PWM effect`);
      assert.ok(Math.abs(restored.peakPwm - baseline.peakPwm) <= 60,
        'velocity P baseline did not return after restoring gain');
    }
    return { exact: { threeTrials: true, changedGain: 3, restoredGain: before[37],
      gainReadback: true },
      evidence: { baseline, changed, restored, treatmentEffect } };
  });
}

module.exports = [
  { id: 'test_position_p_gain_contrast', scope: 'device', risk: 'motion',
    stages: ['register-behavior'], covers: { modes: [0], registers: [21, 22, 23, 24, 26, 27] },
    compare, run: positionGain },
  { id: 'test_velocity_p_gain_contrast', scope: 'device', risk: 'motion',
    stages: ['register-behavior'], covers: { modes: [1], registers: [24, 37, 39] },
    compare, run: velocityGain },
];
