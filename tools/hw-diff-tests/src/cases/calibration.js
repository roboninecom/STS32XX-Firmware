'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { Instruction, PacketEncoder } = require('../../../../host/servo-driver');
const { sample } = require('../motion');
const { encodeSign15, decodeOffset, calibrationExpectation, circularError } = require('../position');
const { CleanupError } = require('../errors');
const { persistentBytes } = require('../register-image');
const { classify } = require('../calibration-classify');

const elapsed = start => Number(process.hrtime.bigint() - start) / 1e6;
const REPETITIONS = 3;
const RESTORE_DELAYS_MS = [0, 20, 150];
const correction = bytes => bytes[31] | (bytes[32] << 8);
const le16 = value => [value & 0xff, value >> 8];

async function state(rig, id, start) {
  const bytes = await rig.read(id, 0, 87);
  const live = await sample(rig, id);
  return { atMs: elapsed(start), correction: correction(bytes), position: live.position,
    sensorStatus: live.status, voltage: live.voltage, temperature: live.temperature,
    torque: bytes[40], lock: bytes[55] };
}

// PING recovery precedes the first valid encoder/ADC pair. The explicit
// target case needs a physical-angle baseline, unlike the alarm timing case.
async function readyState(rig, id, start) {
  let previous;
  for (let attempt = 0; attempt < 100; attempt++) {
    const current = await state(rig, id, start);
    const healthy = !(current.sensorStatus & 2) && current.voltage > 0;
    if (healthy && previous &&
        Math.abs(circularError(current.position, previous.position)) <= 4) return current;
    previous = healthy ? current : undefined;
    await delay(5);
  }
  throw new Error(`servo ${id} has no stable healthy calibration baseline`);
}

async function fastReset(rig, id, start) {
  const sentAtMs = elapsed(start);
  await rig.exchange(`calibration-reset:${id}`, PacketEncoder.frame(id, Instruction.SYSTEM_RESET),
    { kind: 'send' });
  let recoveredAtMs;
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      await rig.exchange(`calibration-reconnect:${id}`, PacketEncoder.frame(id, Instruction.PING), {
        match: response => response.id === id && response.parameters.length === 0,
        timeoutMs: 20,
      });
      recoveredAtMs = elapsed(start);
      break;
    } catch (error) {
      if (!/Timeout|MissingResponse/.test(error.name)) throw error;
      await delay(5);
    }
  }
  if (recoveredAtMs == null) throw new Error(`servo ${id} did not reconnect after calibration reset`);
  return { sentAtMs, recoveredAtMs, recoveryMs: recoveredAtMs - sentAtMs };
}

async function samplesFor(rig, id, start, durationMs = 500) {
  const windowStart = process.hrtime.bigint();
  const samples = [];
  let due = 0;
  while (Number(process.hrtime.bigint() - windowStart) / 1e6 < durationMs) {
    const wait = due - Number(process.hrtime.bigint() - windowStart) / 1e6;
    if (wait > 0) await delay(wait);
    const live = await sample(rig, id);
    samples.push({ atMs: elapsed(start), position: live.position, status: live.status });
    due += 5;
  }
  return samples;
}

async function moveTo(rig, id, target) {
  const before = await rig.read(id, 0, 87);
  assert.equal(before[33], 0, 'calibration positioning requires position mode');
  assert.ok(before[18] & 0x10, 'calibration positioning requires signed position telemetry');
  assert.equal(before[40], 0, 'positioning requires torque off at entry');
  assert.equal(before[55], 1, 'calibration requires persistence locked at entry');
  await rig.write(id, 55, [2]);
  await rig.write(id, 9, [0, 0, 0, 0]);
  await rig.write(id, 41, [40]);
  await rig.write(id, 46, encodeSign15(1500));
  await rig.write(id, 48, le16(650));
  await rig.write(id, 42, encodeSign15(target));
  const deadline = Date.now() + 7000;
  let last;
  while (Date.now() < deadline) {
    last = await sample(rig, id);
    if (last.status !== 0) throw new Error(`alarm 0x${last.status.toString(16)} during positioning`);
    if (Math.abs(last.position - target) <= 20 && Math.abs(last.speed) <= 50) break;
    await delay(20);
  }
  assert.ok(last && Math.abs(last.position - target) <= 20,
    `positioning to ${target} ended at ${last?.position}`);
  await rig.write(id, 40, [0]);
  await delay(40);
  const stopped = await sample(rig, id);
  assert.equal(stopped.pwm, 0);
  assert.equal(stopped.status, 0);
  return stopped.position;
}

