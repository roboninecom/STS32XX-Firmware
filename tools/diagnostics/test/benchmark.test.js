'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PacketEncoder, Instruction } = require('../../../host/servo-driver');
const { parse } = require('../bus-benchmark');
const { cases } = require('../cases');
const { distribution, summarize } = require('../stats');
const { Probe, MeasuredTransport } = require('../probe');
const { run, safeBaseline } = require('../benchmark');

const { FakePort, transportFor } = require('./fake-port');

test('statistics use nearest-rank percentiles and exclude missing latency', () => {
  assert.deepEqual(distribution([]).mean, null);
  const d = distribution([4, 1, 3, 2]);
  assert.equal(d.mean, 2.5); assert.equal(d.p50, 2); assert.equal(d.p99, 4);
  const r = summarize([{ outcome: 'ok', latencyMs: 2, unexpectedFrames: 0, diagnostics: [] },
    { outcome: 'timeout', latencyMs: null, unexpectedFrames: 0, diagnostics: [] }]);
  assert.equal(r.latencyMs.count, 1); assert.equal(r.latencyMs.mean, 2); assert.equal(r.timeoutRate, .5);
});

test('CLI rejects invalid values and unknown cases before opening a port', () => {
  for (const args of [['--ids', '1,1'], ['--repetitions', 'NaN'], ['--timeout-ms', '0'],
    ['--cases', 'no-such-case'], ['--cases', 'write-ram-4-zero']])
    assert.throws(() => parse(['--port', '/dev/fake', ...args]));
  assert.equal(parse(['--port', '/dev/fake']).repetitions, 1000);
});

test('all write payloads are confined to RAM 51–54 without FF FF framing', () => {
  for (const entry of cases().filter(c => c.writes)) for (let n = 0; n < 512; n++) {
    const p = entry.packet(2, n);
    assert.equal(p[4], Instruction.WRITE); assert.equal(p[5], 51);
    assert(p.length - 7 <= 4); assert(51 + p.length - 7 <= 55);
    assert(!p.subarray(5).includes(Buffer.from([255, 255])));
  }
});

test('baseline refuses torque, unlocked persistence and suppressed write ACK', () => {
  const data = new FakePort().tables.get(1);
  safeBaseline(1, data, true);
  for (const [address, value] of [[40, 1], [55, 0], [8, 0], [65, 2]]) {
    const bad = Buffer.from(data); bad[address] = value;
    assert.throws(() => safeBaseline(1, bad, true));
  }
});

test('decoded response timestamp precedes delayed drain; status and corruption stay visible', async () => {
  const port = new FakePort(), transport = transportFor(port), probe = new Probe(transport, 5);
  await transport.open();
  const request = PacketEncoder.frame(1, Instruction.PING);
  const ok = await probe.measure(1, request, 0);
  assert.equal(ok.outcome, 'ok'); assert(ok.latencyMs < ok.writeDrainMs);
  port.status = 2;
  assert.equal((await probe.measure(1, request, 0)).outcome, 'status-error');
  port.corrupt = true;
  const bad = await probe.measure(1, request, 0);
  assert.equal(bad.outcome, 'timeout'); assert.equal(bad.latencyMs, null);
  assert(bad.diagnostics.some(d => d.type === 'checksum-mismatch'));
  port.corrupt = false; port.silent = true;
  assert.equal((await probe.measure(1, request, 0)).outcome, 'timeout');
  await probe.recover(); await transport.close();
});

