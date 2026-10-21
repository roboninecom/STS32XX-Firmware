'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { Instruction } = require('../../../../../host/servo-driver');
const { positionDelta } = require('../position');
const { sample, trace, pacedWrite, exercise } = require('../motion');

async function pulse(rig, id, config) {
  await pacedWrite(rig, id, 18, [config]);
  assert.equal((await rig.read(id, 18, 1))[0], config, 'configuration readback');
  await rig.command(id, Instruction.ENCODER_HOME); // Re-anchor after encoder polarity changes.
  await delay(100);
  const origin = (await sample(rig, id)).position;
  let samples;
  try {
    await rig.write(id, 44, [80, 0]);
    samples = await trace(rig, id, 450, 15);
  } finally {
    await rig.write(id, 44, [0, 0]);
    await rig.write(id, 40, [0]);
  }
  await delay(100);
  return { config, origin,
    rawDisplacement: samples.at(-1).position - origin,
    displacement: positionDelta(samples.at(-1).position, origin, false),
    peakPwm: Math.max(...samples.map(value => Math.abs(value.pwm))),
    peakSpeed: Math.max(...samples.map(value => Math.abs(value.speed))), samples };
}

function comparison(factory, candidate) {
  const checks = [];
  for (const name of ['baseline', 'flipped', 'restored']) {
    const a = factory.evidence[name];
    const b = candidate.evidence[name];
    for (const [metric, tolerance] of [['displacement', 45], ['peakPwm', 5],
      ['peakSpeed', 100]]) {
      checks.push({ name: `${name} ${metric}`, factory: a[metric], candidate: b[metric],
        tolerance, matched: Math.abs(a[metric] - b[metric]) <= tolerance });
    }
  }
  return { matched: checks.every(check => check.matched), checks };
}

function caseFor(name, bit) {
  return { id: `test_config_${name}_reverses_direction`, scope: 'device',
    risk: 'motion', stages: ['register-behavior'],
    covers: { modes: [2], registers: [18, 33, 44, 48, 56, 57, 58, 59, 60, 61] },
    compare: comparison,
    run: context => exercise(context, 2, async (rig, id, before) => {
      assert.ok(before[18] & 0x10, 'direction test requires signed position telemetry');
      await pacedWrite(rig, id, 48, [150, 0]);
      const baseline = await pulse(rig, id, before[18]);
      const flipped = await pulse(rig, id, before[18] ^ bit);
      const restored = await pulse(rig, id, before[18]);
      assert.ok(Math.abs(baseline.displacement) >= 60 &&
        Math.abs(flipped.displacement) >= 60 &&
        Math.abs(restored.displacement) >= 60,
      `${name} pulse produced insufficient displacement`);
      assert.ok(Math.sign(flipped.displacement) === -Math.sign(baseline.displacement) &&
        Math.sign(restored.displacement) === Math.sign(baseline.displacement),
      `${name} did not reverse and restore direction`);
      assert.ok([baseline, flipped, restored].every(value => value.peakPwm === 80),
        `${name} changed commanded PWM magnitude`);
      return { exact: { directionReversed: true, restored: true, unchangedPwm: true },
        evidence: { bit, baseline, flipped, restored } };
    }) };
}

module.exports = [
  caseFor('motor_polarity', 0x01),
  caseFor('encoder_polarity', 0x80),
];
