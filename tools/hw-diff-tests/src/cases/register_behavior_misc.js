'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { encodeSign15 } = require('../position');
const { compareEvidence } = require('../measurements');
const { sample, trace, pacedWrite, exercise } = require('../motion');

async function outputPunch(context) {
  return exercise(context, 1, async (rig, id, before) => {
    await pacedWrite(rig, id, 37, [before[37]]);
    await pacedWrite(rig, id, 39, [0]);
    await pacedWrite(rig, id, 41, [20]);
    await pacedWrite(rig, id, 48, [144, 1]);
    async function trial(bias) {
      await rig.write(id, 40, [0]);
      await delay(150);
      await pacedWrite(rig, id, 24, [bias]);
      assert.equal((await rig.read(id, 24, 1))[0], bias);
      await rig.write(id, 46, encodeSign15(5000));
      const samples = await trace(rig, id, 950, 15);
      return { bias, peakPwm: Math.max(...samples.map(value => Math.abs(value.pwm))),
        samples };
    }
    const baseline = await trial(0);
    const changed = await trial(20);
    const restored = await trial(0);
    const effect = changed.peakPwm - baseline.peakPwm;
    if (context.role === 'factory') {
      assert.ok(baseline.peakPwm >= 25 && effect >= 10 && effect <= 35,
        `factory output-punch stimulus ineffective: ${baseline.peakPwm}/${changed.peakPwm}`);
      assert.ok(Math.abs(restored.peakPwm - baseline.peakPwm) <= 25);
    }
    return { exact: { threeTrials: true, biasReadback: true },
      evidence: { baseline, changed, restored, effect } };
  });
}

async function telemetryScale(context) {
  return exercise(context, 1, async (rig, id, before) => {
    assert.ok(before[18] & 0x04, 'telemetry scale test requires bit 0x04 at entry');
    await pacedWrite(rig, id, 41, [30]);
    await pacedWrite(rig, id, 48, [44, 1]);
    let driving = false;
    try {
      await rig.write(id, 46, encodeSign15(600));
      driving = true;
      const scaled = await trace(rig, id, 550);
      const scaledVelocity = scaled.at(-1).activeVelocity;
      assert.ok(scaledVelocity >= 400, `scaled active velocity only ${scaledVelocity}`);
      await rig.write(id, 18, [before[18] & ~0x04]);
      await delay(45);
      const raw = await trace(rig, id, 100);
      const rawVelocity = raw.at(-1).activeVelocity;
      assert.ok(rawVelocity > 0 && Math.abs(scaledVelocity / rawVelocity - 50) <= 8,
        `telemetry scale ratio not near 50: ${scaledVelocity}/${rawVelocity}`);
      await rig.write(id, 18, [before[18]]);
      await delay(45);
      const restored = await sample(rig, id);
      assert.ok(restored.activeVelocity >= 400,
        'restoring config bit did not restore velocity units');
      await rig.write(id, 40, [0]);
      driving = false;
      return { exact: { fiftyfoldScale: true, restoredUnits: true },
        evidence: { scaledVelocity, rawVelocity,
          ratio: scaledVelocity / rawVelocity, restoredVelocity: restored.activeVelocity,
          scaled, raw, restored } };
    } finally {
      if (driving) await rig.write(id, 40, [0]);
    }
  });
}

function u16(bytes, index) { return bytes[index] | (bytes[index + 1] << 8); }
function signed15(raw) { return raw & 0x8000 ? -(raw & 0x7fff) : raw; }

async function positionDisplayFormat(context) {
  return exercise(context, 0, async (rig, id, before) => {
    assert.ok(before[18] & 0x10, 'position display test requires signed mode at entry');
    await pacedWrite(rig, id, 41, [80]);
    await pacedWrite(rig, id, 46, encodeSign15(2500));
    await pacedWrite(rig, id, 48, [138, 2]); // Output cap 650.
    const origin = (await sample(rig, id)).position;
    const goal = Math.max(origin + 2200, 5200);
    assert.ok(goal < 30000, 'signed position goal outside safe test range');
    await rig.write(id, 42, encodeSign15(goal));
    const motion = await trace(rig, id, Math.max(2600, (goal - origin) / 2 + 1100));
    await rig.write(id, 40, [0]);
    await delay(90);
    const signed = await rig.read(id, 56, 13);
    const signedPosition = u16(signed, 0);
    const signedActive = u16(signed, 11);
    assert.ok(signedPosition > 4095 && signedPosition < 30000,
      `motion did not reach a positive position above wrap: ${signedPosition}`);
    assert.ok(Math.abs(signedPosition - goal) <= 80,
      `motion did not settle near goal: ${signedPosition}/${goal}`);
    await pacedWrite(rig, id, 18, [before[18] & ~0x10]);
    const modulo = await rig.read(id, 56, 13);
    assert.equal((await rig.read(id, 18, 1))[0], before[18] & ~0x10);
    await pacedWrite(rig, id, 18, [before[18]]);
    const restored = await rig.read(id, 56, 13);
    const moduloPosition = u16(modulo, 0);
    const moduloActive = u16(modulo, 11);
    const restoredPosition = u16(restored, 0);
    const restoredActive = u16(restored, 11);
    assert.ok(Math.abs(moduloPosition - (restoredPosition & 0x0fff)) <= 4,
      `position modulo format mismatch: ${moduloPosition}/${restoredPosition}`);
    assert.ok(Math.abs(moduloActive - (restoredActive & 0x0fff)) <= 4,
      `active-position modulo format mismatch: ${moduloActive}/${restoredActive}`);
    assert.ok(Math.abs(restoredPosition - signedPosition) <= 4,
      'signed position was not restored');
    return { exact: { wrappedPosition: true, wrappedActivePosition: true,
      signedFormatRestored: true }, evidence: { origin, goal, motion,
      signedPosition, signedActive, moduloPosition, moduloActive,
      restoredPosition, restoredActive,
      positionWrap: restoredPosition - moduloPosition,
      activeWrap: restoredActive - moduloActive } };
  });
}

