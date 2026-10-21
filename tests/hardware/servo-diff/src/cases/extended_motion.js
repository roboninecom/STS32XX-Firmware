'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { sample, pacedWrite, exercise } = require('../motion');
const { encodeSign15 } = require('../position');

const u16 = value => [value & 0xff, value >> 8];
const nowMs = () => Number(process.hrtime.bigint()) / 1e6;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function deviation(values) {
  const average = mean(values);
  return Math.sqrt(mean(values.map(value => (value - average) ** 2)));
}

function variation(samples, key) {
  if (samples.length < 2) return 0;
  return mean(samples.slice(1).map((value, index) =>
    Math.abs(value[key] - samples[index][key])));
}

async function observe(rig, id, durationMs, intervalMs = 25) {
  const started = nowMs();
  const samples = [];
  let next = started;
  do {
    const value = await sample(rig, id);
    assert.equal(value.status, 0, 'servo ' + id + ' alarm ' + value.status);
    samples.push({ elapsedMs: nowMs() - started, ...value });
    next += intervalMs;
    const wait = next - nowMs();
    if (wait > 0) await delay(wait);
  } while (nowMs() - started < durationMs);
  return samples;
}

async function moveTo(rig, id, goal, timeoutMs = 8500) {
  const reply = await rig.write(id, 42, encodeSign15(goal));
  assert.equal(reply.error, 0);
  const started = nowMs();
  const samples = [];
  while (nowMs() - started < timeoutMs) {
    const value = await sample(rig, id);
    assert.equal(value.status, 0, 'servo ' + id + ' alarm while moving to ' + goal);
    samples.push({ elapsedMs: nowMs() - started, ...value });
    if (Math.abs(value.position - goal) <= 35 && Math.abs(value.speed) <= 120) {
      return { goal, samples, final: samples.at(-1) };
    }
    await delay(25);
  }
  throw new Error('servo ' + id + ' did not reach ' + goal +
    ' from ' + samples[0]?.position + '; ended at ' + samples.at(-1)?.position);
}

async function configurePosition(rig, id, speed = 2200) {
  await pacedWrite(rig, id, 41, [40]);
  await pacedWrite(rig, id, 46, encodeSign15(speed));
  await pacedWrite(rig, id, 48, u16(650));
}

// Fixed pseudo-random schedule: identical irregular pauses for both devices.
// Cumulative gaps are normalized so the last command lands at durationMs.
function sweepSchedule(durationMs, reverse) {
  let seed = 0x3215 + durationMs + (reverse ? 1 : 0);
  const weights = Array.from({ length: 32 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return 0.7 + (seed % 601) / 1000;
  });
  const total = weights.reduce((sum, value) => sum + value, 0);
  let elapsed = 0;
  const goals = [{ atMs: 0, goal: reverse ? 4095 : 0 }];
  for (let index = 1; index <= 32; index++) {
    elapsed += weights[index - 1] / total * durationMs;
    const position = Math.round(index * 4095 / 32);
    goals.push({ atMs: index === 32 ? durationMs : elapsed,
      goal: reverse ? 4095 - position : position });
  }
  return goals;
}

async function runSweep(rig, id, durationMs, reverse) {
  const schedule = sweepSchedule(durationMs, reverse);
  const started = nowMs();
  const impulses = [];
  for (const { atMs, goal } of schedule) {
    const wait = started + atMs - nowMs();
    if (wait > 0) await delay(wait);
    const sentMs = nowMs() - started;
    const reply = await rig.write(id, 42, encodeSign15(goal));
    assert.equal(reply.error, 0);
    const value = await sample(rig, id);
    assert.equal(value.status, 0, 'servo ' + id + ' alarm during sweep');
    impulses.push({ plannedMs: atMs, sentMs, gapMs: impulses.length ?
      sentMs - impulses.at(-1).sentMs : null, goal,
    sample: { elapsedMs: nowMs() - started, ...value } });
  }
  return { durationMs, reverse, schedule, impulses,
    endPosition: impulses.at(-1).sample.position,
    endError: Math.abs(impulses.at(-1).sample.position - schedule.at(-1).goal),
    meanTrackingError: mean(impulses.map(value =>
      Math.abs(value.sample.position - value.goal))),
    speedVariation: variation(impulses.map(value => value.sample), 'speed'),
    pwmVariation: variation(impulses.map(value => value.sample), 'pwm'),
    commandTimingErrorMs: Math.max(...impulses.map(value =>
      Math.abs(value.sentMs - value.plannedMs))) };
}

