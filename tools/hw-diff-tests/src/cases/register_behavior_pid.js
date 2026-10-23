'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { encodeSign15 } = require('../position');
const { sample, trace, pacedWrite, exercise } = require('../motion');

function peakPwm(samples) { return Math.max(...samples.map(value => Math.abs(value.pwm))); }
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function compareEffects(names) {
  return (factory, candidate) => {
    const checks = names.map(([name, tolerance]) => ({
      name, factory: factory.evidence[name], candidate: candidate.evidence[name], tolerance,
    }));
    for (const check of checks) {
      check.matched = Number.isFinite(check.factory) && Number.isFinite(check.candidate) &&
        Math.abs(check.factory - check.candidate) <= check.tolerance;
    }
    return { matched: checks.every(check => check.matched), checks };
  };
}

function compareDeadzones(factory, candidate) {
  const a = factory.evidence.trials;
  const b = candidate.evidence.trials;
  const checks = a.flatMap((trial, index) => [
    { name: `${trial.direction > 0 ? 'positive' : 'negative'} open PWM`,
      factory: trial.open.peakPwm, candidate: b[index].open.peakPwm, tolerance: 45 },
    { name: `${trial.direction > 0 ? 'positive' : 'negative'} blocked PWM`,
      factory: trial.blocked.peakPwm, candidate: b[index].blocked.peakPwm, tolerance: 8 },
  ]);
  for (const check of checks) {
    check.matched = Number.isFinite(check.factory) && Number.isFinite(check.candidate) &&
      Math.abs(check.factory - check.candidate) <= check.tolerance;
  }
  return { matched: checks.every(check => check.matched), checks };
}

async function positionStep(rig, id, direction, size, durationMs = 350) {
  await rig.write(id, 40, [0]);
  await delay(85);
  const origin = (await sample(rig, id)).position;
  await rig.write(id, 42, encodeSign15(origin + direction * size));
  const samples = await trace(rig, id, durationMs, 6);
  return { origin, direction, size, peakPwm: peakPwm(samples), samples };
}

async function deadzones(context) {
  return exercise(context, 0, async (rig, id, before) => {
    assert.ok(before[18] & 0x10, 'deadzone test requires signed position telemetry');
    await pacedWrite(rig, id, 21, [64]);
    await pacedWrite(rig, id, 22, [0, 0, 0]); // D, I, output bias.
    await pacedWrite(rig, id, 41, [40]);
    await pacedWrite(rig, id, 46, encodeSign15(1200));
    await pacedWrite(rig, id, 48, [44, 1]);
    const trials = [];
    for (const direction of [1, -1]) {
      const address = direction > 0 ? 27 : 26;
      await pacedWrite(rig, id, 26, [0, 0]);
      const open = await positionStep(rig, id, direction, 16);
      await pacedWrite(rig, id, address, [32]);
      assert.equal((await rig.read(id, address, 1))[0], 32);
      const blocked = await positionStep(rig, id, direction, 16);
      trials.push({ direction, address, open, blocked,
        effect: open.peakPwm - blocked.peakPwm });
    }
    if (context.role === 'factory') {
      for (const trial of trials) {
        assert.ok(trial.open.peakPwm >= 30 && trial.blocked.peakPwm <= 8,
          `factory deadzone stimulus ineffective in direction ${trial.direction}`);
      }
    }
    return { exact: { bothDirections: true, deadzoneReadback: true },
      evidence: { trials, positiveEffect: trials[0].effect,
        negativeEffect: trials[1].effect } };
  });
}

async function derivative(context) {
  return exercise(context, 0, async (rig, id, before) => {
    assert.ok(before[18] & 0x10, 'derivative test requires signed position telemetry');
    await pacedWrite(rig, id, 21, [0, 0, 0, 0]); // P, D, I, output bias.
    await pacedWrite(rig, id, 26, [0, 0]);
    await pacedWrite(rig, id, 80, [0, 1]); // No delta deadband; sample every tick.
    await pacedWrite(rig, id, 41, [80]);
    await pacedWrite(rig, id, 46, encodeSign15(1200));
    await pacedWrite(rig, id, 48, [44, 1]);
    const zero = await positionStep(rig, id, 1, 256, 500);
    await pacedWrite(rig, id, 22, [128]);
    assert.equal((await rig.read(id, 22, 1))[0], 128);
    const enabled = await positionStep(rig, id, 1, 256, 500);
    const effect = enabled.peakPwm - zero.peakPwm;
    if (context.role === 'factory') {
      assert.ok(zero.peakPwm <= 5 && effect >= 20,
        `factory D stimulus ineffective: zero ${zero.peakPwm}, effect ${effect}`);
    }
    return { exact: { derivativeReadback: true, twoTrials: true },
      evidence: { zero, enabled, effect } };
  });
}

