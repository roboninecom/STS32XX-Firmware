#!/usr/bin/env node
'use strict';

// Read-only, stationary telemetry soak. One READ per servo per round; no
// retries are counted as successful samples.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { PacketEncoder, Instruction, BAUD_RATES } = require('../../host/servo-driver');
const { Probe, MeasuredTransport } = require('./probe');
const { distribution } = require('./stats');

const persistent = data => [...data.subarray(4, 40), ...data.subarray(78, 87)];
const signed15 = (lo, hi) => (hi & 0x80) ? -(((hi & 0x7f) << 8) | lo) : (hi << 8) | lo;
const signedPwm = (lo, hi) => {
  const raw = (hi << 8) | lo;
  return raw & 0x400 ? -(raw & 0xfbff) : raw;
};
const jump = (a, b) => Math.min(...[-4096, 0, 4096].map(turn => Math.abs(a - b + turn)));

function decodeTelemetry(bytes) {
  assert.equal(bytes.length, 17);
  return {
    position: signed15(bytes[0], bytes[1]),
    speed: signed15(bytes[2], bytes[3]),
    pwm: signedPwm(bytes[4], bytes[5]),
    voltage: bytes[6], temperature: bytes[7],
    status: bytes[9], moving: bytes[10],
    activePosition: signed15(bytes[11], bytes[12]),
    current: signed15(bytes[13], bytes[14]),
    activeVelocity: signed15(bytes[15], bytes[16]),
  };
}

function anomalies(value, previous, baseline, beforePrevious, { voltageMin = 8, voltageMax = 16 } = {}) {
  const found = [];
  if (value.status) found.push('status');
  if (value.moving > 1) found.push('moving-byte');
  if (value.pwm !== 0) found.push('pwm-while-torque-off');
  if (Math.abs(value.speed) > 500) found.push('speed-spike');
  if (Math.abs(value.current) > 300) found.push('current-spike');
  if (value.voltage < voltageMin * 10 || value.voltage > voltageMax * 10) found.push('voltage-range');
  if (value.temperature < 5 || value.temperature > 90) found.push('temperature-range');
  if (Math.abs(value.voltage - baseline.voltage) > 10) found.push('voltage-baseline');
  if (Math.abs(value.temperature - baseline.temperature) > 5) found.push('temperature-baseline');
  if (previous && jump(value.position, previous.position) > 128) found.push('position-jump');
  if (previous && Math.abs(value.voltage - previous.voltage) > 10) found.push('voltage-jump');
  if (previous && Math.abs(value.temperature - previous.temperature) >= 2) found.push('temperature-jump');
  if (beforePrevious && previous &&
      value.temperature === beforePrevious.temperature &&
      Math.abs(previous.temperature - value.temperature) >= 2)
    found.push('temperature-single-sample-spike');
  return found;
}