test('runner counts only measured attempts, rotates IDs and restores RAM', async () => {
  const port = new FakePort(), before = Buffer.from(port.tables.get(1));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-bench-test-'));
  try {
    const options = parse(['--port', '/dev/fake', '--include-writes', '--cases', 'ping,write-ram-4-counter',
      '--repetitions', '3', '--warmup', '1', '--results', root]);
    const { report, directory } = await run(options, { transport: transportFor(port), progress: () => {} });
    assert.equal(report.error, undefined); assert.deepEqual(report.cleanupErrors, []);
    assert.equal(report.cases.length, 4); assert(report.cases.every(c => c.attempts === 3 && c.counts.ok === 3));
    assert.deepEqual(port.tables.get(1), before);
    const records = fs.readFileSync(path.join(directory, 'samples.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(records.filter(r => r.phase === 'warmup').length, 4);
    assert.equal(records.filter(r => r.phase === 'measurement').length, 12);
    assert.deepEqual(records.filter(r => r.phase === 'measurement' && r.case === 'ping').map(r => r.id), [2, 1, 1, 2, 2, 1]);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('interruption still restores every touched servo', async () => {
  const port = new FakePort(), original = Buffer.from(port.tables.get(1));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-bench-test-'));
  try {
    const options = parse(['--port', '/dev/fake', '--include-writes', '--cases', 'write-ram-4-counter', '--warmup', '0', '--results', root]);
    const { report } = await run(options, { transport: transportFor(port), progress: () => {},
      stopped: () => port.writes.filter(p => p[4] === Instruction.WRITE).length >= 1 });
    assert(report.interrupted); assert.deepEqual(report.cleanupErrors, []);
    assert.deepEqual(port.tables.get(1), original);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('duplicate replies are counted independently of successful timing', async () => {
  const port = new FakePort(); port.duplicate = true;
  const transport = transportFor(port), probe = new Probe(transport, 10);
  await transport.open();
  const result = await probe.measure(1, PacketEncoder.frame(1, Instruction.PING), 0);
  assert.equal(result.outcome, 'ok'); assert.equal(result.duplicateFrames, 1);
  assert.equal(summarize([result]).duplicateFrames, 1);
  await transport.close();
});

test('failed readback preserves error and cleanup verification outcome', async () => {
  const port = new FakePort(); port.badReadback = true;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-bench-test-'));
  try {
    const options = parse(['--port', '/dev/fake', '--include-writes', '--cases', 'write-ram-4-counter',
      '--repetitions', '1', '--warmup', '0', '--results', root]);
    const { report } = await run(options, { transport: transportFor(port), progress: () => {} });
    assert(report.error); assert.equal(report.cleanupErrors.length, 2);
    assert.equal(port.isOpen, false);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('default benchmark only reads and pings; write cases require explicit opt-in', async () => {
  const port = new FakePort();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-bench-test-'));
  try {
    const options = parse(['--port', '/dev/fake', '--repetitions', '1', '--warmup', '0', '--results', root]);
    assert.equal(options.readOnly, true);
    const { report } = await run(options, { transport: transportFor(port), progress: () => {} });
    assert.equal(report.error, undefined);
    assert.equal(report.cases.length, 26);
    assert(port.writes.every(packet => [Instruction.READ, Instruction.PING].includes(packet[4])));
    assert.throws(() => parse(['--port', '/dev/fake', '--baud', '12345']));
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('log failure still restores written RAM and closes the serial port and log', async () => {
  const port = new FakePort(), before = Buffer.from(port.tables.get(1));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-bench-test-'));
  const opened = new Set();
  const io = { ...fs,
    openSync(...args) { const fd = fs.openSync(...args); opened.add(fd); return fd; },
    closeSync(fd) { fs.closeSync(fd); opened.delete(fd); },
    writeSync(...args) {
      if (port.writes.some(p => p[4] === Instruction.WRITE)) throw new Error('disk full');
      return fs.writeSync(...args);
    },
    writeFileSync() { if (port.writes.some(p => p[4] === Instruction.WRITE)) throw new Error('disk full'); },
  };
  try {
    const options = parse(['--port', '/dev/fake', '--include-writes', '--cases', 'write-ram-4-counter',
      '--repetitions', '1', '--warmup', '0', '--results', root]);
    const { report } = await run(options, { transport: transportFor(port), progress: () => {}, io });
    assert(report.error);
    assert(report.cleanupErrors.length);
    assert(report.after[1]);
    assert.deepEqual(port.tables.get(1), before);
    assert.equal(port.isOpen, false);
    assert.equal(opened.size, 0);
  } finally { fs.rmSync(root, { recursive: true }); }
});
