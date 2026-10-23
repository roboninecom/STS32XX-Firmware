'use strict';

const assert = require('node:assert/strict');
const { encodeSign15 } = require('../position');
const { sample, trace, pacedWrite, exercise } = require('../motion');
const { withPersistedSettings } = require('../persistence');

const u16 = bytes => bytes[0] | (bytes[1] << 8);
const le16 = value => [value & 0xff, value >> 8];

async function maxTorqueBootCopy(context) {
  const before = await context.rig.read(context.id, 0, 87);
  const original = u16(before.subarray(16, 18));
  const marker = original === 300 ? 400 : 300;
  const persisted = await withPersistedSettings(context, 16, le16(marker), async (rig, id) => {
    const copied = u16(await rig.read(id, 48, 2));
    assert.equal(copied, marker, 'reset did not copy maxTorque to runtime torqueLimit');
    await rig.write(id, 55, [2]);
    await rig.write(id, 48, le16(marker + 100));
    assert.equal(u16(await rig.read(id, 48, 2)), marker + 100);
    await rig.reset(id);
    const recopied = u16(await rig.read(id, 48, 2));
    assert.equal(recopied, marker, 'second reset did not refresh runtime torqueLimit');
    return { copied, recopied };
  });
  const restored = u16(await context.rig.read(context.id, 48, 2));
  assert.equal(restored, original, 'restored maxTorque was not copied at final reset');
  return { exact: { persistedAcrossReset: true, runtimeCopy: true,
    secondResetRecopy: true, originalRestored: true },
  evidence: { original, marker, restored, ...persisted.result,
    preTestRegisterBytes: persisted.before } };
}

async function profileTrial(context, speed = 2200, durationMs = 1850) {
  return exercise(context, 0, async (rig, id, before) => {
    assert.ok(before[18] & 0x10, 'profile-cap case requires signed telemetry');
    await pacedWrite(rig, id, 41, [80]);
    await pacedWrite(rig, id, 46, encodeSign15(speed));
    await pacedWrite(rig, id, 48, le16(650));
    const origin = (await sample(rig, id)).position;
    assert.ok(origin + 1600 < 30000, 'position too high for profile-cap swipe');
    await rig.write(id, 42, encodeSign15(origin + 1600));
    const samples = await trace(rig, id, durationMs, 15);
    return { origin, peakProfileSpeed: Math.max(...samples.map(value => value.activeVelocity)),
      finalTravel: samples.at(-1).position - origin, samples };
  });
}

async function maxVelocityBootCap(context) {
  const before = await context.rig.read(context.id, 0, 87);
  assert.ok(before[84] >= 5, 'baseline maximum velocity too low for cap contrast');
  const baseline = await profileTrial(context);
  const persisted = await withPersistedSettings(context, 84, [1],
    async () => profileTrial(context));
  const capped = persisted.result;
  const restored = await profileTrial(context);
  assert.ok(baseline.peakProfileSpeed >= 1600 && restored.peakProfileSpeed >= 1600,
    'baseline/restored profile did not reach high speed');
  // The cached internal cap is 500; published profile speed divides by 10.
  assert.ok(capped.peakProfileSpeed <= 60 && capped.peakProfileSpeed >= 40,
    `reset-loaded maxVelocity=1 did not cap published profile speed near 50: ${capped.peakProfileSpeed}`);
  return { exact: { persistedAcrossReset: true, publishedCapNear50: true,
    originalRestored: true },
  evidence: { baseline, capped, restored, original: before[84], marker: 1,
    capEffect: baseline.peakProfileSpeed - capped.peakProfileSpeed,
    preTestRegisterBytes: persisted.before } };
}

