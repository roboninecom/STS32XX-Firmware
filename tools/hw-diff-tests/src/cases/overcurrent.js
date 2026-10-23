'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { positionDelta, nearbyLogicalPosition, encodeSign15 } = require('../position');
const { withinTolerance } = require('../measurements');
const { sample, trace, pacedWrite, exercise } = require('../motion');

const ALARM = 0x08;
const THRESHOLD = 3;

async function waitForIdleCurrent(rig, id) {
  let quiet = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    const value = await sample(rig, id);
    if (Math.abs(value.current) < THRESHOLD && value.status === 0) quiet++;
    else quiet = 0;
    if (quiet >= 5) return;
    await delay(20);
  }
  throw new Error('current/status did not return to idle after preflight');
}

async function monitorAlarm(rig, id, timeoutMs) {
  const started = process.hrtime.bigint();
  const samples = [];
  while (Number(process.hrtime.bigint() - started) / 1e6 < timeoutMs) {
    const value = await sample(rig, id);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    samples.push({ elapsedMs, ...value });
    assert.equal(value.status & ~ALARM, 0,
      `unexpected alarm 0x${value.status.toString(16)} during current test`);
    if (value.status & ALARM) {
      const torqueAtAlarm = (await rig.read(id, 40, 1))[0];
      await rig.write(id, 40, [0]);
      return { observed: true, elapsedMs, torqueAtAlarm, samples };
    }
    await delay(10);
  }
  await rig.write(id, 40, [0]);
  return { observed: false, elapsedMs: null, torqueAtAlarm: null, samples };
}

function compare(factory, candidate) {
  const a = factory.evidence;
  const b = candidate.evidence;
  const checks = [
    ['preflight peak current', a.preflightPeakCurrent, b.preflightPeakCurrent, 8],
    ['alarm onset time', a.alarm.elapsedMs, b.alarm.elapsedMs, 250],
    ['torque at alarm', a.alarm.torqueAtAlarm, b.alarm.torqueAtAlarm, 0],
    ['unmasked alarm onset', a.unmaskedAlarm.elapsedMs, b.unmaskedAlarm.elapsedMs, 250],
    ['unmasked torque at alarm', a.unmaskedAlarm.torqueAtAlarm,
      b.unmaskedAlarm.torqueAtAlarm, 0],
  ].map(([name, factoryValue, candidateValue, tolerance]) => ({
    name, factory: factoryValue, candidate: candidateValue, tolerance,
    matched: withinTolerance(factoryValue, candidateValue, tolerance),
  }));
  return { matched: checks.every(check => check.matched), checks };
}

