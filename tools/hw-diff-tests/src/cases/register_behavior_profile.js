'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { encodeSign15, positionDelta } = require('../position');
const { upperMedian, withinTolerance } = require('../measurements');
const { sample, trace, pacedWrite, exercise } = require('../motion');

const u16 = value => [value & 0xff, value >> 8];

function timeTo(samples, origin, distance) {
  return samples.find(value => value.position - origin >= distance)?.elapsedMs;
}

function compare(factory, candidate) {
  const a = factory.evidence;
  const b = candidate.evidence;
  const checks = [
    ['limited crossing time', a.limitedTime, b.limitedTime, 300],
    ['default crossing time', a.defaultTime, b.defaultTime, 300],
    ['limited peak profile speed', a.limitedPeakSpeed, b.limitedPeakSpeed, 150],
    ['default peak profile speed', a.defaultPeakSpeed, b.defaultPeakSpeed, 150],
  ].map(([name, factoryValue, candidateValue, tolerance]) => ({
    name, factory: factoryValue, candidate: candidateValue, tolerance,
    matched: withinTolerance(factoryValue, candidateValue, tolerance),
  }));
  return { matched: checks.every(check => check.matched), checks };
}

async function acceleration(context) {
  return exercise(context, 0, async (rig, id, before) => {
    assert.ok(before[18] & 0x10, 'acceleration contrast requires signed position telemetry');
    await pacedWrite(rig, id, 46, encodeSign15(1200));
    await pacedWrite(rig, id, 48, u16(500));
    await pacedWrite(rig, id, 85, [15]);
    await pacedWrite(rig, id, 41, [80]);
    const clippedAcceleration = (await rig.read(id, 41, 1))[0];
    assert.equal(clippedAcceleration, 15, 'acceleration limit did not clip goal register');
    const firstStart = (await sample(rig, id)).position;
    await rig.write(id, 42, encodeSign15(firstStart + 800));
    const limited = await trace(rig, id, 2100);
    const limitedTime = timeTo(limited, firstStart, 400);
    const limitedPeakSpeed = Math.max(...limited.map(value => value.activeVelocity));
    assert.ok(limitedTime != null, 'limited acceleration never reached 400 ticks');
    assert.ok(Math.abs(limited.at(-1).position - firstStart - 800) <= 35);

    await pacedWrite(rig, id, 85, [30]);
    await pacedWrite(rig, id, 86, [2]);
    await pacedWrite(rig, id, 41, [0]); // Effective step: default coefficient × limit.
    assert.equal((await rig.read(id, 41, 1))[0], 0);
    const secondStart = (await sample(rig, id)).position;
    await rig.write(id, 42, encodeSign15(secondStart + 800));
    const defaulted = await trace(rig, id, 1700);
    const defaultTime = timeTo(defaulted, secondStart, 400);
    const defaultPeakSpeed = Math.max(...defaulted.map(value => value.activeVelocity));
    assert.ok(defaultTime != null, 'default acceleration never reached 400 ticks');
    assert.ok(Math.abs(defaulted.at(-1).position - secondStart - 800) <= 35);
    return { exact: { nonzeroClipped: true, zeroUsedDefault: true, bothReached: true },
      evidence: { clippedAcceleration, firstStart, limited, limitedTime, limitedPeakSpeed,
        secondStart, defaulted, defaultTime, defaultPeakSpeed } };
  });
}

async function zeroVelocityPolicy(context) {
  return exercise(context, 0, async (rig, id, before) => {
    assert.ok(before[18] & 0x08, 'zero-velocity policy test requires bit 0x08 set at entry');
    const signed = (before[18] & 0x10) !== 0;
    await pacedWrite(rig, id, 41, [20]);
    await pacedWrite(rig, id, 48, u16(500));
    await pacedWrite(rig, id, 18, [before[18] & ~0x08]);
    await pacedWrite(rig, id, 46, [0, 0]);
    const origin = (await sample(rig, id)).position;
    await rig.write(id, 42, encodeSign15(origin + 300));
    const held = await trace(rig, id, 300);
    const heldDisplacement = positionDelta(held.at(-1).activePosition, origin, signed);
    assert.ok(Math.abs(heldDisplacement) <= 15,
      `zero velocity with bit cleared moved profile ${heldDisplacement} ticks`);
    await pacedWrite(rig, id, 18, [before[18]]);
    await rig.write(id, 46, [0, 0]); // Retrigger velocity-limit decoding.
    const released = await trace(rig, id, 1000);
    const releaseDisplacement = Math.max(...released.map(value =>
      positionDelta(value.activePosition, origin, signed)));
    assert.ok(releaseDisplacement >= 250,
      `zero velocity with bit set moved profile only ${releaseDisplacement} ticks`);
    return { exact: { zeroHeld: true, configEnabledDefaultSpeed: true },
      evidence: { origin, heldDisplacement, releaseDisplacement, held, released } };
  });
}