async function fullRangeBursts(context, durationMs) {
  return exercise(context, 0, async (rig, id, before) => {
    assert.ok(before[18] & 0x10, 'full-range sweep requires signed position telemetry');
    await configurePosition(rig, id, 6500);
    await pacedWrite(rig, id, 41, [100]);
    await pacedWrite(rig, id, 48, u16(1000));
    const home = await moveTo(rig, id, 0, 10000);
    const forward = await runSweep(rig, id, durationMs, false);
    const reverse = await runSweep(rig, id, durationMs, true);
    const settled = await observe(rig, id, 1000);
    const metrics = {
      forwardEndPosition: forward.endPosition,
      reverseEndPosition: reverse.endPosition,
      forwardTrackingError: forward.meanTrackingError,
      reverseTrackingError: reverse.meanTrackingError,
      settledError: Math.abs(settled.at(-1).position),
      tailPositionRange: Math.max(...settled.slice(-10).map(value => value.position)) -
        Math.min(...settled.slice(-10).map(value => value.position)),
      tailMeanAbsPwm: mean(settled.slice(-10).map(value => Math.abs(value.pwm))),
      speedVariation: mean([forward.speedVariation, reverse.speedVariation]),
      pwmVariation: mean([forward.pwmVariation, reverse.pwmVariation]),
    };
    assert.ok(metrics.settledError <= 100,
      'servo ' + id + ' did not return to zero: ' + metrics.settledError);
    return { exact: { completedImpulses: 66, alarmFree: true,
      durationMs }, evidence: { home, forward, reverse, settled, metrics } };
  });
}

function compareBursts(factory, candidate) {
  const a = factory.evidence.metrics;
  const b = candidate.evidence.metrics;
  const checks = [
    ['completed impulses', factory.exact.completedImpulses,
      candidate.exact.completedImpulses, 0],
    ['forward endpoint', a.forwardEndPosition, b.forwardEndPosition, 250],
    ['reverse endpoint', a.reverseEndPosition, b.reverseEndPosition, 250],
    ['forward tracking', a.forwardTrackingError, b.forwardTrackingError, 250],
    ['reverse tracking', a.reverseTrackingError, b.reverseTrackingError, 250],
    ['settled error', a.settledError, b.settledError, 50],
  ].map(([name, factoryValue, candidateValue, tolerance]) => ({
    name, factory: factoryValue, candidate: candidateValue, tolerance,
    matched: Math.abs(factoryValue - candidateValue) <= tolerance,
  }));
  return { matched: checks.every(check => check.matched), checks,
    exploratorySmoothness: {
      factory: { tailPositionRange: a.tailPositionRange,
        tailAbsPwm: a.tailMeanAbsPwm, speedVariation: a.speedVariation,
        pwmVariation: a.pwmVariation },
      candidate: { tailPositionRange: b.tailPositionRange,
        tailAbsPwm: b.tailMeanAbsPwm, speedVariation: b.speedVariation,
        pwmVariation: b.pwmVariation },
    } };
}