async function restoreOriginal(rig, id, before) {
  await rig.write(id, 40, [0]);
  await rig.write(id, 55, [0]);
  await rig.write(id, 31, [...before.subarray(31, 33)]);
  await rig.reset(id);
  const after = await rig.read(id, 0, 87);
  assert.deepEqual(persistentBytes(after), persistentBytes(before),
    'calibration cleanup did not restore the full persistent image');
  assert.equal(after[40], 0, 'calibration cleanup left torque enabled');
  assert.equal(after[55], 1, 'calibration cleanup left persistence unlocked');
  let live = await sample(rig, id);
  let cleanupExtraReset = false;
  if (live.status & 2) {
    await rig.reset(id);
    cleanupExtraReset = true;
    live = await sample(rig, id);
    assert.equal(live.status & 2, 0, 'sensor alarm persisted after cleanup reset');
  }
  return { correction: correction(after), sensorStatus: live.status,
    persistentImageRestored: true, torqueOff: true, cleanupExtraReset };
}

async function runCalibration({ rig, id, role }) {
  const before = await rig.read(id, 0, 87);
  assert.equal(before[40], 0, 'calibration case requires torque off');
  assert.equal(before[55], 1, 'calibration case requires persistence locked');
  assert.equal(before[33], 0, 'calibration case requires position mode');
  assert.ok(before[18] & 0x10, 'calibration case requires signed telemetry');
  rig.events.push({ label: `calibration-pretest-snapshot:${id}`, kind: 'evidence',
    registerBytes: before.toString('hex') });
  const iterations = [];
  let operationError;
  let cleanup;
  try {
    for (const target of [2048, 4094]) {
      await moveTo(rig, id, target);
      for (let repetition = 1; repetition <= REPETITIONS; repetition++) {
        const start = process.hrtime.bigint();
        const iteration = { role, id, target, repetition };
        iterations.push(iteration);
        iteration.before = await state(rig, id, start);
        assert.equal(iteration.before.torque, 0);
        iteration.calibrationResponseStatus =
          (await rig.command(id, Instruction.POSITION_CALIBRATE)).error;
        iteration.calibrationResponseAtMs = elapsed(start);
        iteration.afterZeroParameterCalibration = await state(rig, id, start);
        iteration.postCalibrationWindow = await samplesFor(rig, id, start);
        iteration.calibrationReset = await fastReset(rig, id, start);
        iteration.afterCalibrationReset = await state(rig, id, start);
        iteration.preRestoreWaitMs = RESTORE_DELAYS_MS[repetition - 1];
        iteration.preRestoreWindow = iteration.preRestoreWaitMs
          ? await samplesFor(rig, id, start, iteration.preRestoreWaitMs) : [];
        iteration.afterPreRestoreWait = iteration.preRestoreWaitMs
          ? await state(rig, id, start) : iteration.afterCalibrationReset;
        await rig.write(id, 55, [0]);
        const writeStart = process.hrtime.bigint();
        iteration.restoreResponseStatus =
          (await rig.write(id, 31, [...before.subarray(31, 33)])).error;
        iteration.restoreResponseAtMs = elapsed(start);
        iteration.eepromWriteDurationMs = elapsed(writeStart);
        iteration.afterRestoreWrite = await state(rig, id, start);
        iteration.postRestoreWindow = await samplesFor(rig, id, start);
        iteration.immediateReset = await fastReset(rig, id, start);
        iteration.afterImmediateReset = await state(rig, id, start);
        iteration.firstWindow = await samplesFor(rig, id, start);
        iteration.preMalformed = await state(rig, id, start);
        const malformed = await rig.command(id, Instruction.POSITION_CALIBRATE, [0]);
        iteration.malformedResponseStatus = malformed.error;
        iteration.malformedResponseAtMs = elapsed(start);
        iteration.postMalformed = await state(rig, id, start);
        iteration.secondWindow = await samplesFor(rig, id, start);
        iteration.afterWait = await state(rig, id, start);
        if (iteration.afterWait.sensorStatus & 2) {
          iteration.extraReset = await fastReset(rig, id, start);
          iteration.afterExtraReset = await state(rig, id, start);
        }
        Object.assign(iteration, classify(iteration));
        rig.events.push({ label: `calibration-iteration:${id}:${target}:${repetition}`,
          kind: 'evidence', iteration });
        if (iteration.correctionOrTorqueChanged) {
          throw new Error('malformed 0x0B changed correction or torque');
        }
        if (iteration.afterWait.sensorStatus & 2 &&
            iteration.afterExtraReset?.sensorStatus & 2) {
          throw new Error('sensor alarm persisted after extra reset; stopping further motion');
        }
      }
    }
  } catch (error) {
    operationError = error;
    rig.events.push({ label: `calibration-partial-evidence:${id}`, kind: 'evidence',
      error: { name: error.name, message: error.message }, iterations });
  }
  try { cleanup = await restoreOriginal(rig, id, before); }
  catch (cleanupError) {
    throw new CleanupError(`calibration cleanup failed on ID ${id}`,
      operationError, cleanupError);
  }
  if (operationError) throw operationError;
  return { exact: { iterations: iterations.length, cleanupRecovered: true },
    evidence: { role, initialRegisterBytes: before.toString('hex'),
      iterations, cleanup } };
}

