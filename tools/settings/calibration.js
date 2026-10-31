'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const { StsServo } = require('../../host/servo-driver');
const { PoseCapture, validateIds } = require('../poses/capture');

const TURN = 4096, CENTER = 2048, MARGIN = 10, MIN_TRAVEL = 64;
const REFERENCE_POSE = {
  name: 'user-reference',
  instructions: 'Place each joint at its intended reference position. Use a repeatable pose chosen for your mechanism.',
  angleConvention: '2048 at the captured reference; positive follows increasing reported counts. Physical angles require a mechanism-specific mapping.',
};

const wrap = value => ((value % TURN) + TURN) % TURN;
const difference = (value, previous) => wrap(value - previous + TURN / 2) - TURN / 2;

// Track continuous manual travel across encoder zero. Temporary bad samples
// affect only their joint; they never discard the other joints' measurements.
class RangeCapture {
  constructor(initial) {
    this.ids = validateIds(Object.keys(initial).map(Number));
    this.ranges = Object.fromEntries(this.ids.map(id => {
      const value = initial[id];
      if (!Number.isInteger(value) || Math.abs(value) > 32767) throw new Error(`Motor ${id}: invalid initial position`);
      return [id, { min: value, max: value, current: value, previous: value, window: [value] }];
    }));
    this.samples = 0;
  }

  add(positions, errors = {}) {
    for (const id of this.ids) {
      const position = positions[id], range = this.ranges[id];
      if (errors[id] || !Number.isInteger(position) || Math.abs(position) > 32767) {
        range.error = errors[id] || 'invalid reading';
        range.window = [range.current];
        continue;
      }
      const step = difference(position, range.previous);
      // Exactly half a turn has no identifiable direction. Otherwise use the
      // shortest displacement, without an arbitrary hand-movement speed cap.
      if (Math.abs(step) === TURN / 2) {
        range.error = 'ambiguous reading';
        range.window = [range.current];
        continue;
      }
      delete range.error;
      range.current += step;
      range.previous = position;
      range.window.push(range.current);
      if (range.window.length > 3) range.window.shift();
      // A lone sensor outlier must not widen the saved travel. Pause briefly at
      // each endpoint so it appears in more than one sample.
      if (range.window.length === 3) {
        const confirmed = [...range.window].sort((a, b) => a - b)[1];
        range.min = Math.min(range.min, confirmed);
        range.max = Math.max(range.max, confirmed);
      }
    }
    this.samples++;
  }

  reset(id) {
    const range = this.ranges[id];
    range.min = range.max = range.current;
    range.window = [range.current];
  }

  issue(id) {
    const range = this.ranges[id], span = range.max - range.min;
    return range.error || (span < MIN_TRAVEL ? 'move joint' : span >= TURN ? 'too wide'
      : range.min < 0 || range.max >= TURN ? 'crosses zero' : null);
  }

  plan(expectedRanges = {}) {
    if (this.samples < 10) throw new Error('Not enough samples; move each joint through its range');
    return Object.fromEntries(this.ids.map(id => {
      const { min, max, error } = this.ranges[id], span = max - min;
      if (error) throw new Error(`Motor ${id}: ${error}; waiting for a valid reading`);
      if (span < MIN_TRAVEL || span >= TURN)
        throw new Error(`Motor ${id}: travel must be ${MIN_TRAVEL}–4095 counts; measured ${span}`);
      // Limits share the reference frame already saved in the motor. Never
      // recenter or clip a wrapped sweep: either would change its meaning.
      if (min < 0 || max >= TURN)
        throw new Error(`Motor ${id}: measured range ${min}–${max} crosses the encoder boundary; check the reference pose and repeat calibration`);
      return [id, {
        measuredRange: { min, max }, middleCount: Math.round((min + max) / 2),
        spanCounts: span, clearanceCounts: MARGIN,
        warning: rangeWarning(span, expectedRanges[id]),
        settings: { minAngleLimit: min + MARGIN, maxAngleLimit: max - MARGIN },
      }];
    }));
  }
}