async function motionRateBootScale(context) {
  const before = await context.rig.read(context.id, 0, 87);
  assert.equal(before[82], 50, 'motion-rate stimulus assumes factory scale 50');
  const baseline = await profileTrial(context);
  const persisted = await withPersistedSettings(context, 82, [100],
    async () => profileTrial(context));
  const changed = persisted.result;
  const restored = await profileTrial(context);
  assert.ok(Math.abs(baseline.peakProfileSpeed - 2200) <= 100 &&
    Math.abs(changed.peakProfileSpeed - 1100) <= 100 &&
    Math.abs(restored.peakProfileSpeed - 2200) <= 100,
  `motion-rate scale did not produce 2200/1100/2200 profile: ${baseline.peakProfileSpeed}/${changed.peakProfileSpeed}/${restored.peakProfileSpeed}`);
  return { exact: { persistedAcrossReset: true, rateScaleApplied: true,
    originalRestored: true }, evidence: { baseline, changed, restored,
    original: before[82], marker: 100, preTestRegisterBytes: persisted.before } };
}

async function minimumVelocityBootFloor(context) {
  const before = await context.rig.read(context.id, 0, 87);
  assert.equal(before[82], 50, 'minimum-velocity test assumes motion-rate scale 50');
  assert.equal(before[83], 1, 'minimum-velocity test assumes baseline floor 1');
  const baseline = await profileTrial(context, 100, 1200);
  const persisted = await withPersistedSettings(context, 83, [4],
    async () => profileTrial(context, 100, 1200));
  const changed = persisted.result;
  const restored = await profileTrial(context, 100, 1200);
  assert.ok(Math.abs(baseline.peakProfileSpeed - 100) <= 15 &&
    Math.abs(changed.peakProfileSpeed - 200) <= 15 &&
    Math.abs(restored.peakProfileSpeed - 100) <= 15,
  `minimum-velocity floor did not produce 100/200/100 profile: ${baseline.peakProfileSpeed}/${changed.peakProfileSpeed}/${restored.peakProfileSpeed}`);
  return { exact: { persistedAcrossReset: true, velocityFloorApplied: true,
    originalRestored: true }, evidence: { baseline, changed, restored,
    original: before[83], marker: 4, preTestRegisterBytes: persisted.before } };
}

function comparePeak(factory, candidate) {
  const checks = ['baseline', 'changed', 'restored'].map(name => ({
    name: `${name} peak profile speed`,
    factory: (factory.evidence[name] ?? factory.evidence.capped).peakProfileSpeed,
    candidate: (candidate.evidence[name] ?? candidate.evidence.capped).peakProfileSpeed,
    tolerance: 150,
    matched: Math.abs((factory.evidence[name] ?? factory.evidence.capped).peakProfileSpeed -
      (candidate.evidence[name] ?? candidate.evidence.capped).peakProfileSpeed) <= 150,
  }));
  return { matched: checks.every(check => check.matched), checks };
}

module.exports = [
  { id: 'test_max_torque_reset_boot_copy', scope: 'device', risk: 'safe',
    stages: ['persistence'], requiresPersistenceWrite: true,
    covers: { registers: [16, 17, 48, 49, 55], persistence: ['primary-write', 'reset-copy'] },
    run: maxTorqueBootCopy },
  { id: 'test_max_velocity_reset_boot_cap', scope: 'device', risk: 'motion',
    stages: ['persistence'], requiresPersistenceWrite: true,
    covers: { modes: [0], registers: [41, 42, 46, 48, 55, 84],
      persistence: ['primary-write', 'reset-cache'] },
    compare: comparePeak, run: maxVelocityBootCap },
  { id: 'test_motion_rate_reset_boot_scale', scope: 'device', risk: 'motion',
    stages: ['persistence'], requiresPersistenceWrite: true,
    covers: { modes: [0], registers: [41, 42, 46, 55, 82],
      persistence: ['primary-write', 'reset-cache'] },
    compare: comparePeak, run: motionRateBootScale },
  { id: 'test_minimum_velocity_reset_boot_floor', scope: 'device', risk: 'motion',
    stages: ['persistence'], requiresPersistenceWrite: true,
    covers: { modes: [0], registers: [41, 42, 46, 55, 83],
      persistence: ['primary-write', 'reset-cache'] },
    compare: comparePeak, run: minimumVelocityBootFloor },
];