async function runExplicitTargets({ rig, id, role }) {
  const before = await rig.read(id, 0, 87);
  assert.equal(before[40], 0, 'explicit calibration requires torque off');
  assert.equal(before[33], 0, 'explicit calibration requires position mode');
  assert.equal(before[55], 1, 'explicit calibration requires persistence locked');
  assert.ok(before[18] & 0x10, 'explicit calibration requires signed position telemetry');
  rig.events.push({ label: `calibration-target-pretest-snapshot:${id}`, kind: 'evidence',
    registerBytes: before.toString('hex') });
  const observations = [];
  let operationError;
  let cleanup;
  try {
    for (const target of [2048, 0, -1, -2, -2048, -4095]) {
      const started = process.hrtime.bigint();
      if (target === -1) {
        const beforeRejected = await rig.read(id, 0, 87);
        const silent = await rig.expectSilence(`calibration-target-embedded-header:${id}`,
          PacketEncoder.frame(id, Instruction.POSITION_CALIBRATE, [0xff, 0xff]), id);
        assert.ok(silent, 'calibration target -1 unexpectedly received a response');
        await rig.ping(id);
        const afterRejected = await rig.read(id, 0, 87);
        assert.equal(correction(afterRejected), correction(beforeRejected),
          'rejected -1 calibration changed correction');
        observations.push({ target, expectedDisplay: 4095,
          rejectedEmbeddedHeader: true, silent, correction: correction(afterRejected) });
        continue;
      }
      const expectedDisplay = ((target % 4096) + 4096) % 4096;
      const beforeTarget = await readyState(rig, id, started);
      const expectation = calibrationExpectation(beforeTarget.position, beforeTarget.correction, target);
      const response = await rig.setOffset(id, target);
      await delay(35);
      const immediate = await sample(rig, id);
      const immediateError = circularError(immediate.position, expectedDisplay);
      const afterCommand = await rig.read(id, 0, 87);
      const reset = await fastReset(rig, id, started);
      const afterReset = await readyState(rig, id, started);
      const resetError = circularError(afterReset.position, expectation.expectedReset);
      const afterResetBytes = await rig.read(id, 0, 87);
      assert.equal(correction(afterResetBytes), correction(afterCommand),
        `explicit calibration ${target} correction did not survive reset`);
      observations.push({ target, expectedDisplay, beforeTarget, expectation,
        storedOffsetError: decodeOffset(correction(afterCommand)) - expectation.storedOffset,
        responseStatus: response.error,
        correction: correction(afterCommand), immediate, immediateError,
        reset, resetCorrection: correction(afterResetBytes), afterReset, resetError });
    }
  } catch (error) { operationError = error; }
  try { cleanup = await restoreOriginal(rig, id, before); }
  catch (cleanupError) {
    throw new CleanupError(`explicit calibration cleanup failed on ID ${id}`,
      operationError, cleanupError);
  }
  if (operationError) throw operationError;
  return { exact: { targetsObserved: observations.map(item => item.target),
    embeddedHeaderTargetRejected: observations.some(item => item.rejectedEmbeddedHeader),
    survivedReset: true, cleanupRecovered: true },
  evidence: { role, observations, cleanup } };
}