async function integral(context) {
  return exercise(context, 0, async (rig, id, before) => {
    assert.ok(before[18] & 0x10, 'integral test requires signed position telemetry');
    await pacedWrite(rig, id, 21, [0, 0, 0, 0, 0]); // P, D, I, bias, clamp.
    await pacedWrite(rig, id, 26, [0, 0]);
    await pacedWrite(rig, id, 41, [80]);
    await pacedWrite(rig, id, 46, encodeSign15(1200));
    await pacedWrite(rig, id, 48, [44, 1]);
    const trials = [];
    for (let repetition = 0; repetition < 3; repetition++) {
      await pacedWrite(rig, id, 23, [0]);
      await pacedWrite(rig, id, 25, [0]);
      const zero = await positionStep(rig, id, 1, 64, 420);
      await pacedWrite(rig, id, 23, [80]);
      await pacedWrite(rig, id, 25, [5]);
      const clamped = await positionStep(rig, id, 1, 64, 420);
      await pacedWrite(rig, id, 25, [0]);
      const free = await positionStep(rig, id, 1, 64, 420);
      trials.push({ repetition, zero, clamped, free,
        clampEffect: free.peakPwm - clamped.peakPwm,
        integralEffect: free.peakPwm - zero.peakPwm });
    }
    const zeroPeak = median(trials.map(item => item.zero.peakPwm));
    const clampedPeak = median(trials.map(item => item.clamped.peakPwm));
    const freePeak = median(trials.map(item => item.free.peakPwm));
    const clampEffect = median(trials.map(item => item.clampEffect));
    const integralEffect = median(trials.map(item => item.integralEffect));
    if (context.role === 'factory') {
      assert.ok(zeroPeak <= 5 && clampedPeak <= 25 && clampEffect >= 30,
        `factory I/clamp stimulus ineffective: ${zeroPeak}/${clampedPeak}/${freePeak}`);
    }
    return { exact: { integralAndClampReadback: true, repetitions: trials.length },
      evidence: { trials, zeroPeak, clampedPeak, freePeak, clampEffect, integralEffect } };
  });
}

async function speedIntegral(context) {
  return exercise(context, 1, async (rig, id) => {
    await pacedWrite(rig, id, 37, [0]);
    await pacedWrite(rig, id, 39, [0]);
    await pacedWrite(rig, id, 24, [0]);
    await pacedWrite(rig, id, 41, [40]);
    await pacedWrite(rig, id, 48, [44, 1]);
    async function trial() {
      await rig.write(id, 40, [0]);
      await delay(120);
      await rig.write(id, 46, encodeSign15(3000));
      const samples = await trace(rig, id, 850, 10);
      return { peakPwm: peakPwm(samples),
        peakProfileSpeed: Math.max(...samples.map(value => value.activeVelocity)), samples };
    }
    const zero = await trial();
    await pacedWrite(rig, id, 39, [120]);
    assert.equal((await rig.read(id, 39, 1))[0], 120);
    const enabled = await trial();
    const effect = enabled.peakPwm - zero.peakPwm;
    if (context.role === 'factory') {
      assert.ok(zero.peakPwm <= 5 && effect >= 20,
        `factory velocity I stimulus ineffective: ${zero.peakPwm}/${enabled.peakPwm}`);
    }
    return { exact: { speedIReadback: true, twoTrials: true },
      evidence: { zero, enabled, effect } };
  });
}

module.exports = [
  { id: 'test_position_deadzone_directions', scope: 'device', risk: 'motion',
    stages: ['register-behavior'], covers: { modes: [0], registers: [21, 26, 27] },
    compare: compareDeadzones, run: deadzones },
  { id: 'test_position_derivative_term', scope: 'device', risk: 'motion',
    stages: ['register-behavior'], covers: { modes: [0], registers: [22, 80, 81] },
    compare: compareEffects([['effect', 50]]), run: derivative },
  { id: 'test_position_integral_clamp', scope: 'device', risk: 'motion',
    stages: ['register-behavior'], covers: { modes: [0], registers: [23, 25] },
    compare: compareEffects([['clampEffect', 75], ['integralEffect', 75]]), run: integral },
  { id: 'test_velocity_integral_term', scope: 'device', risk: 'motion',
    stages: ['register-behavior'], covers: { modes: [1], registers: [39] },
    compare: compareEffects([['effect', 75]]), run: speedIntegral },
];
