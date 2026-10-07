#!/usr/bin/env node
'use strict';

// Read-only, stationary telemetry soak. One READ per servo per round; no
// retries are counted as successful samples.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { PacketEncoder, Instruction, BAUD_RATES } = require('../../../hw_tests/StsServoDriver');
const { Probe, MeasuredTransport } = require('../../../hw_tests/bus-bench/probe');
const { distribution } = require('../../../hw_tests/bus-bench/stats');

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

function anomalies(value, previous, baseline, beforePrevious) {
  const found = [];
  if (value.status) found.push('status');
  if (value.moving > 1) found.push('moving-byte');
  if (value.pwm !== 0) found.push('pwm-while-torque-off');
  if (Math.abs(value.speed) > 500) found.push('speed-spike');
  if (Math.abs(value.current) > 300) found.push('current-spike');
  if (value.voltage < 80 || value.voltage > 160) found.push('voltage-range');
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
    timeoutMs: 100, gapMs: 0, intervalMs: 0 };
  const fields = { '--port': 'port', '--output': 'output', '--ids': 'ids',
    '--samples': 'samples', '--baud': 'baud', '--timeout-ms': 'timeoutMs',
    '--gap-ms': 'gapMs', '--interval-ms': 'intervalMs' };
  for (let i = 0; i < args.length; i++) {
    const key = fields[args[i]];
    if (!key || !args[i + 1]) throw new Error(`Invalid argument ${args[i]}`);
    const value = args[++i];
    options[key] = key === 'ids' ? value.split(',').map(Number) :
      ['samples', 'baud', 'timeoutMs', 'gapMs', 'intervalMs'].includes(key) ? Number(value) : value;
  }
  if (!options.port || !options.output || !options.ids.length ||
      new Set(options.ids).size !== options.ids.length ||
      options.ids.some(id => !Number.isInteger(id) || id < 0 || id > 253) ||
      !Number.isInteger(options.samples) || options.samples < 1 || options.samples > 1000000 ||
      !Number.isInteger(options.baud) || !BAUD_RATES.includes(options.baud) ||
      !Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 10000 ||
      !Number.isInteger(options.gapMs) || options.gapMs < 0 || options.gapMs > 10000 ||
      !Number.isInteger(options.intervalMs) || options.intervalMs < 0 || options.intervalMs > 10000 ||
      (options.intervalMs && options.gapMs)) {
    throw new Error('usage: node telemetry_soak.js --port PORT --output DIR [--ids 1,2] [--samples 100000 per ID] [--baud 1000000] [--timeout-ms 100] [--gap-ms 0 | --interval-ms 100]');
  }
  return options;
}

