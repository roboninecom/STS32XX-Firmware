'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { PacketEncoder, Instruction } = require('../../../../../host/servo-driver');
const { positionDelta, nearbyLogicalPosition, encodeSign15 } = require('../position');
const { CleanupError } = require('../errors');

function decodePosition(bytes) {
  const raw = bytes[0] | (bytes[1] << 8);
  return raw & 0x8000 ? -(raw & 0x7fff) : raw;
}

async function resetAndVerify(rig, id, before) {
  await rig.reset(id);
  const after = await rig.read(id, 0, 87);
  for (const [start, end] of [[4, 40], [78, 87]]) {
    assert.deepEqual(after.subarray(start, end), before.subarray(start, end),
      `persistent settings ${start}..${end - 1} changed during rapid test`);
  }
  assert.equal(after[40], 0, 'torque was not disabled after reset');
}

async function exercise({ rig, id }, paced, options = {}) {
    const before = await rig.read(id, 0, 87);
    let bodyError;
    let result;
    try {
      await rig.write(id, 55, [2]); // Keep EEPROM writes non-persistent.
      if (before[33] !== 0) await rig.write(id, 33, [0]);
      if (before[9] !== before[11] || before[10] !== before[12]) {
        await rig.write(id, 9, [0, 0, 0, 0]); // Disable goal clamp for this case.
      }
      await rig.write(id, 40, [0]);
      await rig.exchange(`encoder-home:${id}`,
        PacketEncoder.frame(id, Instruction.ENCODER_HOME), {
          match: response => response.id === id && response.parameters.length === 0,
        });
      await delay(40);
      const baselineTelemetry = await rig.read(id, 56, 17);
      const baselinePresent = decodePosition(baselineTelemetry.subarray(0, 2));
      const baselineActive = decodePosition(baselineTelemetry.subarray(11, 13));
      const signedPosition = (before[18] & 0x10) !== 0;
      const origin = nearbyLogicalPosition(baselinePresent, signedPosition);
      const direction = signedPosition && origin > 3800 ? -1 : 1;
      const goal = origin + direction * 256;
      const goalBytes = encodeSign15(goal);
      const frames = [
        PacketEncoder.frame(id, Instruction.WRITE, [41, 20]),
        PacketEncoder.frame(id, Instruction.WRITE, [42, ...goalBytes]),
        PacketEncoder.frame(id, Instruction.WRITE, [46, 200, 0]),
        PacketEncoder.frame(id, Instruction.WRITE, [48, 244, 1]), // PWM cap 500
      ];
      if (paced) {
        // The goal write is the motion trigger. Configure its dependencies
        // first so this case measures acknowledged writes rather than whether
        // a later velocity/cap write happens to retrigger an earlier goal.
        const values = new Map([[41, [20]], [42, goalBytes], [46, [200, 0]],
          [48, [244, 1]]]);
        const order = options.order ?? [41, 46, 48, 42];
        for (const address of order) {
          const data = values.get(address);
          await rig.write(id, address, data);
          if (options.gapMs) await delay(options.gapMs);
        }
      } else {
        await rig.exchange(`rapid-four-writes:${id}`, Buffer.concat(frames), { kind: 'send' });
        await delay(60); // Let uncollected status replies drain before reads.
      }
      const readback = await rig.read(id, 41, 9);
      assert.equal(readback[0], 20, 'acceleration write lost');
      assert.deepEqual([...readback.subarray(1, 3)], goalBytes, 'position write lost');
      assert.deepEqual([...readback.subarray(5, 7)], [200, 0], 'velocity write lost');
      assert.deepEqual([...readback.subarray(7, 9)], [244, 1], 'torque-limit write lost');

      const trace = [];
      const deadline = Date.now() + 2600;
      do {
        const telemetry = await rig.read(id, 56, 17);
        const active = decodePosition(telemetry.subarray(11, 13));
        const present = decodePosition(telemetry.subarray(0, 2));
        const status = telemetry[9];
        trace.push({ elapsedMs: 2600 - Math.max(0, deadline - Date.now()),
          present, active,
          presentDelta: direction * positionDelta(present, baselinePresent, signedPosition),
          activeDelta: direction * positionDelta(active, baselineActive, signedPosition),
          status, moving: telemetry[10] });
        if (status) throw new Error(`servo status became ${status} during rapid writes`);
        if (trace.at(-1).activeDelta >= 180 && trace.at(-1).presentDelta >= 100) break;
        await delay(25);
      } while (Date.now() < deadline);
      const torque = (await rig.read(id, 40, 1))[0];
      result = { exact: {
        fourRegistersChanged: true,
        profileStarted: trace.some(sample => sample.activeDelta >= 40),
        shaftMoved: trace.some(sample => sample.presentDelta >= 40),
        torqueEnabled: torque === 1,
      },
        evidence: { readback: [...readback], baselinePresent, baselineActive, goal,
          direction, trace } };
    } catch (error) {
      bodyError = error;
    }
    try { await resetAndVerify(rig, id, before); }
    catch (cleanupError) {
      throw new CleanupError(`Rapid-write cleanup failed for ID ${id}`,
        bodyError, cleanupError);
    }
    if (bodyError) throw bodyError;
    return result;
}

