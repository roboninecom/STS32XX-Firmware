'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { PacketEncoder, Instruction } = require('../../host/servo-driver');
const { Probe, MeasuredTransport } = require('../../host/diagnostics/probe');
const { cases } = require('./cases');
const { summarize } = require('../../host/diagnostics/stats');

const persistent = data => [...data.subarray(4, 40), ...data.subarray(78, 87)];
function safeBaseline(id, data, writes) {
  assert.equal(data.length, 87);
  assert.equal(data[5], id, 'unexpected device identity');
  assert.equal(data[40], 0, `ID ${id}: torque must be off`);
  assert.equal(data[55], 1, `ID ${id}: persistence must be locked`);
  assert.equal(data[65], 0, `ID ${id}: clear existing alarms before timing`);
  if (writes) assert.notEqual(data[8], 0, `ID ${id}: write acknowledgments are disabled`);
}

async function run(options, { transport, progress = console.log, stopped = () => false, io = fs } = {}) {
  const selected = cases(options.readOnly).filter(item => !options.cases.length || options.cases.includes(item.name));
  assert(selected.length, 'no cases selected');
  for (const name of options.cases) assert(selected.some(item => item.name === name), `unknown/excluded case ${name}`);
  const directory = path.resolve(options.results, new Date().toISOString().replaceAll(':', '-'));
  let raw;
  const record = value => io.writeSync(raw, JSON.stringify(value) + '\n');
  const report = { startedAt: new Date().toISOString(), options, host: { node: process.version,
    platform: os.platform(), release: os.release(), architecture: os.arch() },
    timing: { clock: 'process.hrtime.bigint', units: 'ms',
      latency: 'transport write invocation to matching checksum-valid decoded response',
      timeout: 'configured response deadline after transport drain; OS timer delivery may be late',
      limits: 'Includes USB/driver/OS overhead. Not MCU-only turnaround or a guaranteed future worst case.',
      percentiles: 'nearest-rank; matching responses only, including nonzero status; no timeout imputation' },
    cases: [], before: {}, after: {}, cleanupErrors: [] };
  const save = () => io.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  transport ??= new MeasuredTransport({ path: options.port, baudRate: options.baud,
    operationTimeoutMs: Math.max(1000, options.timeoutMs * 2) });
  const probe = new Probe(transport, options.timeoutMs);
  let opened = false;
  const modified = new Set();
  const command = async (id, instruction, params, length, phase) => {
    const result = await probe.measure(id, PacketEncoder.frame(id, instruction, params), length);
    if (result.outcome === 'timeout') await probe.recover();
    try { record({ phase, id, ...result }); }
    catch (error) {
      if (!['restore-ram', 'cleanup-verification'].includes(phase)) throw error;
      report.cleanupErrors.push({ id, message: error.message });
    }
    assert.equal(result.outcome, 'ok', `${phase} ID ${id}: ${result.outcome}`);
    assert.equal(result.diagnostics.length + result.unexpectedFrames + result.duplicateFrames, 0,
      `${phase}: invalid or unexpected serial data`);
    return Buffer.from(result.rxParameters, 'hex');
  };
  try {
    io.mkdirSync(directory, { recursive: true });
    raw = io.openSync(path.join(directory, 'samples.jsonl'), 'wx');
    await transport.open(); opened = true;
    // Opening a USB adapter can leave startup data queued. Exclude settling and
    // explicit preflight from samples; no flash, reset, calibration or baud writes.
    await delay(100);
    for (const id of options.ids) {
      const data = await command(id, Instruction.READ, [0, 87], 87, 'preflight');
      safeBaseline(id, data, selected.some(item => item.writes));
      report.before[id] = data.toString('hex');
    }
    save();
    for (const entry of selected) {
      if (stopped()) break;
      const records = new Map(options.ids.map(id => [id, []]));
      const expected = new Map();
      const warmupFailures = new Map(options.ids.map(id => [id, 0]));
      try {
        for (let repetition = -options.warmup; repetition < options.repetitions && !stopped(); repetition++) {
          // Rotate first ID each round, reducing systematic ordering bias.
          for (let index = 0; index < options.ids.length && !stopped(); index++) {
            const id = options.ids[(index + repetition + options.warmup) % options.ids.length];
            const iteration = repetition + options.warmup;
            if (entry.writes) modified.add(id); // Also restore after ambiguous timeout.
            const packet = entry.packet(id, iteration);
            const result = await probe.measure(id, packet, entry.responseBytes);
            record({ phase: repetition < 0 ? 'warmup' : 'measurement', case: entry.name,
              id, repetition, ...result });
            if (repetition >= 0) records.get(id).push(result);
            else if (result.outcome !== 'ok' || result.diagnostics.length || result.unexpectedFrames || result.duplicateFrames) warmupFailures.set(id, warmupFailures.get(id) + 1);
            if (entry.writes) expected.set(id, entry.payload(iteration));
            if (result.outcome === 'timeout') await probe.recover();
            if (result.outcome === 'transport-error') throw new Error(result.error.message);
            if (result.outcome === 'status-error') throw new Error(`ID ${id} returned status ${result.status}`);
            if (options.gapMs) await delay(options.gapMs);
          }
          if (repetition >= 0 && (repetition + 1) % 1000 === 0)
            progress(`${entry.name}: ${repetition + 1}/${options.repetitions} per servo`);
        }
        // Verify write effects outside the timed samples. Includes a health read.
        for (const id of options.ids) {
          const data = await command(id, Instruction.READ, [0, 87], 87, 'case-verification');
          safeBaseline(id, data, Boolean(entry.writes));
          assert.deepEqual(persistent(data), persistent(Buffer.from(report.before[id], 'hex')));
          if (expected.has(id)) assert.deepEqual(data.subarray(51, 51 + expected.get(id).length), expected.get(id));
        }
      } finally {
        for (const id of options.ids) {
          const summary = { name: entry.name, id, warmupFailures: warmupFailures.get(id),
            requestBytes: entry.packet(id, 0).length, responseBytes: entry.responseBytes + 6,
            nominalWireMs: (entry.packet(id, 0).length + entry.responseBytes + 6) * 10_000 / options.baud,
            ...summarize(records.get(id)) };
          report.cases.push(summary);
          const f = value => value == null ? 'n/a' : value.toFixed(3);
          progress(`${entry.name} ID ${id}: n=${summary.attempts} min/avg/p99/max=${
            [summary.latencyMs.min, summary.latencyMs.mean, summary.latencyMs.p99, summary.latencyMs.max].map(f).join('/')} ms; timeouts=${summary.counts.timeout ?? 0}`);
        }
        save();
      }
    }
    report.interrupted = stopped();
  } catch (error) {
    report.error = { name: error.name, message: error.message };
  } finally {
    if (opened) {
      for (const id of options.ids.filter(id => report.before[id])) {
        try {
          const before = Buffer.from(report.before[id], 'hex');
          if (modified.has(id)) await command(id, Instruction.WRITE, [51, ...before.subarray(51, 55)], 0, 'restore-ram');
          const after = await command(id, Instruction.READ, [0, 87], 87, 'cleanup-verification');
          report.after[id] = after.toString('hex');
          safeBaseline(id, after, false);
          assert.deepEqual(persistent(after), persistent(before), 'persistent settings changed');
          assert.deepEqual(after.subarray(40, 56), before.subarray(40, 56), 'RAM controls not restored');
        } catch (error) { report.cleanupErrors.push({ id, message: error.message }); }
      }
    }
    try { await transport.close(); } catch (error) { report.cleanupErrors.push({ message: error.message }); }
    report.idleFrames = probe.idleFrames;
    report.finishedAt = new Date().toISOString();
    if (raw !== undefined) {
      try { io.closeSync(raw); } catch (error) { report.cleanupErrors.push({ message: error.message }); }
    }
    const fields = ['name', 'id', 'attempts', 'responses', 'timeouts', 'statusErrors', 'duplicateFrames', 'diagnosticEvents', 'minMs', 'meanMs', 'p50Ms', 'p95Ms', 'p99Ms', 'p999Ms', 'maxMs', 'stddevMs'];
    const rows = report.cases.map(c => [c.name, c.id, c.attempts, c.latencyMs.count,
      c.counts.timeout ?? 0, c.counts['status-error'] ?? 0, c.duplicateFrames, c.diagnosticEvents,
      ...['min', 'mean', 'p50', 'p95', 'p99', 'p999', 'max', 'stddev'].map(key => c.latencyMs[key])].join(','));
    if (raw !== undefined) {
      try { io.writeFileSync(path.join(directory, 'summary.csv'), [fields.join(','), ...rows].join('\n') + '\n'); }
      catch (error) { report.cleanupErrors.push({ message: error.message }); }
      try { save(); } catch (error) { report.cleanupErrors.push({ message: error.message }); }
    }
  }
  return { directory, report };
}
module.exports = { run, safeBaseline };