function validateExpectedRanges(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length)
    throw new Error('Expected ranges must be a nonempty object keyed by motor ID');
  for (const [id, range] of Object.entries(value)) {
    if (!/^([1-9][0-9]*)$/.test(id) || Number(id) > 253 || !range || typeof range !== 'object' ||
        Object.keys(range).sort().join(',') !== 'counts,tolerance' ||
        !Number.isInteger(range.counts) || range.counts < MIN_TRAVEL || range.counts >= TURN ||
        !Number.isInteger(range.tolerance) || range.tolerance < 0 || range.tolerance >= TURN)
      throw new Error(`Invalid expected range for motor ${id}; use counts (64–4095) and tolerance (0–4095)`);
  }
  return value;
}

function rangeWarning(span, expected) {
  if (!expected || Math.abs(span - expected.counts) <= expected.tolerance) return null;
  return `Travel ${span} outside expected ${expected.counts} ± ${expected.tolerance} counts`;
}

function rangeTable(ranges, expectedRanges) {
  const rows = ['Motor     Min Current     Max  Middle  Travel  Check'];
  for (const id of ranges.ids) {
    const r = ranges.ranges[id], span = r.max - r.min;
    const check = ranges.issue(id) || (rangeWarning(span, expectedRanges[id]) ? 'outside expected' : 'measured');
    rows.push(`${`M${id}`.padEnd(5)}${[r.min, r.current, r.max,
      Math.round((r.min + r.max) / 2), span].map(value => String(value).padStart(7)).join(' ')}  ${check}`);
  }
  return rows.join('\n');
}

function checkConfiguration(id, state) {
  if (state.modelMajor !== 9 || state.operationMode !== 0 ||
      state.positionScalingDivisor !== 1)
    throw new Error(`Motor ${id}: requires STS model family 9, position mode and divisor 1`);
  if (state.lock !== 1 || state.servoStatus !== 0)
    throw new Error(`Motor ${id}: requires locked settings and no alarm`);
}

function reportStatus(status, id, error, output) {
  const message = error ? `ERROR: ${error}` : 'ready';
  if (status[id] !== message && (error || status[id]))
    output(`${typeof id === 'number' ? `M${id}` : id}  ${message}${error ? ' — retrying; Ctrl+C cancels' : ''}`);
  status[id] = message;
}

// Both reference capture and range recording use this reconnect/error path.
async function readSample(capture, { signal, beforeAttempt }, ids) {
  try {
    await beforeAttempt?.();
    return await capture.read({ signal, tolerateReadErrors: true });
  } catch (error) {
    signal?.throwIfAborted();
    return { positions: {}, errors: Object.fromEntries(ids.map(id => [id, error.message])) };
  }
}

// Retain successful motors and retry only unresolved ones. Ctrl+C remains
// available even for a persistent fault; no fault becomes a successful result.
async function retryPending(ids, operation, { signal, sleep, output, beforeAttempt }, status = {}) {
  const pending = new Set(ids);
  while (pending.size) {
    for (const id of pending) {
      signal?.throwIfAborted();
      try {
        await beforeAttempt?.();
        await operation(id);
        reportStatus(status, id, null, output);
        pending.delete(id);
      } catch (error) {
        signal?.throwIfAborted();
        reportStatus(status, id, error.message, output);
      }
    }
    if (pending.size) await sleep(500, undefined, { signal });
  }
}

async function medianPositions(capture, context) {
  const { signal, sleep, output } = context, status = {};
  const ids = capture.ids;
  const samples = Object.fromEntries(ids.map(id => [id, []]));
  while (ids.some(id => samples[id].length < 16)) {
    const sample = await readSample(capture, context, ids);
    for (const id of ids) {
      if (samples[id].length === 16) continue;
      reportStatus(status, id, sample.errors?.[id], output);
      if (!sample.errors?.[id]) samples[id].push(sample.positions[id]);
    }
    await sleep(Object.keys(sample.errors ?? {}).length ? 500 : 20, undefined, { signal });
  }
  return Object.fromEntries(ids.map(id => {
    const first = samples[id][0];
    const values = samples[id].map(value => first + difference(value, first)).sort((a, b) => a - b);
    return [id, values[Math.floor(values.length / 2)]];
  }));
}