const covers = { commands: ['WRITE', 'ENCODER_HOME', 'SYSTEM_RESET'],
  registers: ['acceleration', 'targetPosition', 'goalVelocity', 'torqueLimit'], modes: [0] };

function compareRapidWrites(factory, candidate) {
  const checks = [
    { name: 'all writes retained', matched: factory.exact.fourRegistersChanged &&
      candidate.exact.fourRegistersChanged },
    { name: 'candidate profile is not less responsive',
      matched: !factory.exact.profileStarted || candidate.exact.profileStarted },
    { name: 'candidate shaft is not less responsive',
      matched: !factory.exact.shaftMoved || candidate.exact.shaftMoved },
    { name: 'candidate torque is not less responsive',
      matched: !factory.exact.torqueEnabled || candidate.exact.torqueEnabled },
  ];
  return { matched: checks.every(check => check.matched), checks };
}

async function writeOrderMatrix(context) {
  const scenarios = [
    { name: 'goal-first-gap-0', order: [42, 41, 46, 48], gapMs: 0 },
    { name: 'goal-last-gap-0', order: [41, 46, 48, 42], gapMs: 0 },
    { name: 'goal-first-gap-10', order: [42, 41, 46, 48], gapMs: 10 },
    { name: 'goal-last-gap-10', order: [41, 46, 48, 42], gapMs: 10 },
  ];
  const observations = [];
  for (const scenario of scenarios) {
    const result = await exercise(context, true, scenario);
    observations.push({ ...scenario, outcome: result.exact, evidence: result.evidence });
  }
  return { exact: { scenarios: observations.map(item => ({ name: item.name,
    ...item.outcome })) }, evidence: { observations } };
}

module.exports = [
  { id: 'test_rapid_atomic_register_writes', scope: 'device', risk: 'motion',
    stages: ['rapid'], covers, compare: compareRapidWrites,
    run: context => exercise(context, false) },
  { id: 'test_paced_atomic_register_writes', scope: 'device', risk: 'motion',
    stages: ['rapid'], covers, requiresFactoryEffect: true,
    validateFactoryStimulus: result => ({
      valid: result.exact.fourRegistersChanged && result.exact.torqueEnabled &&
        result.exact.profileStarted && result.exact.shaftMoved,
      reason: 'factory accepted the writes but the goal-last sequence did not start motion',
    }),
    run: context => exercise(context, true) },
  { id: 'test_motion_write_order_gap_matrix', scope: 'device', risk: 'motion',
    stages: ['rapid'], covers: { ...covers,
      timing: ['acknowledged-write-order', 'inter-write-gap'] },
    compare: (factory, candidate) => {
      const checks = factory.exact.scenarios.flatMap((scenario, index) => {
        const other = candidate.exact.scenarios[index];
        return ['profileStarted', 'shaftMoved', 'torqueEnabled'].map(field => ({
          name: `${scenario.name} ${field}`, factory: scenario[field], candidate: other[field],
          matched: scenario[field] === other[field] }));
      });
      return { matched: checks.every(check => check.matched), checks };
    }, run: writeOrderMatrix },
];