function estimatePlannerPhase(previous, current) {
  // The factory does not expose its internal phase flag. This is an estimate
  // from published active velocity/position, not a firmware-internal trace.
  const speed = current.activeVelocity;
  const distance = current.goal - current.activePosition;
  if (Math.abs(speed) <= 50 && Math.abs(distance) <= 20) return 'hold';
  if (Math.abs(speed) > 50 && Math.abs(distance) > 20 &&
      Math.sign(speed) !== Math.sign(distance)) return 'reversing';
  if (!previous) return 'unknown';
  const change = Math.abs(speed) - Math.abs(previous.activeVelocity);
  if (change > 25) return 'accelerating';
  if (change < -25) return 'braking';
  return 'steady';
}

async function fastSweepCapture(rig, id) {
  const commands = [
    ...sweepSchedule(1000, false),
    ...sweepSchedule(1000, true).map(value =>
      ({ atMs: 1000 + value.atMs, goal: value.goal })),
  ];
  const started = nowMs();
  const writes = [];
  const telemetry = [];
  let nextWrite = 0;
  let nextReadMs = 0;
  let goal = 0;
  while (nextWrite < commands.length || nowMs() - started < 3000) {
    const elapsed = nowMs() - started;
    const command = commands[nextWrite];
    const dueWriteMs = command?.atMs ?? Infinity;
    // Give the goal write priority if a READ would straddle its deadline.
    if (dueWriteMs <= elapsed + 2) {
      const wait = started + dueWriteMs - nowMs();
      if (wait > 0) await delay(wait);
      const sentMs = nowMs() - started;
      const reply = await rig.write(id, 42, encodeSign15(command.goal));
      assert.equal(reply.error, 0);
      goal = command.goal;
      writes.push({ plannedMs: dueWriteMs, sentMs,
        acknowledgedMs: nowMs() - started, goal });
      nextWrite++;
      continue;
    }
    if (nextReadMs <= elapsed && nextReadMs < dueWriteMs - 2 && elapsed < 3000) {
      const readStartedMs = nowMs() - started;
      const value = await sample(rig, id);
      assert.equal(value.status, 0, 'servo ' + id + ' alarm during fast sweep');
      const previous = telemetry.at(-1);
      const point = { readStartedMs, elapsedMs: nowMs() - started,
        goal, ...value };
      point.phaseEstimate = estimatePlannerPhase(previous, point);
      telemetry.push(point);
      nextReadMs += 4;
      while (nextReadMs <= nowMs() - started) nextReadMs += 4;
      continue;
    }
    const nextMs = Math.min(dueWriteMs, nextReadMs, 3000);
    const wait = started + nextMs - nowMs();
    if (wait > 0) await delay(wait);
  }
  const phaseTransitions = telemetry.filter((value, index) =>
    index === 0 || value.phaseEstimate !== telemetry[index - 1].phaseEstimate)
    .map(value => ({ elapsedMs: value.elapsedMs, goal: value.goal,
      activePosition: value.activePosition,
      activeVelocity: value.activeVelocity, phaseEstimate: value.phaseEstimate }));
  const at = timeMs => telemetry.filter(value => value.elapsedMs <= timeMs).at(-1);
  const cruise = telemetry.filter(value =>
    value.elapsedMs >= 500 && value.elapsedMs < 1000);
  const slope = cruise.map(value => {
    const earlier = telemetry.findLast(point =>
      point.elapsedMs <= value.elapsedMs - 20);
    return earlier ? (value.position - earlier.position) * 1000 /
      (value.elapsedMs - earlier.elapsedMs) : null;
  }).filter(value => value != null);
  const metrics = {
    sampleCount: telemetry.length,
    maximumReadGapMs: Math.max(...telemetry.slice(1).map((value, index) =>
      value.elapsedMs - telemetry[index].elapsedMs)),
    maximumWriteLatenessMs: Math.max(...writes.map(value =>
      value.sentMs - value.plannedMs)),
    forwardEndPosition: at(1000).position,
    forwardEndActive: at(1000).activePosition,
    reverseEndPosition: at(2000).position,
    reverseEndActive: at(2000).activePosition,
    settledError: Math.abs(telemetry.at(-1).position),
    cruise: {
      meanPwm: mean(cruise.map(value => value.pwm)),
      pwmStdDev: deviation(cruise.map(value => value.pwm)),
      meanMeasuredSpeed: mean(cruise.map(value => value.speed)),
      measuredSpeedStdDev: deviation(cruise.map(value => value.speed)),
      meanActiveVelocity: mean(cruise.map(value => value.activeVelocity)),
      activeVelocityStdDev: deviation(cruise.map(value => value.activeVelocity)),
      positionSlopeStdDev: deviation(slope),
    },
  };
  assert.equal(writes.length, 66);
  assert.ok(metrics.sampleCount >= 300,
    'high-rate telemetry collected only ' + metrics.sampleCount + ' samples');
  assert.ok(metrics.maximumWriteLatenessMs < 25,
    'high-rate reads delayed a goal by ' + metrics.maximumWriteLatenessMs + ' ms');
  assert.ok(metrics.settledError <= 100,
    'servo ' + id + ' did not settle after fast sweep');
  return { commands, writes, telemetry, phaseTransitions, metrics };
}

