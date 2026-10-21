'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { encodeSign15 } = require('../position');
const { sample, trace, pacedWrite, exercise } = require('../motion');

const SETTINGS = [
  ...Array.from({ length: 22 }, (_, index) => index + 9), // Limits, protection, PID, divisor.
  ...Array.from({ length: 7 }, (_, index) => index + 33), // Mode and velocity gains.
  40, 41, 46, 47, 48, 49, 55,
  ...Array.from({ length: 9 }, (_, index) => index + 78),
];

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function metrics(samples, origin, direction, gain) {
  // Restrict the transfer-function check to active, non-saturated samples.
  // A few milliseconds of telemetry publication skew remain possible.
  const active = samples.filter(value => value.elapsedMs >= 80 &&
    Math.abs(value.activeVelocity) >= 100 && Math.abs(value.pwm) < 580);
  const residuals = active.map(value => Math.abs(value.pwm -
    Math.trunc(gain * (value.position - value.activePosition) / 4)));
  return {
    activeSamples: active.length,
    medianPwmResidual: median(residuals),
    p90PwmResidual: residuals.length ?
      [...residuals].sort((a, b) => a - b)[Math.floor(0.9 * (residuals.length - 1))] : null,
    peakPwm: Math.max(...samples.map(value => Math.abs(value.pwm))),
    peakTrackingError: Math.max(...samples.map(value =>
      Math.abs(value.position - value.activePosition))),
    travel: direction * (samples.at(-1).position - origin),
    peakSpeed: Math.max(...samples.map(value => Math.abs(value.speed))),
  };
}

async function trial(rig, id, { gain, direction, speed, acceleration, durationMs }) {
  await rig.write(id, 40, [0]);
  await delay(100);
  await pacedWrite(rig, id, 21, [gain]);
  await pacedWrite(rig, id, 41, [acceleration]);
  await pacedWrite(rig, id, 46, encodeSign15(speed));
  const registers = await rig.read(id, 0, 87);
  assert.equal(registers[21], gain, 'position P readback');
  assert.equal(registers[41], acceleration, 'acceleration readback');
  assert.equal(registers[40], 0, 'torque before trial');
  const settings = Object.fromEntries(SETTINGS.map(address => [address, registers[address]]));
  const origin = (await sample(rig, id)).position;
  const distance = 1024;
  await rig.write(id, 42, encodeSign15(origin + direction * distance));
  const samples = await trace(rig, id, durationMs, 12);
  return { gain, direction, speed, acceleration, distance, origin, settings,
    ...metrics(samples, origin, direction, gain), samples };
}

async function positionPMatrix(context) {
  return exercise(context, 0, async (rig, id, before) => {
    assert.ok(before[18] & 0x10, 'P diagnostic requires signed telemetry');
    await pacedWrite(rig, id, 22, [0, 0, 0]); // D, I, punch.
    await pacedWrite(rig, id, 26, [0, 0]); // Both deadzones.
    await pacedWrite(rig, id, 48, [138, 2]); // Output cap 650.
    const trials = [];
    for (const { speed, acceleration, durationMs } of [
      { speed: 1200, acceleration: 40, durationMs: 1800 },
      { speed: 3000, acceleration: 80, durationMs: 1200 },
    ]) {
      for (const direction of [1, -1]) {
        for (const gain of [0, 4, 32]) {
          trials.push(await trial(rig, id,
            { gain, direction, speed, acceleration, durationMs }));
        }
      }
    }
    for (const value of trials) {
      assert.ok(value.activeSamples >= 10,
        `insufficient active, unsaturated samples: speed ${value.speed}, P ${value.gain}`);
    }
    return { exact: { trials: trials.length, settingsCaptured: true },
      evidence: { trials } };
  });
}

function compare(factory, candidate) {
  const checks = [];
  const left = factory.evidence.trials;
  const right = candidate.evidence.trials;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    const label = `${a.speed}/${a.direction > 0 ? '+' : '-'}${a.distance}/P${a.gain}`;
    const differentSettings = SETTINGS.filter(address =>
      a.settings[address] !== b.settings[address]);
    checks.push({ name: `${label} settings`, factory: 'matched',
      candidate: differentSettings, matched: differentSettings.length === 0 });
    for (const [name, tolerance] of [
      ['medianPwmResidual', 18], ['p90PwmResidual', 30],
      ['travel', 120], ['peakSpeed', 450],
    ]) {
      checks.push({ name: `${label} ${name}`, factory: a[name], candidate: b[name],
        tolerance, matched: Number.isFinite(a[name]) && Number.isFinite(b[name]) &&
          Math.abs(a[name] - b[name]) <= tolerance });
    }
  }
  return { matched: checks.every(check => check.matched), checks };
}

module.exports = [{ id: 'test_position_p_transfer_matrix', scope: 'device', risk: 'motion',
  stages: ['register-behavior'],
  covers: { modes: [0], registers: [21, 22, 23, 24, 26, 27, 41, 46, 47, 48, 49] },
  compare, run: positionPMatrix }];