async function run(options, progress = console.log) {
  const output = path.resolve(options.output);
  fs.mkdirSync(output, { recursive: true });
  const csv = fs.openSync(path.join(output, 'samples.csv'), 'wx');
  const anomalyFile = fs.openSync(path.join(output, 'anomalies.jsonl'), 'wx');
  fs.writeSync(csv, 'id,index,elapsed_ms,latency_ms,position,speed,pwm,voltage,temperature,status,moving,active_position,current,active_velocity,flags\n');
  const report = { startedAt: new Date().toISOString(), options,
    scope: 'stationary read-only; 17-byte READ from register 56; one sample per ID per round',
    limitations: 'Host timing includes USB/OS; thresholds flag candidates for inspection, not proof of sensor damage. No sequence number exists in telemetry.',
    before: {}, after: {}, devices: {}, errors: [] };
  const save = () => fs.writeFileSync(path.join(output, 'report.json'),
    JSON.stringify(report, (key, value) =>
      ['latency', 'cadence', 'previous', 'beforePrevious', 'baseline', 'lastReply', 'identicalReplyRun'].includes(key)
        ? undefined : value, 2) + '\n');
  const transport = new MeasuredTransport({ path: options.port, baudRate: options.baud,
    operationTimeoutMs: Math.max(1000, options.timeoutMs * 2) });
  const probe = new Probe(transport, options.timeoutMs);
  let opened = false;
  let interrupted = false;
  const stop = () => { interrupted = true; };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const started = process.hrtime.bigint();
  let measurementStarted;
  const read = (id, address, count) => probe.measure(id,
    PacketEncoder.frame(id, Instruction.READ, [address, count]), count);
  const observe = async (id, address, count) => {
    const result = await read(id, address, count);
    if (result.outcome !== 'ok' || result.diagnostics.length || result.unexpectedFrames || result.duplicateFrames)
      throw new Error(`ID ${id} preflight/final read: ${result.outcome}, diagnostics=${result.diagnostics.length}`);
    return Buffer.from(result.rxParameters, 'hex');
  };
  let csvBatch = [];
  const flush = () => {
    if (csvBatch.length) fs.writeSync(csv, csvBatch.join(''));
    csvBatch = [];
  };
  try {
    await transport.open(); opened = true;
    await delay(100);
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
    measurementStarted = process.hrtime.bigint();
    const progressEvery = options.intervalMs
      ? Math.max(1, Math.round(30000 / options.intervalMs)) : 10000;
    for (let index = 0; index < options.samples && !interrupted; index++) {
      if (options.intervalMs) {
        const due = measurementStarted + BigInt(index * options.intervalMs) * 1000000n;
        const remainingMs = Number(due - process.hrtime.bigint()) / 1e6;
        if (remainingMs > 0) await delay(remainingMs);
      }
      for (const id of options.ids) {
        const device = report.devices[id];
        const result = await read(id, 56, 17);
        ++device.attempts;
        device.counts[result.outcome] = (device.counts[result.outcome] ?? 0) + 1;
        const flags = [];
        if (result.outcome !== 'ok') flags.push(result.outcome);
        if (result.diagnostics.length) flags.push('decoder-diagnostic');
        if (result.unexpectedFrames) flags.push('unexpected-frame');
        if (result.duplicateFrames) flags.push('duplicate-frame');
        let value;
        if (result.rxParameters) {
          value = decodeTelemetry(Buffer.from(result.rxParameters, 'hex'));
          ++device.responses;
          device.identicalReplyRun = result.rxParameters === device.lastReply
            ? device.identicalReplyRun + 1 : 1;
          device.maxIdenticalReplyRun = Math.max(
            device.maxIdenticalReplyRun, device.identicalReplyRun);
          device.lastReply = result.rxParameters;
          device.baseline ??= value;
          flags.push(...anomalies(value, device.previous, device.baseline,
                                  device.beforePrevious));
          for (const field of ['position', 'speed', 'pwm', 'voltage', 'temperature', 'current']) {
            const bounds = device.ranges[field] ??= { min: value[field], max: value[field] };
            bounds.min = Math.min(bounds.min, value[field]);
            bounds.max = Math.max(bounds.max, value[field]);
          }
          device.beforePrevious = device.previous;
          device.previous = value;
        }
        if (Number.isFinite(result.latencyMs)) {
          device.latency.push(result.latencyMs);
          if (result.latencyMs > 10) ++device.hostLatencySpikesOver10Ms;
        }
        const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
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
        if (flags.length) fs.writeSync(anomalyFile, JSON.stringify({ id, index, elapsedMs,
          spikeAtIndex: flags.includes('temperature-single-sample-spike') ? index - 1 : undefined,
          flags, value, trace: result }) + '\n');
        if (result.outcome === 'timeout') await probe.recover();
        if (result.outcome === 'transport-error') throw new Error(`ID ${id}: ${result.error?.message}`);
        if (options.gapMs) await delay(options.gapMs);
      }
      if ((index + 1) % progressEvery === 0) {
        progress(`${index + 1}/${options.samples} samples per ID`);
        flush(); save();
      }
    }
    if (options.intervalMs && !interrupted) {
      const due = measurementStarted + BigInt(options.samples * options.intervalMs) * 1000000n;
      const remainingMs = Number(due - process.hrtime.bigint()) / 1e6;
      if (remainingMs > 0) await delay(remainingMs);
    }
    report.measurementDurationMs = Number(process.hrtime.bigint() - measurementStarted) / 1e6;
    report.interrupted = interrupted;
  } catch (error) {
    report.errors.push({ name: error.name, message: error.message });
  } finally {
    flush();
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
        } catch (error) { report.errors.push({ name: error.name, message: error.message }); }
      }
    }
    try { await transport.close(); } catch (error) { report.errors.push({ name: error.name, message: error.message }); }
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
      Number(process.hrtime.bigint() - measurementStarted) / 1e6;
    report.finishedAt = new Date().toISOString();
    save();
    fs.closeSync(csv); fs.closeSync(anomalyFile);
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
  }
  return { output, report };
}

async function main() {
  const options = parse(process.argv.slice(2));
  const { output, report } = await run(options);
  console.log(`Report: ${path.join(output, 'report.json')}`);
  for (const [id, device] of Object.entries(report.devices))
    console.log(`ID ${id}: ${device.responses}/${device.attempts} responses; anomalies ${JSON.stringify(device.anomalyCounts)}`);
  if (report.errors.length || report.interrupted || Object.values(report.devices).some(device =>
    device.attempts !== options.samples || Object.keys(device.anomalyCounts).length)) process.exitCode = 2;
}

if (require.main === module) main().catch(error => { console.error(error.stack ?? error.message); process.exitCode = 1; });
module.exports = { parse, decodeTelemetry, anomalies, run };