function parse(args) {
  const options = { ids: [1, 2], samples: 100000, baud: 1000000,
    timeoutMs: 100, gapMs: 0, intervalMs: 0, voltageMin: 8, voltageMax: 16 };
  const fields = { '--port': 'port', '--output': 'output', '--ids': 'ids',
    '--samples': 'samples', '--baud': 'baud', '--timeout-ms': 'timeoutMs',
    '--gap-ms': 'gapMs', '--interval-ms': 'intervalMs',
    '--voltage-min': 'voltageMin', '--voltage-max': 'voltageMax' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') return { help: true };
    const key = fields[args[i]];
    if (!key || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid argument ${args[i]}`);
    const value = args[++i];
    options[key] = key === 'ids' ? value.split(',').map(Number) :
      ['samples', 'baud', 'timeoutMs', 'gapMs', 'intervalMs', 'voltageMin', 'voltageMax'].includes(key) ? Number(value) : value;
  }
  if (!options.port || !options.output || !options.ids.length ||
      new Set(options.ids).size !== options.ids.length ||
      options.ids.some(id => !Number.isInteger(id) || id < 0 || id > 253) ||
      !Number.isInteger(options.samples) || options.samples < 1 || options.samples > 1000000 ||
      !Number.isInteger(options.baud) || !BAUD_RATES.includes(options.baud) ||
      !Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 10000 ||
      !Number.isInteger(options.gapMs) || options.gapMs < 0 || options.gapMs > 10000 ||
      !Number.isInteger(options.intervalMs) || options.intervalMs < 0 || options.intervalMs > 10000 ||
      !Number.isFinite(options.voltageMin) || !Number.isFinite(options.voltageMax) ||
      options.voltageMin < 0 || options.voltageMax > 25.5 || options.voltageMin >= options.voltageMax ||
      (options.intervalMs && options.gapMs)) {
    throw new Error(USAGE);
  }
  return options;
}

const USAGE = 'node tools/diagnostics/telemetry.js --port PORT --output DIR [--ids 1,2] [--samples 100000] [--baud 1000000] [--timeout-ms 100] [--gap-ms 0 | --interval-ms 100] [--voltage-min 8 --voltage-max 16]';

// Skip expired slots instead of sending a burst of overdue requests. The next
// round is scheduled from the actual start, so timer delays cannot accumulate.
function nextRound(started, finished, intervalMs) {
  const interval = BigInt(intervalMs) * 1000000n;
  let due = started + interval;
  const missed = finished > due ? Number((finished - due + interval - 1n) / interval) : 0;
  due += BigInt(missed) * interval;
  return { due, missed };
}

async function run(options, { transport, progress = console.log, stopped = () => false,
  io = fs, clock = () => process.hrtime.bigint(), sleep = delay } = {}) {
  const output = path.resolve(options.output);
  let csv, anomalyFile;
  const report = { startedAt: new Date().toISOString(), options,
    temperatureSource: 'raw-register-63-diagnostic-only',
    scope: 'stationary read-only; 17-byte READ from register 56; one sample per ID per round',
    limitations: 'Host timing includes USB/OS; thresholds flag candidates for inspection, not proof of sensor damage. No sequence number exists in telemetry.',
    before: {}, after: {}, devices: {}, errors: [], missedDeadlines: 0 };
  const save = () => io.writeFileSync(path.join(output, 'report.json'),
    JSON.stringify(report, (key, value) =>
      ['latency', 'cadence', 'previous', 'beforePrevious', 'baseline', 'lastReply', 'identicalReplyRun'].includes(key)
        ? undefined : value, 2) + '\n');
  transport ??= new MeasuredTransport({ path: options.port, baudRate: options.baud,
    operationTimeoutMs: Math.max(1000, options.timeoutMs * 2) });
  const probe = new Probe(transport, options.timeoutMs);
  let opened = false;
  const started = clock();
  let measurementStarted;
  const read = (id, address, count) => probe.measure(id,
    PacketEncoder.frame(id, Instruction.READ, [address, count]), count);
  const observe = async (id, address, count) => {
    const result = await read(id, address, count);
    if (result.outcome === 'timeout') await probe.recover();
    if (result.outcome !== 'ok' || result.diagnostics.length || result.unexpectedFrames || result.duplicateFrames)
      throw new Error(`ID ${id} preflight/final read: ${result.outcome}, diagnostics=${result.diagnostics.length}`);
    return Buffer.from(result.rxParameters, 'hex');
  };
  let csvBatch = [];
  const flush = () => {
    if (csvBatch.length) io.writeSync(csv, csvBatch.join(''));
    csvBatch = [];
  };
  const recordError = error => report.errors.push({ name: error.name, message: error.message });
  try {
    io.mkdirSync(output, { recursive: true });
    csv = io.openSync(path.join(output, 'samples.csv'), 'wx');
    anomalyFile = io.openSync(path.join(output, 'anomalies.jsonl'), 'wx');
    io.writeSync(csv, 'id,index,elapsed_ms,latency_ms,position,speed,pwm,voltage,raw_temperature_diagnostic,status,moving,active_position,current,active_velocity,flags\n');
    await transport.open(); opened = true;
    await sleep(100);
    for (const id of options.ids) {
      const before = await observe(id, 0, 87);
      assert.equal(before[5], id, `ID ${id} identity`);
      assert.equal(before[6], BAUD_RATES.indexOf(options.baud),
        `ID ${id} baud index does not match the host rate`);
      assert.equal(before[33], 0, `ID ${id} must be in position mode`);
      assert.equal(before[40], 0, `ID ${id} torque must be off`);
      assert.equal(before[55], 1, `ID ${id} persistence must be locked`);
      assert.equal(before[65], 0, `ID ${id} must have no alarm`);
      report.before[id] = before.toString('hex');
      report.devices[id] = { attempts: 0, responses: 0, counts: {}, anomalyCounts: {},
        hostLatencySpikesOver10Ms: 0, maxIdenticalReplyRun: 0,
        identicalReplyRun: 0, lastReply: null,
        latency: [], cadence: [], ranges: {}, previous: null,
        beforePrevious: null, baseline: null };
    }
    save();
    measurementStarted = clock();
    let due = measurementStarted;
    const progressEvery = options.intervalMs
      ? Math.max(1, Math.round(30000 / options.intervalMs)) : 10000;
    for (let index = 0; index < options.samples && !stopped(); index++) {
      if (options.intervalMs) {
        const remainingMs = Number(due - clock()) / 1e6;
        if (remainingMs > 0) await sleep(Math.ceil(remainingMs));
      }
      if (stopped()) break;
      const roundStarted = clock();
      for (const id of options.ids) {
        if (stopped()) break;
        const device = report.devices[id];
        const result = await read(id, 56, 17);
        ++device.attempts;
        device.counts[result.outcome] = (device.counts[result.outcome] ?? 0) + 1;
        const flags = [];
        if (result.outcome !== 'ok') flags.push(result.outcome);
        if (result.diagnostics.length) flags.push('decoder-diagnostic');
        if (result.unexpectedFrames) flags.push('unexpected-frame');
        if (result.duplicateFrames) flags.push('duplicate-frame');
        let value, spikeAtIndex;
        const valid = flags.length === 0;
        if (result.rxParameters) {
          value = decodeTelemetry(Buffer.from(result.rxParameters, 'hex'));
          ++device.responses;
          device.identicalReplyRun = result.rxParameters === device.lastReply
            ? device.identicalReplyRun + 1 : 1;
          device.maxIdenticalReplyRun = Math.max(
            device.maxIdenticalReplyRun, device.identicalReplyRun);
          device.lastReply = result.rxParameters;
          if (valid) {
            device.baseline ??= value;
            flags.push(...anomalies(value, device.previous?.value, device.baseline,
                                    device.beforePrevious?.value, options));
            if (flags.includes('temperature-single-sample-spike')) spikeAtIndex = device.previous.index;
          }
          for (const field of ['position', 'speed', 'pwm', 'voltage', 'temperature', 'current']) {
            const bounds = device.ranges[field] ??= { min: value[field], max: value[field] };
            bounds.min = Math.min(bounds.min, value[field]);
            bounds.max = Math.max(bounds.max, value[field]);
          }
          if (valid) {
            device.beforePrevious = device.previous;
            device.previous = { index, value };
          }
        }
        if (!valid) {
          device.previous = device.beforePrevious = null;
          device.lastReply = null;
          device.identicalReplyRun = 0;
        }
        if (Number.isFinite(result.latencyMs)) {
          device.latency.push(result.latencyMs);
          if (result.latencyMs > 10) ++device.hostLatencySpikesOver10Ms;
        }
        const elapsedMs = Number(clock() - started) / 1e6;
        if (device.lastSampleMs != null) device.cadence.push(elapsedMs - device.lastSampleMs);
        device.lastSampleMs = elapsedMs;
        const cells = [id, index, elapsedMs.toFixed(3), result.latencyMs?.toFixed(3) ?? '',
          ...['position', 'speed', 'pwm', 'voltage', 'temperature', 'status', 'moving',
            'activePosition', 'current', 'activeVelocity'].map(key => value?.[key] ?? ''),
          flags.join('|')];
        csvBatch.push(cells.join(',') + '\n');
        if (csvBatch.length >= 256) flush();
        for (const flag of new Set(flags))
          device.anomalyCounts[flag] = (device.anomalyCounts[flag] ?? 0) + 1;
        if (flags.length) io.writeSync(anomalyFile, JSON.stringify({ id, index, elapsedMs,
          spikeAtIndex,
          flags, value, trace: result }) + '\n');
        if (result.outcome === 'timeout') await probe.recover();
        if (result.outcome === 'transport-error') throw new Error(`ID ${id}: ${result.error?.message}`);
        if (options.gapMs) await sleep(options.gapMs);
      }
      if (options.intervalMs) {
        const next = nextRound(roundStarted, clock(), options.intervalMs);
        due = next.due;
        report.missedDeadlines += next.missed;
      }
      if ((index + 1) % progressEvery === 0) {
        progress(`${index + 1}/${options.samples} samples per ID`);
        flush(); save();
      }
    }
    report.measurementDurationMs = Number(clock() - measurementStarted) / 1e6;
    report.interrupted = stopped();
  } catch (error) {
    recordError(error);
  } finally {
    // Logging failures must not prevent final checks or closing the serial port.
    try { flush(); } catch (error) { recordError(error); }
    if (opened) {
      for (const id of options.ids.filter(id => report.before[id])) {
        try {
          const after = await observe(id, 0, 87);
          report.after[id] = after.toString('hex');
          const before = Buffer.from(report.before[id], 'hex');
          assert.deepEqual(persistent(after), persistent(before), `ID ${id} persistent settings changed`);
          assert.equal(after[33], 0, `ID ${id} mode changed`);
          assert.equal(after[40], 0, `ID ${id} torque changed`);
          assert.equal(after[55], 1, `ID ${id} lock changed`);
          assert.equal(after[65], 0, `ID ${id} alarm present after soak`);
        } catch (error) { recordError(error); }
      }
    }
    try { await transport.close(); } catch (error) { recordError(error); }
    for (const id of options.ids) {
      const device = report.devices[id];
      if (!device) continue;
      device.latencyMs = distribution(device.latency);
      device.sampleIntervalMs = distribution(device.cadence);
      delete device.latency;
      delete device.cadence;
      delete device.lastSampleMs;
      delete device.previous;
      delete device.beforePrevious;
      delete device.baseline;
      delete device.identicalReplyRun;
      delete device.lastReply;
    }
    report.idleFrames = probe.idleFrames;
    if (measurementStarted && report.measurementDurationMs == null) report.measurementDurationMs =
      Number(clock() - measurementStarted) / 1e6;
    report.finishedAt = new Date().toISOString();
    for (const fd of [csv, anomalyFile]) {
      if (fd !== undefined) try { io.closeSync(fd); } catch (error) { recordError(error); }
    }
    // Do not replace an existing report if exclusive creation failed at startup.
    if (csv !== undefined && anomalyFile !== undefined) {
      try { save(); } catch (error) { recordError(error); }
    }
  }
  return { output, report };
}

async function main() {
  const options = parse(process.argv.slice(2));
  if (options.help) { console.log(USAGE); return; }
  let interrupted = false;
  const stop = () => { interrupted = true; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  let result;
  try { result = await run(options, { stopped: () => interrupted }); }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
  const { output, report } = result;
  for (const error of report.errors) console.error(`${error.name}: ${error.message}`);
  console.log(`Report: ${path.join(output, 'report.json')}`);
  for (const [id, device] of Object.entries(report.devices))
    console.log(`ID ${id}: ${device.responses}/${device.attempts} responses; anomalies ${JSON.stringify(device.anomalyCounts)}`);
  if (report.errors.length || report.interrupted || Object.values(report.devices).some(device =>
    device.attempts !== options.samples || Object.keys(device.anomalyCounts).length)) process.exitCode = 2;
}

if (require.main === module) main().catch(error => { console.error(error.stack ?? error.message); process.exitCode = 1; });
module.exports = { parse, decodeTelemetry, anomalies, nextRound, run };
