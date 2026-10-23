'use strict';

const assert = require('node:assert/strict');
const { positionDelta, nearbyLogicalPosition, encodeSign15 } = require('../position');
const { sample, trace, pacedWrite, exercise } = require('../motion');

const settings = [
  { name: 'slow', swipe: 1600, speed: 600, acceleration: 8, durationMs: 4600 },
  { name: 'medium', swipe: 1600, speed: 2200, acceleration: 30, durationMs: 3100 },
  { name: 'fast', swipe: 5000, speed: 5000, acceleration: 80, durationMs: 4000 },
  { name: 'reverse_medium', swipe: -1600, speed: 2200, acceleration: 30, durationMs: 3100 },
  { name: 'reverse_fast', swipe: -5000, speed: 5000, acceleration: 80, durationMs: 4000 },
  { name: 'low_accel', swipe: 1600, speed: 2200, acceleration: 5, durationMs: 4600 },
  { name: 'high_accel', swipe: 1600, speed: 2200, acceleration: 80, durationMs: 3100 },
  { name: 'near_rpm_limit', swipe: 5000, speed: 6000, acceleration: 100, durationMs: 4000 },
  { name: 'reverse_near_rpm_limit', swipe: -5000, speed: 6000, acceleration: 100, durationMs: 4000 },
  { name: 'near_rpm_full_output', swipe: 5000, speed: 6000, acceleration: 100,
    torqueLimit: 1000, durationMs: 4000 },
  { name: 'reverse_near_rpm_full_output', swipe: -5000, speed: 6000, acceleration: 100,
    torqueLimit: 1000, durationMs: 4000 },
  { name: 'matrix_900_accel10', swipe: 2400, speed: 900, acceleration: 10,
    durationMs: 4600 },
  { name: 'matrix_900_accel80', swipe: 2400, speed: 900, acceleration: 80,
    durationMs: 3800 },
  { name: 'matrix_3000_accel10', swipe: 2400, speed: 3000, acceleration: 10,
    durationMs: 4600 },
  { name: 'matrix_3000_accel80', swipe: 2400, speed: 3000, acceleration: 80,
    durationMs: 3200 },
];

function firstAt(samples, threshold) {
  return samples.find(sample => sample.shaft >= threshold)?.elapsedMs;
}

function compare(factory, candidate) {
  const a = factory.evidence;
  const b = candidate.evidence;
  const checks = [
    ['peak shaft displacement', a.peakShaft, b.peakShaft, 120],
    ['peak profile displacement', a.peakProfile, b.peakProfile, 40],
    ['time to 1000 ticks', firstAt(a.samples, 1000), firstAt(b.samples, 1000), 350],
    ['peak profiled speed', a.peakProfileSpeed, b.peakProfileSpeed, 300],
    ['peak measured speed', a.peakMeasuredSpeed, b.peakMeasuredSpeed, 550],
    ['final position error', a.finalError, b.finalError, 70],
  ].map(([name, factoryValue, candidateValue, tolerance]) => ({
    name, factory: factoryValue, candidate: candidateValue, tolerance,
    matched: Number.isFinite(factoryValue) && Number.isFinite(candidateValue) &&
      Math.abs(factoryValue - candidateValue) <= tolerance,
  }));
  return { matched: checks.every(check => check.matched), checks };
}

async function runProfile(context, setting) {
  return exercise(context, 0, async (rig, id, before) => {
    await pacedWrite(rig, id, 41, [setting.acceleration]);
    await pacedWrite(rig, id, 46, encodeSign15(setting.speed));
    const torqueLimit = setting.torqueLimit ?? 650;
    await pacedWrite(rig, id, 48, [torqueLimit & 0xff, torqueLimit >> 8]);
    const baseline = await sample(rig, id);
    const signed = (before[18] & 0x10) !== 0;
    const distance = Math.abs(setting.swipe);
    const direction = Math.sign(setting.swipe);
    assert.ok(distance <= 2048 || signed,
      'long swipe requires signed position mode for unambiguous displacement');
    const goal = nearbyLogicalPosition(baseline.position, signed) + setting.swipe;
    await rig.write(id, 42, encodeSign15(goal));
    const samples = (await trace(rig, id, setting.durationMs)).map(value => ({
      ...value,
      shaft: direction * positionDelta(value.position, baseline.position, signed),
      profile: direction * positionDelta(value.activePosition, baseline.activePosition, signed),
      directedSpeed: direction * value.speed,
      directedProfileSpeed: direction * value.activeVelocity,
    }));
    const peakShaft = Math.max(...samples.map(value => value.shaft));
    const peakProfile = Math.max(...samples.map(value => value.profile));
    const peakProfileSpeed = Math.max(...samples.map(value => value.directedProfileSpeed));
    const peakMeasuredSpeed = Math.max(...samples.map(value => value.directedSpeed));
    const finalError = Math.abs(distance - samples.at(-1).shaft);
    assert.ok(peakProfile >= distance - 400,
      `${setting.name} profile advanced only ${peakProfile} ticks`);
    assert.ok(peakShaft >= distance - 600,
      `${setting.name} shaft moved only ${peakShaft} ticks`);
    assert.ok(finalError <= 120, `${setting.name} final position error ${finalError} ticks`);
    if (setting.name === 'low_accel') {
      assert.ok(peakProfileSpeed < 1200,
        `low acceleration unexpectedly reached ${peakProfileSpeed} ticks/s`);
      assert.ok(firstAt(samples, 1000) >= 1300,
        'low acceleration did not delay the 1000-tick crossing');
    } else if (setting.name === 'high_accel') {
      assert.ok(peakProfileSpeed >= 1800,
        `high acceleration reached only ${peakProfileSpeed} ticks/s`);
      assert.ok(firstAt(samples, 1000) <= 1100,
        'high acceleration was too slow at the 1000-tick crossing');
    }
    return { exact: { profile: setting.name, reached: true, settled: true },
      evidence: { setting, baseline, goal, peakShaft, peakProfile,
        peakProfileSpeed, peakMeasuredSpeed, finalError, samples } };
  });
}

module.exports = settings.map(setting => ({
  id: `test_${setting.name}_long_swipe`, scope: 'device', risk: 'motion',
  stages: setting.name.startsWith('matrix_') ? ['motion-matrix', 'profiles'] : ['profiles'],
  covers: { modes: [0], registers: [41, 42, 46, 48],
    swipeTicks: setting.swipe, speedTicksPerSecond: setting.speed,
    acceleration: setting.acceleration, torqueLimit: setting.torqueLimit ?? 650 },
  compare,
  run: context => runProfile(context, setting),
}));