async function recordRanges(capture, ranges, context) {
  const { question, signal, output, sleep, now, expectedRanges } = context;
  output('Enter saves valid limits. Temporary reading errors clear automatically. Type reset ID to remeasure one motor, or cancel to stop.');
  while (true) {
    const promptAbort = new AbortController();
    const abortPrompt = () => promptAbort.abort(signal.reason);
    signal?.addEventListener('abort', abortPrompt, { once: true });
    let done = false, answer, failure;
    const waiting = question('Press Enter to save limits (or reset ID / cancel):\n', promptAbort.signal)
      .then(value => { answer = value; done = true; }, error => { failure = error; done = true; });
    let displayed = now(), printed = false;
    const display = () => {
      if (printed && output === console.log && process.stdout.isTTY) process.stdout.write(`\x1b[${ranges.ids.length + 1}F\x1b[J`);
      output(rangeTable(ranges, expectedRanges));
      printed = true;
    };
    display();
    try {
      while (!done) {
        signal?.throwIfAborted();
        const sample = await readSample(capture, context, ranges.ids);
        ranges.add(sample.positions, sample.errors);
        if (now() - displayed >= 500) { display(); displayed = now(); }
        // Keep sampling healthy joints quickly; back off only when all fail.
        await sleep(Object.keys(sample.errors ?? {}).length === ranges.ids.length ? 500 : 20, undefined, { signal });
      }
      if (failure) throw failure;
      const command = answer.trim().toLowerCase();
      if (command === 'cancel') throw new Error('Calibration cancelled during range recording');
      const reset = /^reset ([0-9]+)$/.exec(command);
      if (reset && ranges.ids.includes(Number(reset[1]))) { ranges.reset(Number(reset[1])); continue; }
      if (command) { output('Use Enter to save, reset ID to remeasure one joint, or cancel.'); continue; }
      output(rangeTable(ranges, expectedRanges));
      try { return ranges.plan(expectedRanges); }
      catch (error) { output(`${error.message}. Nothing saved; recording continues.`); }
    } finally {
      promptAbort.abort();
      signal?.removeEventListener('abort', abortPrompt);
      await waiting;
    }
  }
}

async function applySettings(stage, changes, { servo, expected, record, save, retryOptions }) {
  record.stage = stage;
  const attempted = new Set();
  await retryPending(record.ids, async id => {
    const state = await servo.bus.read(id, ['torqueEnable', 'servoStatus', 'lock']);
    if (state.torqueEnable !== 0) throw new Error('torque is not off; saving paused');
    if (state.servoStatus !== 0) throw new Error(`protection status ${state.servoStatus}; saving paused`);
    if (state.lock !== 1) {
      if (!attempted.has(id)) throw new Error('settings unlocked; saving paused');
      // Only relock a motor this run attempted to write, never hide an
      // externally unlocked motor or overwrite unrelated settings.
      await servo.bus.write(id, { lock: 1 }, { timeoutMs: 250 });
      if ((await servo.bus.read(id, ['lock'])).lock !== 1) throw new Error('could not relock settings');
    }
    let actual = await servo.settings.read(id);
    const desired = { ...expected[id], ...changes[id] };
    if (Object.keys(expected[id]).some(key => !Object.hasOwn(changes[id], key) && actual[key] !== expected[id][key]))
      throw new Error('unrelated settings changed; saving paused');
    record.attemptedId = id;
    await save();
    if (Object.entries(changes[id]).some(([key, value]) => actual[key] !== value)) {
      attempted.add(id);
      await servo.settings.save(id, changes[id]);
    }
    // An earlier attempt may have saved successfully but lost its reply.
    // Reading before writing avoids repeating those EEPROM writes.
    actual = await servo.settings.read(id);
    if (Object.keys(desired).some(key => actual[key] !== desired[key])) throw new Error('settings readback mismatch');
    const final = await servo.bus.read(id, ['lock', 'torqueEnable', 'servoStatus']);
    if (final.lock !== 1 || final.torqueEnable !== 0 || final.servoStatus !== 0)
      throw new Error('waiting for locked settings, torque off and cleared alarms');
    expected[id] = desired;
    if (!record.appliedIds[stage].includes(id)) record.appliedIds[stage].push(id);
    await save();
  }, retryOptions, record.motorStatus);
}

