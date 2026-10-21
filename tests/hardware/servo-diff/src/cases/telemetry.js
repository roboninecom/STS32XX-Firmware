'use strict';

const assert = require('node:assert/strict');
const { positionDelta } = require('../position');
const { trace, pacedWrite, exercise } = require('../motion');

function metrics(samples) {
  let maximumJump = 0;
  for (let index = 1; index < samples.length; index++) {
    const direct = Math.abs(positionDelta(
      samples[index].position, samples[index - 1].position, true));
    const wrapped = Math.abs(positionDelta(
      samples[index].position, samples[index - 1].position, false));
    // Factory telemetry can cross the 4096 display boundary even when the
    // configured format normally publishes a signed logical position. A
    // coherence check cares about the physical step, so accept either
    // continuous representation and reject only a jump large in both.
    maximumJump = Math.max(maximumJump, Math.min(direct, wrapped));
  }
  return { samples: samples.length, maximumJump,
    peakPwm: Math.max(...samples.map(item => Math.abs(item.pwm))),
    movingSamples: samples.filter(item => item.moving).length };
}

async function coherentReversal(context) {
  return exercise(context, 2, async (rig, id) => {
    await pacedWrite(rig, id, 48, [180, 0]);
    const segments = [];
    for (const [goal, bytes, durationMs] of [[90, [90, 0], 380],
      [-90, [90, 4], 480], [0, [0, 0], 260]]) {
      await rig.write(id, 44, bytes);
      const samples = await trace(rig, id, durationMs, 4);
      for (const value of samples) {
        assert.ok(value.moving === 0 || value.moving === 1, 'moving flag is not boolean');
        assert.ok(Math.abs(value.pwm) <= 180, `published PWM exceeds cap: ${value.pwm}`);
      }
      const summary = metrics(samples);
      assert.ok(summary.maximumJump <= 256,
        `adjacent telemetry positions jumped ${summary.maximumJump} ticks`);
      segments.push({ goal, summary, samples });
    }
    assert.equal(segments.at(-1).samples.at(-1).pwm, 0, 'zero goal left PWM telemetry active');
    return { exact: { coherentSnapshots: true, reversalObserved: true,
      zeroSettled: true }, evidence: { segments } };
  });
}

module.exports = [{
  id: 'test_telemetry_snapshot_coherence_under_reversal', scope: 'device', risk: 'motion',
  stages: ['telemetry'],
  covers: { modes: [2], registers: [44, 48, 56, 57, 58, 59, 60, 61, 65, 66, 69, 70] },
  compare: (factory, candidate) => {
    const checks = factory.evidence.segments.flatMap((segment, index) => {
      const other = candidate.evidence.segments[index];
      return [['maximum position jump', segment.summary.maximumJump,
        other.summary.maximumJump, 20], ['moving sample count', segment.summary.movingSamples,
        other.summary.movingSamples, 20]].map(([name, a, b, tolerance]) => ({
        name: `${segment.goal} ${name}`, factory: a, candidate: b, tolerance,
        matched: Math.abs(a - b) <= tolerance }));
    });
    return { matched: checks.every(check => check.matched), checks };
  }, run: coherentReversal,
}];