module.exports = [{
  id: 'test_calibration_encoder_alarm_after_offset_restore', scope: 'device',
  risk: 'motion', stages: ['calibration'], requiresPersistenceWrite: true,
  covers: { commands: ['POSITION_CALIBRATE', 'SYSTEM_RESET', 'WRITE'],
    registers: [31, 32, 40, 55, 56, 57, 62, 63, 65],
    persistence: ['calibration-commit', 'offset-restore'] },
  compare: (factory, candidate) => {
    // Transient alarms are not synchronized between physical encoders. The
    // diagnostic question is which operation first produced an alarm, so
    // compare observed alarm types/phases, not repetition or position counts.
    const signature = item => {
      const phase = ['after immediate reset', 'first observation window']
        .includes(item.firstAlarmPhase) ? 'post-reset acquisition' : item.firstAlarmPhase;
      return `${item.classification}: ${phase}`;
    };
    const alarms = iterations => [...new Set(iterations
      .filter(item => item.classification !== 'healthy throughout')
      .map(signature))].sort();
    const factoryAlarms = alarms(factory.evidence.iterations);
    const candidateAlarms = alarms(candidate.evidence.iterations);
    const checks = [{ name: 'alarm type and first phase', factory: factoryAlarms,
      candidate: candidateAlarms,
      matched: JSON.stringify(factoryAlarms) === JSON.stringify(candidateAlarms) }];
    return { matched: checks.every(check => check.matched), checks };
  },
  run: runCalibration,
}, {
  id: 'test_calibration_explicit_signed_targets', scope: 'device', risk: 'safe',
  stages: ['calibration'], requiresPersistenceWrite: true,
  covers: { commands: ['POSITION_CALIBRATE', 'SYSTEM_RESET'],
    registers: [18, 31, 32, 40, 55, 56, 57],
    persistence: ['explicit-calibration-target', 'offset-restore'] },
  compare: (factory, candidate) => {
    const checks = [];
    for (const item of factory.evidence.observations.filter(value =>
      !value.rejectedEmbeddedHeader)) {
      const other = candidate.evidence.observations.find(value => value.target === item.target);
      for (const phase of ['immediateError', 'resetError', 'storedOffsetError']) {
        const difference = other ? Math.max(Math.abs(item[phase]), Math.abs(other[phase])) : Infinity;
        checks.push({ name: `target ${item.target} per-device ${phase}`,
          factory: item[phase], candidate: other?.[phase], tolerance: 4,
          matched: difference <= 4 });
      }
    }
    checks.push({ name: 'two-byte -1 target rejection',
      factory: factory.exact.embeddedHeaderTargetRejected,
      candidate: candidate.exact.embeddedHeaderTargetRejected,
      matched: factory.exact.embeddedHeaderTargetRejected ===
        candidate.exact.embeddedHeaderTargetRejected });
    return { matched: checks.every(check => check.matched), checks };
  },
  run: runExplicitTargets,
}];