async function runCalibration(options, { createServo = config => new StsServo(config),
  readSettingsDocument, question, signal, output = console.log, sleep = delay, now = () => performance.now() } = {}) {
  if (typeof question !== 'function') throw new Error('Interactive calibration prompts are required');
  const expectedRanges = options.expectedRanges
    ? validateExpectedRanges(JSON.parse(await fs.readFile(options.expectedRanges, 'utf8'))) : {};
  const filename = path.resolve(options.file);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const backupRoot = path.join(path.dirname(filename), 'backups');
  await fs.mkdir(backupRoot, { recursive: true });
  const backupDirectory = await fs.mkdtemp(path.join(backupRoot, 'calibration-'));
  const record = { format: 'sts-arm-calibration', version: 1,
    createdAt: new Date().toISOString(), port: options.port, baudRate: options.baudRate,
    referencePose: REFERENCE_POSE, expectedRanges,
    status: 'pending', stage: 'offsets', motorStatus: {}, appliedIds: { offsets: [], limits: [] }, backupDirectory };
  const writeReport = async () => {
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
      await fs.rename(temporary, filename);
    } finally { await fs.rm(temporary, { force: true }); }
  };
  const save = () => retryPending(['Report'], writeReport, { signal, sleep, output });
  // Replace the previous report atomically and check output access before connecting.
  // Motor backups remain in a separate, unique directory for every run.
  await writeReport();
  const servo = createServo({ serial: { path: options.port, baudRate: options.baudRate } });
  const backups = {};
  const reconnect = async () => { if (servo.isConnected === false) await servo.connect(); };
  const retryOptions = { signal, sleep, output, beforeAttempt: reconnect };
  let capture, powered = false;
  try {
    signal?.throwIfAborted();
    await retryPending(['Adapter'], async () => {
      const found = await servo.connect();
      record.ids = validateIds(options.ids ?? found.ids);
      const missing = record.ids.filter(id => !found.ids.includes(id));
      if (missing.length) throw new Error(`Selected motors not found: ${missing.join(', ')}`);
    }, retryOptions);
    await retryPending(record.ids, async id => {
      backups[id] = await readSettingsDocument(servo, id, options);
      const state = await servo.bus.read(id, ['lock', 'servoStatus', 'torqueEnable']);
      powered ||= state.torqueEnable !== 0;
      checkConfiguration(id, { ...backups[id].device, ...backups[id].settings, ...state });
      await fs.writeFile(path.join(record.backupDirectory, `servo-${id}.json`),
        `${JSON.stringify(backups[id], null, 2)}\n`);
    }, retryOptions, record.motorStatus);
    await save();
    output(`Backups: ${record.backupDirectory}`);
    if (powered && (await question('Support the arm. Press Enter to release the selected motors, or type cancel: ', signal)).trim())
      throw new Error('Calibration cancelled before torque release');
    signal?.throwIfAborted();
    capture = new PoseCapture(servo.bus, record.ids);
    await retryPending(record.ids, async id => {
      await servo.bus.syncWrite([{ id, values: { torqueEnable: 0 } }]);
      const state = await servo.bus.read(id, ['torqueEnable']);
      if (state.torqueEnable !== 0) throw new Error('torque is not off');
    }, retryOptions, record.motorStatus);
    // The two stages use the same write/verify path; no old calibration file is
    // needed. Backups always describe the settings before either stage.
    const expected = Object.fromEntries(record.ids.map(id => [id, { ...backups[id].settings }]));
    const apply = (stage, changes) => applySettings(stage, changes, { servo, expected, record, save, retryOptions });

    output(`Torque is off. Support the arm.\n${REFERENCE_POSE.instructions}`);
    if ((await question('Place all joints in the reference pose, hold still, then press Enter to SAVE offsets (or type cancel): ', signal)).trim())
      throw new Error('Calibration cancelled before saving offsets');
    record.referenceInputCounts = await medianPositions(capture, retryOptions);
    record.joints = Object.fromEntries(record.ids.map(id => {
      // Reported position already includes the current correction and direction.
      const positionCorrection = wrap(record.referenceInputCounts[id] + backups[id].settings.positionCorrection) - CENTER;
      return [id, { name: `motor-${id}`, referenceCount: CENTER,
        settings: { positionCorrection },
        encoderCalibration: { positionCorrection, resolution: 1,
          reverse: Boolean(backups[id].settings.configurationFlags & 0x80) } }];
    }));
    output('Saving offsets. Keep the arm still.');
    await apply('offsets', Object.fromEntries(record.ids.map(id => [id, record.joints[id].settings])));
    record.referenceReadbackCounts = await medianPositions(capture, retryOptions);
    await save();
    // apply() verifies the saved registers. Position can change while torque
    // is off, so keep these readings as information, not another pass/fail gate.

    record.stage = 'limits';
    delete record.attemptedId;
    await save();
    output('Offsets saved. Move every joint end to end, pausing at each end. Do not force stops.');
    for (const [id, expectedRange] of Object.entries(expectedRanges))
      output(`Expected M${id}: ${expectedRange.counts} ± ${expectedRange.tolerance} counts`);
    const ranges = new RangeCapture(record.referenceReadbackCounts);
    let plan;
    try {
      plan = await recordRanges(capture, ranges, { ...retryOptions, question, now, expectedRanges });
    } finally {
      record.measuredRanges = Object.fromEntries(record.ids.map(id => [id, {
        min: ranges.ranges[id].min, max: ranges.ranges[id].max,
      }]));
      await save();
    }
    for (const id of record.ids) {
      record.joints[id] = { ...record.joints[id], ...plan[id],
        settings: { ...record.joints[id].settings, ...plan[id].settings } };
      if (plan[id].warning) output(`WARNING M${id}: ${plan[id].warning}`);
    }
    output('Saving limits with 10-count clearance at each end.');
    await apply('limits', Object.fromEntries(record.ids.map(id => [id, plan[id].settings])));
    await retryPending(record.ids, async id => {
      await servo.bus.syncWrite([{ id, values: { torqueEnable: 0 } }]);
      const state = await servo.bus.read(id, ['lock', 'torqueEnable', 'servoStatus']);
      if (state.lock !== 1 || state.torqueEnable !== 0 || state.servoStatus !== 0)
        throw new Error('waiting for locked settings, torque off and cleared alarms');
    }, retryOptions, record.motorStatus);
    await retryPending(['Adapter'], () => servo.close(), { signal, sleep, output });
    record.stage = 'complete';
    delete record.attemptedId;
    record.status = 'verified';
    await save();
  } catch (error) {
    record.status = 'failed'; record.error = error.message;
    // Cancellation cleanup makes one attempt per operation, without retry loops.
    const cleanup = [];
    if (capture) {
      try { await capture.release(); } catch (error) { cleanup.push(error.message); }
      for (const id of record.ids) {
        try {
          if ((await servo.bus.read(id, ['lock'])).lock !== 1) cleanup.push(`Motor ${id}: settings are not locked`);
        } catch (error) { cleanup.push(`Motor ${id}: ${error.message}`); }
      }
    }
    try { await servo.close(); } catch (error) { cleanup.push(error.message); }
    if (cleanup.length) record.cleanupErrors = cleanup;
    try { await writeReport(); } catch (error) { output(`Report  ERROR: ${error.message}`); }
    throw error;
  }
  output('Calibration saved and verified. Reference pose = 2048; measured limits saved. Torque remains off.');
  return { operation: options.command, file: filename, backupDirectory: record.backupDirectory, verified: true };
}

module.exports = { RangeCapture, checkConfiguration, runCalibration, validateExpectedRanges, rangeWarning, recordRanges };
