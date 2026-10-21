'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { positionDelta } = require('../position');
const { sample, exercise } = require('../motion');
const { encodeSign15, decodeOffset } = require('../position');


async function offsetLiveWrite(context) {
  return exercise(context, 0, async (rig, id, before) => {
    assert.ok(before[18] & 0x10, 'offset test requires signed telemetry');
    const original = before[31] | (before[32] << 8);
    const marker = [original + 64, original - 64].find(value =>
      value >= 0 && value < 0x2000 &&
      Math.abs(decodeOffset(original) - decodeOffset(value)) === 64);
    assert.ok(marker != null, 'no safe 64-tick offset marker for current encoding');
    const expectedShift = decodeOffset(original) - decodeOffset(marker);
    assert.equal(Math.abs(expectedShift), 64);
    const baseline = await sample(rig, id);
    assert.equal(baseline.status, 0);
    await rig.write(id, 31, [marker & 0xff, marker >> 8]);
    await delay(55);
    const shifted = await sample(rig, id);
    assert.equal(shifted.status, 0);
    assert.deepEqual([...await rig.read(id, 31, 2)], [marker & 0xff, marker >> 8]);
    const observedShift = positionDelta(shifted.position, baseline.position, false);
    assert.ok(Math.abs(observedShift - expectedShift) <= 4,
      `offset live write shifted ${observedShift} ticks, expected ${expectedShift}`);
    assert.equal(shifted.pwm, 0, 'offset write drove motor with torque off');
    await rig.write(id, 31, [before[31], before[32]]);
    await delay(55);
    const restored = await sample(rig, id);
    assert.deepEqual([...await rig.read(id, 31, 2)], [before[31], before[32]]);
    const residual = positionDelta(restored.position, baseline.position, false);
    assert.ok(Math.abs(residual) <= 4, `offset live restoration left ${residual} ticks`);
    return { exact: { markerReadback: true, liveShift: true,
      restoredBeforeReset: true, torqueOff: true },
    evidence: { original, marker, expectedShift, observedShift, residual,
      baseline, shifted, restored } };
  });
}

async function offsetPartialWrites(context) {
  return exercise(context, 0, async (rig, id, before) => {
    assert.ok(before[18] & 0x10, 'offset test requires signed telemetry');
    const original = before[31] | (before[32] << 8);
    const baseline = await sample(rig, id);
    assert.equal(baseline.status, 0);
    const trials = [];
    for (const [address, mask] of [[31, 0x40], [32, 0x01]]) {
      const altered = before[address] ^ mask;
      const marker = address === 31
        ? (original & 0xff00) | altered
        : (original & 0x00ff) | (altered << 8);
      const expectedShift = decodeOffset(original) - decodeOffset(marker);
      assert.ok(Math.abs(expectedShift) >= 32 && Math.abs(expectedShift) <= 256,
        `offset byte ${address} has no bounded nonzero marker`);
      await rig.write(id, address, [altered]);
      await delay(55);
      const changed = await sample(rig, id);
      assert.equal(changed.status, 0);
      assert.equal(changed.pwm, 0);
      assert.deepEqual([...await rig.read(id, 31, 2)], [marker & 0xff, marker >> 8]);
      const observedShift = positionDelta(changed.position, baseline.position, false);
      assert.ok(Math.abs(observedShift - expectedShift) <= 4,
        `offset byte ${address} shifted ${observedShift}, expected ${expectedShift}`);
      await rig.write(id, address, [before[address]]);
      await delay(55);
      const restored = await sample(rig, id);
      assert.deepEqual([...await rig.read(id, 31, 2)], [before[31], before[32]]);
      const residual = positionDelta(restored.position, baseline.position, false);
      assert.ok(Math.abs(residual) <= 4,
        `offset byte ${address} restoration left ${residual} ticks`);
      trials.push({ address, original, marker, expectedShift, observedShift, residual });
    }
    return { exact: { lowByteApplied: true, highByteApplied: true,
      restoredBeforeReset: true, torqueOff: true }, evidence: { trials } };
  });
}

