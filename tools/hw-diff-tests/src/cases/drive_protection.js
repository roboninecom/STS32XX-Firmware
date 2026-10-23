'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { encodeSign15 } = require('../position');
const { withinTolerance } = require('../measurements');
const { sample, trace, pacedWrite, exercise, waitForDrive } = require('../motion');

function lastPwm(samples) { return Math.abs(samples.at(-1).pwm); }

async function waitForBit(rig, id, bit, active, timeoutMs = 700) {
  const started = process.hrtime.bigint();
  const samples = [];
  while (Number(process.hrtime.bigint() - started) / 1e6 < timeoutMs) {
    const value = await sample(rig, id);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    samples.push({ elapsedMs, ...value });
    assert.equal(value.status & ~bit, 0, `unexpected alarm 0x${value.status.toString(16)}`);
    if (Boolean(value.status & bit) === active) {
      return { observed: true, elapsedMs, samples };
    }
    await delay(10);
  }
  return { observed: false, elapsedMs: null, samples };
}

async function traceWithBit(rig, id, bit, durationMs) {
  const started = process.hrtime.bigint();
  const samples = [];
  do {
    const value = await sample(rig, id);
    assert.equal(value.status, bit, `expected only alarm 0x${bit.toString(16)}`);
    samples.push({ elapsedMs: Number(process.hrtime.bigint() - started) / 1e6, ...value });
    await delay(20);
  } while (Number(process.hrtime.bigint() - started) / 1e6 < durationMs);
  return samples;
}

function compare(factory, candidate) {
  const a = factory.evidence;
  const b = candidate.evidence;
  const checks = [
    ['alarm onset', a.onset.elapsedMs, b.onset.elapsedMs, 180],
    ['unmasked output', a.unmaskedPwm, b.unmaskedPwm, 80],
    ['masked output', a.maskedPwm, b.maskedPwm, 5],
    ['resumed output', a.resumedPwm, b.resumedPwm, 80],
  ].map(([name, factoryValue, candidateValue, tolerance]) => ({
    name, factory: factoryValue, candidate: candidateValue, tolerance,
    matched: withinTolerance(factoryValue, candidateValue, tolerance),
  }));
  return { matched: checks.every(check => check.matched), checks };
}

function caseFor({ name, address, bit, injected, preflight }) {
  return {
    id: `test_${name}_shutdown_mask_under_drive`, scope: 'device', risk: 'motion',
    stages: ['drive-protection'],
    covers: { modes: [1], registers: [address, 19, 40, 41, 46, 48, 60, 65],
      protection: [name] },
    compare,
    run: context => exercise(context, 1, async (rig, id, before) => {
      assert.equal(before[65], 0, 'alarm already active before drive test');
      preflight(before);
      const originalMask = before[19];
      const unmasked = originalMask & ~bit;
      const raised = injected(before);
      let driving = false;
      try {
        await pacedWrite(rig, id, 19, [unmasked]);
        await pacedWrite(rig, id, 41, [30]);
        await pacedWrite(rig, id, 48, [44, 1]); // Output cap 300.
        await rig.write(id, 46, encodeSign15(5000));
        driving = true;
        // Acceleration 30 ramps through the old 220 ms deadline near PWM 80.
        // Begin fault injection only once measured output meets the stimulus.
        const baseline = await waitForDrive(rig, id);
        await rig.write(id, address, [raised]);
        const onset = await waitForBit(rig, id, bit, true);
        assert.ok(onset.observed, `${name} alarm did not assert`);
        assert.ok((await rig.ping(id)).error & bit, `${name} missing from status reply`);

        const unmaskedSamples = await traceWithBit(rig, id, bit, 130);
        const unmaskedPwm = lastPwm(unmaskedSamples);
        assert.ok(unmaskedPwm >= 80, `${name} unmasked alarm suppressed output`);
        await rig.write(id, 19, [unmasked | bit]);
        const maskedSamples = await traceWithBit(rig, id, bit, 130);
        const maskedPwm = lastPwm(maskedSamples);
        assert.equal(maskedPwm, 0, `${name} masked alarm did not zero output`);
        assert.equal((await rig.read(id, 40, 1))[0], 1,
          `${name} mask unexpectedly disabled torque`);

        await rig.write(id, 19, [unmasked]);
        const resumedSamples = await traceWithBit(rig, id, bit, 130);
        const resumedPwm = lastPwm(resumedSamples);
        assert.ok(resumedPwm >= 80, `${name} output did not resume after unmasking`);
        await rig.write(id, 40, [0]);
        driving = false;
        await rig.write(id, address, [before[address]]);
        const recovery = await waitForBit(rig, id, bit, false);
        assert.ok(recovery.observed, `${name} alarm did not clear after threshold restore`);
        await rig.write(id, 19, [originalMask]);
        return { exact: { alarmAsserted: true, unmaskedDrive: true,
          maskedShutdown: true, unmaskResumed: true, alarmCleared: true },
        evidence: { injectedThreshold: raised, originalThreshold: before[address],
          originalMask, baseline, onset, unmaskedPwm, unmaskedSamples,
          maskedPwm, maskedSamples, resumedPwm, resumedSamples, recovery } };
      } finally {
        if (driving) await rig.write(id, 40, [0]);
      }
    }),
  };
}

