'use strict';

const assert = require('node:assert/strict');
const { sample, trace, pacedWrite, exercise } = require('../motion');

function compare(factory, candidate) {
  const checks = factory.evidence.levels.map((level, index) => ({
    name: `PWM at cap ${level.cap}`,
    factory: level.peakPwm,
    candidate: candidate.evidence.levels[index].peakPwm,
    tolerance: 15,
  }));
  checks.push({ name: 'torque-gated PWM',
    factory: factory.evidence.gatedPwm,
    candidate: candidate.evidence.gatedPwm,
    tolerance: 5 });
  for (const check of checks) {
    check.matched = Number.isFinite(check.factory) && Number.isFinite(check.candidate) &&
      Math.abs(check.factory - check.candidate) <= check.tolerance;
  }
  return { matched: checks.every(check => check.matched), checks };
}

module.exports = [{
  id: 'test_runtime_torque_limit_and_gate', scope: 'device', risk: 'motion',
  stages: ['torque'], covers: { modes: [2], registers: [40, 44, 48, 60] },
  compare,
  run: context => exercise(context, 2, async (rig, id) => {
    await pacedWrite(rig, id, 48, [100, 0]);
    await rig.write(id, 44, [244, 1]); // Positive PWM goal 500.
    const levels = [];
    for (const cap of [100, 300, 500]) {
      if (cap !== 100) await pacedWrite(rig, id, 48, [cap & 0xff, cap >> 8]);
      const samples = await trace(rig, id, 200);
      const peakPwm = Math.max(...samples.map(value => value.pwm));
      assert.ok(peakPwm >= cap - 10 && peakPwm <= cap,
        `PWM ${peakPwm} did not follow torque limit ${cap}`);
      levels.push({ cap, peakPwm, samples });
    }
    await pacedWrite(rig, id, 40, [2]);
    const gated = await trace(rig, id, 130);
    const gatedPwm = gated.at(-1).pwm;
    assert.equal(gatedPwm, 0, 'torque state 2 did not gate PWM output');
    assert.equal((await rig.read(id, 40, 1))[0], 2);
    await rig.write(id, 44, [0, 0]);
    assert.equal((await sample(rig, id)).status, 0);
    return { exact: { capsFollowed: true, torqueGateStoppedOutput: true },
      evidence: { levels, gatedPwm, gated } };
  }),
}];
