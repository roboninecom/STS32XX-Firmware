'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { sample, pacedWrite, exercise } = require('../motion');
const { encodeSign15 } = require('../position');

const nowMs = () => Number(process.hrtime.bigint()) / 1e6;
const u16 = value => [value & 255, value >> 8];
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const variation = (values, key) => mean(values.slice(1).map((item, index) =>
  Math.abs(item[key] - values[index][key])));

async function moveTo(rig, id, goal) {
  const reply = await rig.write(id, 42, encodeSign15(goal));
  assert.equal(reply.error, 0);
  const deadline = nowMs() + 10000;
  while (nowMs() < deadline) {
    const point = await sample(rig, id);
    assert.equal(point.status, 0, `servo ${id} alarm while homing`);
    if (Math.abs(point.position - goal) <= 35 && Math.abs(point.speed) <= 120) return point;
    await delay(25);
  }
  throw new Error(`servo ${id} did not reach start position ${goal}`);
}

// The physical sweep duration is fixed; rate changes only the goal step size.
function schedule(rateHz) {
  const steps = rateHz * 4;
  return Array.from({ length: 2 * steps + 1 }, (_, index) => ({
    plannedMs: index * 1000 / rateHz,
    goal: Math.round(4095 * (index <= steps ? index : 2 * steps - index) / steps),
  }));
}

async function sweep(context, rateHz) {
  // Start from the saved template even if an interactive utility left RAM
  // settings different from EEPROM; exercise verifies the same saved image.
  await context.rig.reset(context.id);
  return exercise(context, 0, async (rig, id, before) => {
    assert.ok(before[18] & 0x10, 'fixed-rate sweep requires signed position telemetry');
    await pacedWrite(rig, id, 41, [100]);
    await pacedWrite(rig, id, 46, encodeSign15(6500));
    await pacedWrite(rig, id, 48, u16(1000));
    const home = await moveTo(rig, id, 0);
    const commands = schedule(rateHz);
    const writes = [];
    const telemetry = [];
    const started = nowMs();
    // Keep telemetry near 50 ms at every write rate so read traffic does not
    // increase with command frequency. Always sample the turn and endpoints.
    const readEvery = Math.max(1, Math.round(rateHz / 20));
    const turnIndex = rateHz * 4;
    for (let index = 0; index < commands.length; ++index) {
      const command = commands[index];
      const remaining = started + command.plannedMs - nowMs();
      if (remaining > 0) await delay(remaining);
      const sentMs = nowMs() - started;
      const reply = await rig.write(id, 42, encodeSign15(command.goal));
      assert.equal(reply.error, 0);
      writes.push({ ...command, sentMs, acknowledgedMs: nowMs() - started });
      if (index % readEvery === 0 || index === turnIndex || index === commands.length - 1) {
        const point = await sample(rig, id);
        assert.equal(point.status, 0, `servo ${id} alarm during ${rateHz} Hz sweep`);
        telemetry.push({ commandIndex: index, elapsedMs: nowMs() - started,
          goal: command.goal, ...point });
      }
    }
    const settled = [];
    const settlingStarted = nowMs();
    while (nowMs() - settlingStarted < 1000) {
      const point = await sample(rig, id);
      assert.equal(point.status, 0, `servo ${id} alarm while settling`);
      settled.push({ elapsedMs: nowMs() - settlingStarted, ...point });
      await delay(25);
    }
    const timingError = writes.map(item => item.sentMs - item.plannedMs);
    const turn = telemetry.find(item => item.commandIndex === turnIndex);
    const tracking = telemetry.map(item => Math.abs(item.position - item.goal));
    const metrics = {
      actualDurationMs: writes.at(-1).sentMs - writes[0].sentMs,
      maximumWriteLatenessMs: Math.max(...timingError),
      meanAbsWriteLatenessMs: mean(timingError.map(Math.abs)),
      writesLateByOnePeriod: timingError.filter(value => value >= 1000 / rateHz).length,
      telemetryCount: telemetry.length,
      forwardEndPosition: turn.position,
      forwardEndActive: turn.activePosition,
      reverseEndPosition: telemetry.at(-1).position,
      reverseEndActive: telemetry.at(-1).activePosition,
      settledError: Math.abs(settled.at(-1).position),
      meanTrackingError: mean(tracking),
      maximumTrackingError: Math.max(...tracking),
      speedVariation: variation(telemetry, 'speed'),
      pwmVariation: variation(telemetry, 'pwm'),
    };
    assert.ok(metrics.actualDurationMs < 8100 && metrics.maximumWriteLatenessMs < 100,
      `host could not sustain the ${rateHz} Hz sweep`);
    assert.ok(metrics.settledError <= 100,
      `servo ${id} did not settle at zero: ${metrics.settledError}`);
    return { exact: { rateHz, completedGoals: commands.length, alarmFree: true },
      evidence: { home, writes, telemetry, settled, metrics } };
  });
}

function compare(factory, candidate) {
  const a = factory.evidence.metrics;
  const b = candidate.evidence.metrics;
  const checks = [
    ['goal count', factory.exact.completedGoals, candidate.exact.completedGoals, 0],
    ['forward measured endpoint', a.forwardEndPosition, b.forwardEndPosition, 200],
    ['forward active endpoint', a.forwardEndActive, b.forwardEndActive, 200],
    ['reverse measured endpoint', a.reverseEndPosition, b.reverseEndPosition, 200],
    ['reverse active endpoint', a.reverseEndActive, b.reverseEndActive, 200],
    ['settled error', a.settledError, b.settledError, 50],
  ].map(([name, factoryValue, candidateValue, tolerance]) => ({
    name, factory: factoryValue, candidate: candidateValue, tolerance,
    matched: Math.abs(factoryValue - candidateValue) <= tolerance,
  }));
  return { matched: checks.every(check => check.matched), checks,
    exploratory: { factory: { tracking: a.meanTrackingError,
      speedVariation: a.speedVariation, pwmVariation: a.pwmVariation },
    candidate: { tracking: b.meanTrackingError,
      speedVariation: b.speedVariation, pwmVariation: b.pwmVariation } } };
}

module.exports = [20, 40, 60, 80, 100, 150, 200].map(rateHz => ({
  id: `test_full_range_fixed_rate_${rateHz}hz`,
  scope: 'device', risk: 'motion', stages: ['fixed-rate-motion'],
  covers: { modes: [0], registers: [41, 42, 43, 46, 47, 48, 49,
    56, 57, 58, 59, 60, 61, 66, 67, 68, 71, 72],
  range: [0, 4095], directionDurationMs: 4000,
  goalWriteRateHz: rateHz, telemetryReadEvery: Math.max(1, Math.round(rateHz / 20)) },
  compare, run: context => sweep(context, rateHz),
}));