async function cachedMotionSettings(context) {
  return exercise(context, 0, async (rig, id, before) => {
    assert.ok(before[18] & 0x10, 'cached-motion case requires signed telemetry');
    await pacedWrite(rig, id, 41, [80]);
    await pacedWrite(rig, id, 46, encodeSign15(2200));
    await pacedWrite(rig, id, 48, u16(650));
    async function trial() {
      await rig.write(id, 40, [0]);
      await delay(100);
      const origin = (await sample(rig, id)).position;
      assert.ok(origin + 1600 < 30000, 'position too high for cached-motion swipe');
      await rig.write(id, 42, encodeSign15(origin + 1600));
      const samples = await trace(rig, id, 1900, 15);
      return { origin,
        peakProfileSpeed: Math.max(...samples.map(value => value.activeVelocity)),
        travel: samples.at(-1).position - origin, samples };
    }
    const baseline = await trial();
    const altered = [3, 80, 1]; // If applied live, max profile speed would be 500.
    await pacedWrite(rig, id, 82, altered);
    assert.deepEqual([...await rig.read(id, 82, 3)], altered,
      'cached-motion RAM values did not read back');
    const changed = await trial();
    await pacedWrite(rig, id, 82, [...before.subarray(82, 85)]);
    const restored = await trial();
    const effect = baseline.peakProfileSpeed - changed.peakProfileSpeed;
    if (context.role === 'factory') {
      assert.ok(baseline.peakProfileSpeed >= 1600,
        'factory baseline did not excite velocity cap');
      assert.ok(Math.abs(effect) <= 100 &&
        Math.abs(restored.peakProfileSpeed - baseline.peakProfileSpeed) <= 100,
      `factory cached-motion RAM write unexpectedly changed profile: ${effect}`);
    }
    return { exact: { ramReadback: true, restored: true },
      evidence: { altered, baseline, changed, restored, effect } };
  });
}

async function liveRateTelemetry(context) {
  return exercise(context, 2, async (rig, id, before) => {
    assert.ok(before[82] >= 4, 'motion-rate scale is too small for a live contrast');
    await pacedWrite(rig, id, 48, u16(180));
    await pacedWrite(rig, id, 44, [90, 0]);
    const baseline = await trace(rig, id, 500, 10);
    const changedScale = Math.max(1, Math.floor(before[82] / 2));
    await pacedWrite(rig, id, 82, [changedScale]);
    const changed = await trace(rig, id, 500, 10);
    await pacedWrite(rig, id, 82, [before[82]]);
    const restored = await trace(rig, id, 500, 10);
    await rig.write(id, 44, [0, 0]);
    const metric = samples => {
      const moving = samples.filter(item => item.moving && Math.abs(item.speed) > 0);
      assert.ok(moving.length >= 5, 'rate telemetry trial lacked moving samples');
      return { medianSpeed: upperMedian(moving.map(item => Math.abs(item.speed))),
        movingSamples: moving.length, totalSamples: samples.length };
    };
    const metrics = { baseline: metric(baseline), changed: metric(changed),
      restored: metric(restored) };
    assert.ok(metrics.baseline.medianSpeed >= 100, 'baseline shaft speed was too small');
    return { exact: { liveScaleReadBack: (await rig.read(id, 82, 1))[0] === before[82],
      movingObserved: true, restored: true },
    evidence: { originalScale: before[82], changedScale, metrics,
      baseline, changed, restored } };
  });
}

module.exports = [
  { id: 'test_acceleration_limit_and_default', scope: 'device', risk: 'motion',
    stages: ['register-behavior'], covers: { modes: [0], registers: [41, 85, 86] },
    compare, run: acceleration },
  { id: 'test_zero_velocity_config_policy', scope: 'device', risk: 'motion',
    stages: ['register-behavior'], covers: { modes: [0], registers: [18, 41, 42, 46] },
    compare: (factory, candidate) => {
      const checks = [
        ['held displacement', factory.evidence.heldDisplacement,
          candidate.evidence.heldDisplacement, 15],
        ['released displacement', factory.evidence.releaseDisplacement,
          candidate.evidence.releaseDisplacement, 35],
      ].map(([name, factoryValue, candidateValue, tolerance]) => ({
        name, factory: factoryValue, candidate: candidateValue, tolerance,
        matched: Math.abs(factoryValue - candidateValue) <= tolerance,
      }));
      return { matched: checks.every(check => check.matched), checks };
    },
    run: zeroVelocityPolicy },
  { id: 'test_cached_motion_controls_ram_only', scope: 'device', risk: 'motion',
    stages: ['register-behavior'], covers: { modes: [0], registers: [82, 83, 84] },
    compare: (factory, candidate) => {
      const checks = ['baseline', 'changed', 'restored'].map(name => ({
        name: `${name} peak profile speed`,
        factory: factory.evidence[name].peakProfileSpeed,
        candidate: candidate.evidence[name].peakProfileSpeed,
        tolerance: 150,
        matched: Math.abs(factory.evidence[name].peakProfileSpeed -
          candidate.evidence[name].peakProfileSpeed) <= 150,
      }));
      checks.push({ name: 'RAM-write effect', factory: factory.evidence.effect,
        candidate: candidate.evidence.effect, tolerance: 100,
        matched: Math.abs(factory.evidence.effect - candidate.evidence.effect) <= 100 });
      return { matched: checks.every(check => check.matched), checks };
    }, run: cachedMotionSettings },
  { id: 'test_live_motion_rate_telemetry_and_moving', scope: 'device', risk: 'motion',
    stages: ['register-behavior', 'telemetry'],
    covers: { modes: [2], registers: [44, 48, 58, 59, 66, 82] },
    compare: (factory, candidate) => {
      const checks = ['baseline', 'changed', 'restored'].map(name => {
        const a = factory.evidence.metrics[name].medianSpeed;
        const b = candidate.evidence.metrics[name].medianSpeed;
        return { name: `${name} median measured speed`, factory: a, candidate: b,
          tolerance: 150, matched: Math.abs(a - b) <= 150 };
      });
      const effect = result => result.evidence.metrics.changed.medianSpeed /
        result.evidence.metrics.baseline.medianSpeed;
      checks.push({ name: 'live rate scale speed ratio', factory: effect(factory),
        candidate: effect(candidate), tolerance: 0.2,
        matched: Math.abs(effect(factory) - effect(candidate)) <= 0.2 });
      return { matched: checks.every(check => check.matched), checks };
    }, run: liveRateTelemetry },
];