async function fullRangeFastTelemetry(context) {
  return exercise(context, 0, async (rig, id, before) => {
    assert.ok(before[18] & 0x10, 'fast sweep requires signed position telemetry');
    assert.ok(before[18] & 0x04, 'fast sweep requires direct velocity telemetry');
    await configurePosition(rig, id, 6500);
    await pacedWrite(rig, id, 41, [100]);
    await pacedWrite(rig, id, 48, u16(1000));
    const home = await moveTo(rig, id, 0, 10000);
    const captured = await fastSweepCapture(rig, id);
    return { exact: { completedImpulses: 66, alarmFree: true },
      evidence: { home, ...captured } };
  });
}

function compareFastTelemetry(factory, candidate) {
  const a = factory.evidence.metrics;
  const b = candidate.evidence.metrics;
  const checks = [
    ['completed impulses', factory.exact.completedImpulses,
      candidate.exact.completedImpulses, 0],
    ['forward measured endpoint', a.forwardEndPosition, b.forwardEndPosition, 250],
    ['forward active endpoint', a.forwardEndActive, b.forwardEndActive, 250],
    ['reverse measured endpoint', a.reverseEndPosition, b.reverseEndPosition, 250],
    ['reverse active endpoint', a.reverseEndActive, b.reverseEndActive, 250],
    ['settled error', a.settledError, b.settledError, 50],
  ].map(([name, factoryValue, candidateValue, tolerance]) => ({
    name, factory: factoryValue, candidate: candidateValue, tolerance,
    matched: Math.abs(factoryValue - candidateValue) <= tolerance,
  }));
  return { matched: checks.every(check => check.matched), checks,
    capture: { factory: { samples: a.sampleCount,
      maximumReadGapMs: a.maximumReadGapMs,
      maximumWriteLatenessMs: a.maximumWriteLatenessMs,
      cruise: a.cruise },
    candidate: { samples: b.sampleCount,
      maximumReadGapMs: b.maximumReadGapMs,
      maximumWriteLatenessMs: b.maximumWriteLatenessMs,
      cruise: b.cruise } } };
}

function outsideSummary(requested, readback, samples) {
  const final = samples.at(-1);
  return {
    requested, readback, finalPosition: final.position,
    finalActive: final.activePosition,
    activeOutside: samples.some(value =>
      value.activePosition < 0 || value.activePosition > 4095),
    presentOutside: samples.some(value =>
      value.position < 0 || value.position > 4095),
    finalError: final.position - requested,
  };
}