const shutdownCase = {
  id: 'test_overcurrent_shutdown_under_swipe', scope: 'device', risk: 'motion',
  stages: ['current-protection'], requiresCurrentProtection: true, stopOnFailure: true,
  covers: { modes: [0], registers: [19, 28, 29, 38, 40, 41, 42, 46, 48, 65, 69, 70],
    protection: ['overcurrent'] },
  compare,
  run: context => exercise(context, 0, async (rig, id, before) => {
    assert.equal(before[65] & ALARM, 0, 'overcurrent alarm already active');
    assert.ok((before[18] & 0x20) === 0, 'current ADC is disabled by configuration');
    assert.ok((before[19] & ALARM) !== 0, 'overcurrent shutdown mask is not set');
    assert.ok((before[28] | before[29] << 8) > 20,
      'original current threshold lacks preflight headroom');
    const signed = (before[18] & 0x10) !== 0;
    assert.ok(signed, 'current swipe requires signed position mode');
    await pacedWrite(rig, id, 41, [80]);
    await pacedWrite(rig, id, 46, encodeSign15(5000));
    await pacedWrite(rig, id, 48, [138, 2]); // Temporary output cap 650.

    let motorCommanded = false;
    try {
      const start = await sample(rig, id);
      await rig.write(id, 42, encodeSign15(nearbyLogicalPosition(start.position, signed) + 5000));
      motorCommanded = true;
      const preflight = await trace(rig, id, 600);
      const preflightPeakCurrent = Math.max(...preflight.map(value => Math.abs(value.current)));
      assert.ok(preflightPeakCurrent >= 8,
        `preflight current ${preflightPeakCurrent} is too small to test threshold`);
      await rig.write(id, 40, [0]);
      motorCommanded = false;
      await waitForIdleCurrent(rig, id);

      await rig.write(id, 28, [THRESHOLD, 0]);
      await rig.write(id, 38, [1]); // Ten acquisition ticks.
      await delay(100);
      const idle = await sample(rig, id);
      assert.equal(idle.status & ALARM, 0, 'low threshold tripped while idle');
      assert.ok(Math.abs(idle.current) < THRESHOLD, 'idle current exceeds injected threshold');

      const origin = idle.position;
      await rig.write(id, 42, encodeSign15(nearbyLogicalPosition(origin, signed) + 5000));
      motorCommanded = true;
      const alarm = await monitorAlarm(rig, id, 1500);
      motorCommanded = false;
      assert.ok(alarm.observed, 'overcurrent alarm did not assert during bounded swipe');
      // The acquisition loop can trip between host telemetry samples. The
      // latched alarm is authoritative; retain sampled peak as evidence.
      const sampledPeakCurrent = Math.max(...alarm.samples.map(value => Math.abs(value.current)));
      assert.equal(alarm.torqueAtAlarm, 0, 'masked overcurrent did not disable torque');
      assert.ok((await rig.ping(id)).error & ALARM,
        'overcurrent alarm absent from status reply');

      await rig.write(id, 38, [0]); // Disabled duration clears this alarm.
      await delay(60);
      const cleared = await sample(rig, id);
      assert.equal(cleared.status & ALARM, 0, 'zero duration did not clear alarm');
      assert.equal((await rig.ping(id)).error & ALARM, 0);

      await waitForIdleCurrent(rig, id);
      await rig.write(id, 19, [before[19] & ~ALARM]);
      await rig.write(id, 38, [1]);
      await delay(60);
      assert.equal((await sample(rig, id)).status & ALARM, 0,
        'unmasked current alarm was active before motion');
      const unmaskedOrigin = (await sample(rig, id)).position;
      await rig.write(id, 42,
        encodeSign15(nearbyLogicalPosition(unmaskedOrigin, signed) + 5000));
      motorCommanded = true;
      const unmaskedAlarm = await monitorAlarm(rig, id, 1500);
      motorCommanded = false;
      assert.ok(unmaskedAlarm.observed, 'unmasked overcurrent alarm did not assert');
      assert.equal(unmaskedAlarm.torqueAtAlarm, 1,
        'unmasked overcurrent unexpectedly disabled torque');
      assert.ok((await rig.ping(id)).error & ALARM,
        'unmasked alarm absent from status reply');
      await rig.write(id, 38, [0]);
      await delay(60);
      assert.equal((await sample(rig, id)).status & ALARM, 0,
        'unmasked alarm did not clear with zero duration');
      await rig.write(id, 19, [before[19]]);
      return { exact: { currentObserved: true, alarmAsserted: true,
        torqueDisabled: true, unmaskedTorqueStayedEnabled: true,
        durationZeroCleared: true },
      evidence: { threshold: THRESHOLD, preflightPeakCurrent, sampledPeakCurrent, preflight,
        idle, origin, alarm, cleared, unmaskedOrigin, unmaskedAlarm,
        preflightTravel: positionDelta(preflight.at(-1).position, start.position, signed) } };
    } finally {
      if (motorCommanded) await rig.write(id, 40, [0]);
    }
  }),
};

const durationCase = {
  id: 'test_overcurrent_duration_scaling_under_swipe', scope: 'device', risk: 'motion',
  stages: ['current-protection'], requiresCurrentProtection: true, stopOnFailure: true,
  covers: { modes: [0], registers: [19, 28, 29, 38, 40, 41, 42, 46, 48, 65, 69, 70],
    protection: ['overcurrent-duration'] },
  compare: (factory, candidate) => {
    const checks = factory.evidence.trials.map((trial, index) => {
      const other = candidate.evidence.trials[index];
      return { name: `duration ${trial.duration} onset`, factory: trial.alarm.elapsedMs,
        candidate: other.alarm.elapsedMs, tolerance: 250,
        matched: Math.abs(trial.alarm.elapsedMs - other.alarm.elapsedMs) <= 250 };
    });
    return { matched: checks.every(check => check.matched), checks };
  },
  run: context => exercise(context, 0, async (rig, id, before) => {
    assert.equal(before[65] & ALARM, 0);
    assert.ok((before[18] & 0x20) === 0);
    assert.ok(before[18] & 0x10);
    await pacedWrite(rig, id, 19, [before[19] & ~ALARM]);
    await pacedWrite(rig, id, 28, [THRESHOLD, 0]);
    await pacedWrite(rig, id, 41, [80]);
    await pacedWrite(rig, id, 46, encodeSign15(5000));
    await pacedWrite(rig, id, 48, [138, 2]);
    const trials = [];
    for (const duration of [1, 5]) {
      await waitForIdleCurrent(rig, id);
      await rig.write(id, 38, [duration]);
      await delay(60);
      const start = await sample(rig, id);
      const origin = nearbyLogicalPosition(start.position, true);
      const direction = origin > 26000 ? -1 : 1;
      await rig.write(id, 42, encodeSign15(origin + direction * 5000));
      const alarm = await monitorAlarm(rig, id, 1800);
      assert.ok(alarm.observed, `duration ${duration} overcurrent alarm did not assert`);
      assert.equal(alarm.torqueAtAlarm, 1, 'unmasked duration trial disabled torque');
      await rig.write(id, 38, [0]);
      await delay(70);
      assert.equal((await sample(rig, id)).status & ALARM, 0);
      trials.push({ duration, origin, direction, alarm });
    }
    await rig.write(id, 19, [before[19]]);
    return { exact: { durations: [1, 5], bothAsserted: true,
      zeroDurationCleared: true }, evidence: { trials } };
  }),
};

module.exports = [shutdownCase, durationCase];