async function negativePositionDisplayFormat(context) {
  return exercise(context, 0, async (rig, id, before) => {
    assert.ok(before[18] & 0x10, 'negative display test requires signed mode at entry');
    await pacedWrite(rig, id, 41, [80]);
    await pacedWrite(rig, id, 46, encodeSign15(2500));
    await pacedWrite(rig, id, 48, [138, 2]);
    const origin = (await sample(rig, id)).position;
    const goal = Math.min(origin - 1800, -600);
    assert.ok(goal > -30000, 'negative position goal outside safe test range');
    await rig.write(id, 42, encodeSign15(goal));
    const motion = await trace(rig, id, Math.max(2600, (origin - goal) / 1.4 + 1200));
    await rig.write(id, 40, [0]);
    await delay(90);
    const signed = await rig.read(id, 56, 13);
    const signedPosition = signed15(u16(signed, 0));
    const signedActive = signed15(u16(signed, 11));
    assert.ok(signedPosition <= -300, `motion did not reach negative position: ${signedPosition}`);
    assert.ok(Math.abs(signedPosition - goal) <= 80,
      `negative motion did not settle near goal: ${signedPosition}/${goal}`);
    await pacedWrite(rig, id, 18, [before[18] & ~0x10]);
    const modulo = await rig.read(id, 56, 13);
    await pacedWrite(rig, id, 18, [before[18]]);
    const restored = await rig.read(id, 56, 13);
    const restoredPosition = signed15(u16(restored, 0));
    const restoredActive = signed15(u16(restored, 11));
    const moduloPosition = u16(modulo, 0);
    const moduloActive = u16(modulo, 11);
    const wrap = value => ((value % 4096) + 4096) % 4096;
    const positionModuloError = moduloPosition - wrap(restoredPosition);
    const activeModuloError = moduloActive - wrap(restoredActive);
    assert.ok(Math.abs(positionModuloError) <= 4,
      `negative position modulo mismatch: ${moduloPosition}/${restoredPosition}`);
    assert.ok(Math.abs(activeModuloError) <= 4,
      `negative active-position modulo mismatch: ${moduloActive}/${restoredActive}`);
    assert.ok(Math.abs(restoredPosition - signedPosition) <= 4,
      'negative signed position was not restored');
    return { exact: { negativeSignedPosition: true, negativeModuloPosition: true,
      negativeModuloActivePosition: true, signedFormatRestored: true },
    evidence: { origin, goal, motion, signedPosition, signedActive,
      moduloPosition, moduloActive, restoredPosition, restoredActive,
      positionModuloError, activeModuloError } };
  });
}

module.exports = [
  { id: 'test_output_punch_contrast', scope: 'device', risk: 'motion',
    stages: ['register-behavior'], covers: { modes: [1], registers: [24, 37, 39] },
    compare: compareEvidence([['effect', 20]]), run: outputPunch },
  { id: 'test_config_velocity_telemetry_scale', scope: 'device', risk: 'motion',
    stages: ['register-behavior'], covers: { modes: [1], registers: [18, 58, 59, 71, 72] },
    compare: compareEvidence([['ratio', 5]]), run: telemetryScale },
  { id: 'test_config_position_display_wrap', scope: 'device', risk: 'motion',
    stages: ['register-behavior'], covers: { modes: [0], registers: [18, 56, 57, 67, 68] },
    compare: (factory, candidate) => {
      const checks = ['positionWrap', 'activeWrap'].map(name => ({ name,
        factory: factory.evidence[name], candidate: candidate.evidence[name],
        tolerance: 4, matched: Math.abs(factory.evidence[name] - candidate.evidence[name]) <= 4 }));
      return { matched: checks.every(check => check.matched), checks };
    }, run: positionDisplayFormat },
  { id: 'test_config_negative_position_display_wrap', scope: 'device', risk: 'motion',
    stages: ['register-behavior'], covers: { modes: [0], registers: [18, 56, 57, 67, 68] },
    compare: (factory, candidate) => {
      const checks = ['positionModuloError', 'activeModuloError'].map(name => ({ name,
        factory: factory.evidence[name], candidate: candidate.evidence[name],
        tolerance: 4, matched: Math.abs(factory.evidence[name] - candidate.evidence[name]) <= 4 }));
      return { matched: checks.every(check => check.matched), checks };
    }, run: negativePositionDisplayFormat },
];