async function regularBoundary(context) {
  return exercise(context, 0, async (rig, id, before) => {
    assert.ok(before[18] & 0x10, 'boundary case requires signed position telemetry');
    await configurePosition(rig, id, 1800);
    const segments = [];
    for (const [start, requested] of [[128, -256], [3968, 4352]]) {
      const setup = await moveTo(rig, id, start);
      const reply = await rig.write(id, 42, encodeSign15(requested));
      assert.equal(reply.error, 0);
      const readback = [...await rig.read(id, 42, 2)];
      const samples = await observe(rig, id, 2000);
      segments.push({ start, setup, ...outsideSummary(requested, readback, samples),
        samples });
    }
    return { exact: { boundaries: segments.length, alarmFree: true },
      evidence: { segments } };
  });
}

async function relativeBoundary(context) {
  return exercise(context, 0, async (rig, id, before) => {
    assert.ok(before[18] & 0x10, 'multi-turn case requires signed position telemetry');
    await configurePosition(rig, id, 1800);
    const segments = [];
    for (const [start, relativeGoal] of [[128, -512], [3968, 512]]) {
      const setup = await moveTo(rig, id, start);
      await rig.write(id, 40, [0]);
      await rig.write(id, 33, [3]);
      await configurePosition(rig, id, 1800);
      const reply = await rig.write(id, 42, encodeSign15(relativeGoal));
      assert.equal(reply.error, 0);
      const readback = [...await rig.read(id, 42, 2)];
      const samples = await observe(rig, id, 2200);
      await rig.write(id, 40, [0]);
      await rig.write(id, 33, [0]);
      await delay(40);
      const absoluteAfter = await sample(rig, id);
      assert.equal(absoluteAfter.status, 0);
      segments.push({ start, setup, relativeGoal, readback,
        initialRelative: samples[0].position,
        finalRelative: samples.at(-1).position,
        absoluteAfter: absoluteAfter.position,
        crossedBoundary: absoluteAfter.position < 0 || absoluteAfter.position > 4095,
        samples });
      await configurePosition(rig, id, 1800);
    }
    return { exact: { boundaries: segments.length, alarmFree: true },
      evidence: { segments } };
  });
}

function compareBoundaries(factory, candidate, relative) {
  const checks = factory.evidence.segments.flatMap((item, index) => {
    const other = candidate.evidence.segments[index];
    const scalar = (name, a, b, tolerance) => ({
      name: item.start + ' ' + name, factory: a, candidate: b, tolerance,
      matched: Math.abs(a - b) <= tolerance,
    });
    const categorical = (name, a, b) => ({
      name: item.start + ' ' + name, factory: a, candidate: b,
      matched: a === b,
    });
    if (relative) return [
      categorical('crossed boundary', item.crossedBoundary, other.crossedBoundary),
      scalar('relative endpoint', item.finalRelative, other.finalRelative, 70),
      scalar('absolute endpoint', item.absoluteAfter, other.absoluteAfter, 100),
    ];
    return [
      categorical('active outside', item.activeOutside, other.activeOutside),
      categorical('present outside', item.presentOutside, other.presentOutside),
      scalar('active endpoint', item.finalActive, other.finalActive, 100),
      scalar('position endpoint', item.finalPosition, other.finalPosition, 100),
    ];
  });
  return { matched: checks.every(check => check.matched), checks };
}

function plateau(samples) {
  const tail = samples.filter(value => value.elapsedMs >= 2500);
  return {
    medianMeasuredSpeed: median(tail.map(value => Math.abs(value.speed))),
    medianActiveSpeed: median(tail.map(value => Math.abs(value.activeVelocity))),
    peakMeasuredSpeed: Math.max(...samples.map(value => Math.abs(value.speed))),
    peakPwm: Math.max(...samples.map(value => Math.abs(value.pwm))),
    peakCurrent: Math.max(...samples.map(value => Math.abs(value.current))),
    temperatureRise: samples.at(-1).temperature - samples[0].temperature,
  };
}