async function offsetProfileReanchor(context) {
  return exercise(context, 0, async (rig, id, before) => {
    assert.ok(before[18] & 0x10, 'profile reanchor requires signed telemetry');
    const original = before[31] | (before[32] << 8);
    const marker = [original + 64, original - 64].find(value =>
      value >= 0 && value < 0x2000 &&
      Math.abs(decodeOffset(original) - decodeOffset(value)) === 64);
    assert.ok(marker != null, 'no bounded offset marker');
    const expectedShift = decodeOffset(original) - decodeOffset(marker);
    await rig.write(id, 21, [0, 0, 0, 0]); // P, D, I and punch: no intentional motor drive.
    await rig.write(id, 26, [0, 0]);
    await rig.write(id, 48, [100, 0]); // Bound unexpected output as well.
    await rig.write(id, 41, [40]);
    await rig.write(id, 46, encodeSign15(600));
    const baseline = await sample(rig, id);
    assert.equal(baseline.status, 0);
    assert.ok(baseline.position + 512 < 32000, 'profile origin too high');
    const goal = baseline.position + 512;
    await rig.write(id, 42, encodeSign15(goal));
    await delay(350);
    const beforeOffset = await sample(rig, id);
    assert.equal(beforeOffset.status, 0);
    const progressed = beforeOffset.activePosition - beforeOffset.position;
    assert.ok(progressed >= 60, `profile did not advance before offset: ${progressed}`);
    assert.ok(Math.abs(beforeOffset.position - baseline.position) <= 25,
      `zeroed PID unexpectedly moved shaft ${beforeOffset.position - baseline.position} ticks`);
    assert.equal(beforeOffset.pwm, 0, 'zeroed PID produced PWM before offset');
    await rig.write(id, 31, [marker & 0xff, marker >> 8]);
    await delay(12);
    const reanchored = await sample(rig, id);
    assert.equal(reanchored.status, 0);
    const shaftShift = positionDelta(reanchored.position, beforeOffset.position, false);
    assert.ok(Math.abs(shaftShift - expectedShift) <= 6,
      `offset shifted shaft display ${shaftShift}, expected ${expectedShift}`);
    const reanchorGap = reanchored.activePosition - reanchored.position;
    assert.ok(reanchorGap >= -16 && reanchorGap <= 40,
      `active target did not reanchor to offset-adjusted position: ${reanchorGap}`);
    assert.equal(reanchored.pwm, 0, 'zeroed PID produced PWM after offset');
    await delay(150);
    const resumed = await sample(rig, id);
    assert.equal(resumed.status, 0);
    const resumedGap = resumed.activePosition - resumed.position;
    assert.ok(resumedGap >= reanchorGap + 35,
      `profile did not resume toward old goal: ${reanchorGap} -> ${resumedGap}`);
    assert.ok(Math.abs(positionDelta(resumed.position, reanchored.position, false)) <= 25,
      'shaft moved under zeroed PID after offset');
    assert.deepEqual([...await rig.read(id, 42, 2)], encodeSign15(goal),
      'offset write changed goal-position register');
    await rig.write(id, 40, [0]);
    await rig.write(id, 31, [before[31], before[32]]);
    return { exact: { activeTargetReanchored: true, profileResumed: true,
      goalRegisterUnchanged: true, shaftHeld: true },
    evidence: { original, marker, goal, expectedShift, progressed, shaftShift,
      reanchorGap, resumedGap, baseline, beforeOffset, reanchored, resumed } };
  });
}

module.exports = [{ id: 'test_position_offset_live_write', scope: 'device',
  risk: 'safe', stages: ['register-behavior'],
  covers: { modes: [0], registers: [31, 32, 40, 55, 56, 57, 67, 68] },
  compare: (factory, candidate) => {
    const shiftError = result => result.evidence.observedShift - result.evidence.expectedShift;
    const checks = [
      { name: 'shift error', factory: shiftError(factory), candidate: shiftError(candidate) },
      { name: 'residual', factory: factory.evidence.residual,
        candidate: candidate.evidence.residual },
    ].map(check => ({ ...check,
      tolerance: 4,
      matched: Math.abs(check.factory - check.candidate) <= 4 }));
    return { matched: checks.every(check => check.matched), checks };
  }, run: offsetLiveWrite },
{ id: 'test_position_offset_partial_writes', scope: 'device', risk: 'safe',
  stages: ['register-behavior'],
  covers: { modes: [0], registers: [31, 32, 40, 55, 56, 57] },
  compare: (factory, candidate) => {
    const checks = factory.evidence.trials.map((trial, index) => {
      const other = candidate.evidence.trials[index];
      const factoryError = trial.observedShift - trial.expectedShift;
      const candidateError = other.observedShift - other.expectedShift;
      return { name: `offset byte ${trial.address} shift error`, factory: factoryError,
        candidate: candidateError, tolerance: 4,
        matched: Math.abs(factoryError - candidateError) <= 4 };
    });
    return { matched: checks.every(check => check.matched), checks };
  }, run: offsetPartialWrites },
{ id: 'test_position_offset_profile_reanchor', scope: 'device', risk: 'motion',
  stages: ['register-behavior'],
  covers: { modes: [0], registers: [21, 22, 23, 24, 26, 27, 31, 32, 40, 41, 42, 43, 46, 47, 48, 49, 67, 68] },
  compare: (factory, candidate) => {
    const value = (result, name) => name === 'shaftShift'
      ? result.evidence.shaftShift - result.evidence.expectedShift
      : result.evidence[name];
    const checks = ['progressed', 'shaftShift', 'reanchorGap', 'resumedGap'].map(name => {
      const factoryValue = value(factory, name);
      const candidateValue = value(candidate, name);
      const tolerance = name === 'resumedGap' ? 60 :
        name === 'progressed' ? 50 : name === 'reanchorGap' ? 20 : 12;
      return { name: name === 'shaftShift' ? 'shaft shift error' : name,
        factory: factoryValue, candidate: candidateValue, tolerance,
        matched: Math.abs(factoryValue - candidateValue) <= tolerance };
    });
    return { matched: checks.every(check => check.matched), checks };
  }, run: offsetProfileReanchor }];
