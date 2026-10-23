'use strict';

const assert = require('node:assert/strict');
const { encodeSign15 } = require('../position');
const { compareEvidence } = require('../measurements');
const { sample, trace, pacedWrite, exercise } = require('../motion');

const u16 = value => [value & 0xff, value >> 8];
const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ±${tolerance}, got ${actual}`);

async function limits(context) {
  return exercise(context, 0, async (rig, id, before) => {
    assert.ok(before[18] & 0x10, 'angle-limit case requires signed position telemetry');
    await pacedWrite(rig, id, 41, [30]);
    await pacedWrite(rig, id, 46, encodeSign15(700));
    await pacedWrite(rig, id, 48, u16(500));
    const origin = (await sample(rig, id)).position;
    assert.ok(origin >= 0 && origin <= 32000, 'unsafe origin for bounded angle limits');
    const minimum = Math.max(0, origin - 150);
    const maximum = Math.max(origin + 150, 300);
    await pacedWrite(rig, id, 9, [...u16(minimum), ...u16(maximum)]);
    const segments = [];
    for (const [name, requested, expected, durationMs] of [
      ['upper', maximum + 200, maximum, 1400],
      ['lower', minimum - 200, minimum, 1400],
    ]) {
      await rig.write(id, 42, encodeSign15(requested));
      const samples = await trace(rig, id, durationMs);
      near(samples.at(-1).activePosition, expected, 8, `${name} active target`);
      near(samples.at(-1).position, expected, 35, `${name} shaft`);
      segments.push({ name, requested, expected, samples });
    }
    await pacedWrite(rig, id, 9, [0, 0, 0, 0]); // Equal limits disable clamp.
    await rig.write(id, 42, encodeSign15(maximum + 200));
    const unrestricted = await trace(rig, id, 1650);
    near(unrestricted.at(-1).activePosition, maximum + 200, 8, 'equal-limit active target');
    near(unrestricted.at(-1).position, maximum + 200, 35, 'equal-limit shaft');
    return { exact: { lowerClamped: true, upperClamped: true, equalLimitsDisabled: true },
      evidence: { origin, minimum, maximum, segments, unrestricted,
        upperError: segments[0].samples.at(-1).position - maximum,
        lowerError: segments[1].samples.at(-1).position - minimum,
        unrestrictedError: unrestricted.at(-1).position - maximum - 200 } };
  });
}

async function divisor(context) {
  return exercise(context, 0, async (rig, id, before) => {
    assert.ok(before[18] & 0x10, 'scaling case requires signed position telemetry');
    assert.equal(before[30], 1, 'scaling case requires divisor 1 at entry');
    await pacedWrite(rig, id, 41, [30]);
    await pacedWrite(rig, id, 46, encodeSign15(700));
    await pacedWrite(rig, id, 48, u16(500));
    const origin = (await sample(rig, id)).position;
    assert.ok(origin >= -30000 && origin <= 30000, 'unsafe origin for scaled goal');
    await pacedWrite(rig, id, 30, [2]);
    const scaledStart = await sample(rig, id);
    near(scaledStart.position, Math.trunc(origin / 2), 3, 'divided position telemetry');
    const requested = Math.trunc(origin / 2) + 120;
    await rig.write(id, 42, encodeSign15(requested));
    const samples = await trace(rig, id, 1200);
    const final = samples.at(-1);
    near(final.activePosition, requested, 8, 'scaled active target');
    near(final.position, requested, 30, 'scaled shaft');
    await rig.write(id, 30, [0]);
    const normalized = (await rig.read(id, 30, 1))[0];
    if (normalized === 0) await sample(rig, id);
    assert.equal((await rig.read(id, 30, 1))[0], 1,
      'zero divisor was not normalized by telemetry');
    return { exact: { positionHalved: true, goalScaled: true, zeroNormalized: true },
      evidence: { origin, scaledStart, requested, final, samples,
        halfError: scaledStart.position - Math.trunc(origin / 2),
        finalError: Math.abs(final.position - requested) } };
  });
}

module.exports = [
  { id: 'test_position_angle_limits', scope: 'device', risk: 'motion',
    stages: ['register-behavior'], covers: { modes: [0], registers: [9, 10, 11, 12, 42, 43] },
    compare: compareEvidence([['upperError', 35], ['lowerError', 35], ['unrestrictedError', 35]]),
    run: limits },
  { id: 'test_position_scaling_divisor', scope: 'device', risk: 'motion',
    stages: ['register-behavior'], covers: { modes: [0], registers: [30, 42, 43, 56, 57, 67, 68] },
    compare: compareEvidence([['halfError', 3], ['finalError', 20]]),
    run: divisor },
];