async function maxConstantSpeed(context) {
  return exercise(context, 1, async (rig, id, before) => {
    assert.ok(before[18] & 0x04, 'max-speed test requires direct velocity units');
    const maximum = before[84] * 50;
    assert.ok(maximum >= 1000 && maximum <= 32767,
      'unusable configured maximum speed ' + maximum);
    await pacedWrite(rig, id, 41, [100]);
    await pacedWrite(rig, id, 48, u16(1000));
    const segments = [];
    for (const direction of [1, -1]) {
      const goal = direction * maximum;
      const reply = await rig.write(id, 46, encodeSign15(goal));
      assert.equal(reply.error, 0);
      const samples = await observe(rig, id, 5000);
      const metrics = plateau(samples);
      assert.ok(metrics.medianActiveSpeed >= maximum * 0.6,
        'servo ' + id + ' profile did not approach max speed');
      segments.push({ goal, metrics, samples });
    }
    await rig.write(id, 46, encodeSign15(0));
    const stopped = await observe(rig, id, 1500);
    assert.ok(Math.abs(stopped.at(-1).activeVelocity) <= 100,
      'max-speed profile did not decelerate');
    return { exact: { commandedMaximum: maximum, bothDirections: true,
      stopped: true, alarmFree: true },
    evidence: { segments, stopped } };
  });
}

function compareMaxSpeed(factory, candidate) {
  const checks = [];
  for (let index = 0; index < 2; index++) {
    const a = factory.evidence.segments[index].metrics;
    const b = candidate.evidence.segments[index].metrics;
    for (const [name, tolerance] of [
      ['medianMeasuredSpeed', 700], ['medianActiveSpeed', 350],
      ['peakMeasuredSpeed', 900],
    ]) {
      checks.push({ name: (index ? 'reverse ' : 'forward ') + name,
        factory: a[name], candidate: b[name], tolerance,
        matched: Math.abs(a[name] - b[name]) <= tolerance });
    }
  }
  return { matched: checks.every(check => check.matched), checks };
}

module.exports = [
  { id: 'test_full_range_atomic_bursts_1s_fast_telemetry',
    scope: 'device', risk: 'motion', stages: ['extended-motion-fast'],
    covers: { modes: [0], registers: [41, 42, 43, 46, 47, 48, 49,
      56, 57, 58, 59, 60, 61, 66, 67, 68, 71, 72],
    durationMs: 1000, impulsesPerDirection: 33,
    requestedTelemetryIntervalMs: 4 },
    compare: compareFastTelemetry, run: fullRangeFastTelemetry },
  ...[1000, 2000, 3000].map(durationMs => ({
    id: 'test_full_range_atomic_bursts_' + durationMs / 1000 + 's',
    scope: 'device', risk: 'motion', stages: ['extended-motion'],
    covers: { modes: [0], registers: [41, 42, 43, 46, 47, 48, 49],
      range: [0, 4095], durationMs, atomicGoalWrite: true,
      impulsesPerDirection: 33, irregularPauses: true },
    compare: compareBursts,
    run: context => fullRangeBursts(context, durationMs),
  })),
  { id: 'test_regular_position_outside_4096_boundary',
    scope: 'device', risk: 'motion', stages: ['extended-motion'],
    covers: { modes: [0], registers: [33, 42, 43, 56, 57, 67, 68],
      requestedGoals: [-256, 4352] },
    compare: (factory, candidate) => compareBoundaries(factory, candidate, false),
    run: regularBoundary },
  { id: 'test_multiturn_relative_outside_4096_boundary',
    scope: 'device', risk: 'motion', stages: ['extended-motion'],
    covers: { modes: [0, 3], registers: [33, 42, 43, 56, 57, 67, 68],
      relativeGoals: [-512, 512] },
    compare: (factory, candidate) => compareBoundaries(factory, candidate, true),
    run: relativeBoundary },
  { id: 'test_constant_speed_configured_maximum_long_run',
    scope: 'device', risk: 'motion', stages: ['extended-motion'],
    covers: { modes: [1], registers: [33, 41, 46, 47, 48, 49, 58, 59, 71, 72, 84],
      directionDurationMs: 5000 },
    compare: compareMaxSpeed, run: maxConstantSpeed },
];