module.exports = [
  caseFor({ name: 'overvoltage', address: 14, bit: 0x01,
    injected: before => before[62] - 10,
    preflight: before => {
      assert.ok(before[62] >= 30 && before[62] <= 240);
      assert.ok(before[14] > before[62] + 6);
      assert.ok(before[62] - 10 > before[15] + 6,
        'injected overvoltage limit would also trigger undervoltage');
    } }),
  caseFor({ name: 'undervoltage', address: 15, bit: 0x01,
    injected: before => before[62] + 10,
    preflight: before => {
      assert.ok(before[62] >= 20 && before[62] <= 230);
      assert.ok(before[15] + 6 < before[62]);
    } }),
  caseFor({ name: 'overtemperature', address: 13, bit: 0x04,
    injected: before => before[63] - 5,
    preflight: before => {
      assert.ok(before[63] >= 10 && before[63] <= 200);
      assert.ok(before[13] > before[63] + 7);
    } }),
  {
    id: 'test_masked_overvoltage_profile_reanchor', scope: 'device', risk: 'motion',
    stages: ['drive-protection'],
    covers: { modes: [0], registers: [14, 19, 40, 41, 42, 46, 48, 56, 65, 67],
      protection: ['overvoltage', 'profile-reanchor'] },
    compare: (factory, candidate) => {
      const names = [['masked active advance', 'maskedActiveAdvance', 30],
        ['masked tracking gap', 'maskedTrackingGap', 35],
        ['resumed active advance', 'resumedActiveAdvance', 40]];
      const checks = names.map(([name, field, tolerance]) => ({ name,
        factory: factory.evidence[field], candidate: candidate.evidence[field], tolerance,
        matched: Math.abs(factory.evidence[field] - candidate.evidence[field]) <= tolerance }));
      return { matched: checks.every(check => check.matched), checks };
    },
    run: context => exercise(context, 0, async (rig, id, before) => {
      assert.ok(before[18] & 0x10, 'profile reanchor requires signed position telemetry');
      assert.equal(before[65], 0, 'alarm already active before profile reanchor test');
      assert.ok(before[14] > before[62] + 6);
      const bit = 0x01;
      const originalMask = before[19];
      const unmasked = originalMask & ~bit;
      const raised = before[62] - 10;
      let driving = false;
      try {
        await pacedWrite(rig, id, 19, [unmasked]);
        await pacedWrite(rig, id, 41, [20]);
        await pacedWrite(rig, id, 46, encodeSign15(900));
        await pacedWrite(rig, id, 48, [44, 1]);
        const origin = await sample(rig, id);
        await rig.write(id, 42, encodeSign15(origin.position + 1800));
        driving = true;
        const baseline = await trace(rig, id, 300, 15);
        assert.ok(baseline.at(-1).activePosition - origin.activePosition >= 80,
          'profile did not advance before alarm');
        await rig.write(id, 14, [raised]);
        const onset = await waitForBit(rig, id, bit, true);
        assert.ok(onset.observed, 'overvoltage alarm did not assert');
        await rig.write(id, 19, [unmasked | bit]);
        const masked = await traceWithBit(rig, id, bit, 260);
        assert.equal(lastPwm(masked), 0, 'masked alarm did not suppress position output');
        const maskedActiveAdvance = masked.at(-1).activePosition - masked[0].activePosition;
        const maskedTrackingGap = masked.at(-1).activePosition - masked.at(-1).position;
        await rig.write(id, 19, [unmasked]);
        const resumed = await traceWithBit(rig, id, bit, 260);
        const resumedActiveAdvance = resumed.at(-1).activePosition -
          resumed[0].activePosition;
        await rig.write(id, 40, [0]);
        driving = false;
        await rig.write(id, 14, [before[14]]);
        const recovery = await waitForBit(rig, id, bit, false);
        assert.ok(recovery.observed, 'overvoltage alarm did not clear');
        await rig.write(id, 19, [originalMask]);
        return { exact: { alarmAsserted: true, outputSuppressed: true,
          outputReleased: true, settingsRestored: true },
        evidence: { origin, raised, baseline, onset, masked, resumed, recovery,
          maskedActiveAdvance, maskedTrackingGap, resumedActiveAdvance } };
      } finally {
        if (driving) await rig.write(id, 40, [0]);
      }
    }),
  },
];
