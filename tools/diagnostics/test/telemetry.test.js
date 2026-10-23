'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { parse, decodeTelemetry, anomalies } = require('../telemetry');

test('100k samples per selected ID is the default and bad selections fail', () => {
  assert.deepEqual(parse(['--port', '/dev/fake', '--output', '/tmp/soak']).ids, [1, 2]);
  assert.equal(parse(['--port', '/dev/fake', '--output', '/tmp/soak']).samples, 100000);
  assert.equal(parse(['--port', '/dev/fake', '--output', '/tmp/soak',
    '--samples', '3000', '--interval-ms', '100']).intervalMs, 100);
  assert.throws(() => parse(['--port', '/dev/fake', '--output', '/tmp/soak', '--ids', '1,1']));
  assert.throws(() => parse(['--port', '/dev/fake', '--output', '/tmp/soak', '--samples', '0']));
  assert.throws(() => parse(['--port', '/dev/fake', '--output', '/tmp/soak',
    '--interval-ms', '100', '--gap-ms', '10']));
});

test('decode all 17 telemetry bytes including signed fields', () => {
  const value = decodeTelemetry(Buffer.from([
    0x00, 0x08, 0x02, 0x80, 0x05, 0x04, 125, 34, 0,
    2, 1, 0xff, 0x0f, 0x01, 0x80, 0x20, 0x00,
  ]));
  assert.deepEqual(value, { position: 2048, speed: -2, pwm: -5,
    voltage: 125, temperature: 34, status: 2, moving: 1,
    activePosition: 4095, current: -1, activeVelocity: 32 });
});

test('flag corrupt-looking stationary samples but allow encoder wrap', () => {
  const baseline = { position: 4094, speed: 0, pwm: 0, voltage: 125,
    temperature: 34, status: 0, moving: 0, current: 0 };
  assert.deepEqual(anomalies({ ...baseline, position: 2 }, baseline, baseline), []);
  assert.deepEqual(anomalies({ ...baseline, position: 900, speed: 800,
    pwm: 10, status: 2, moving: 7 }, baseline, baseline),
  ['status', 'moving-byte', 'pwm-while-torque-off', 'speed-spike', 'position-jump']);
});

test('detect a two-degree one-sample temperature spike', () => {
  const stable = { position: 1000, speed: 0, pwm: 0, voltage: 125,
    temperature: 34, status: 0, moving: 0, current: 0 };
  const spike = { ...stable, temperature: 32 };
  assert.deepEqual(anomalies(spike, stable, stable), ['temperature-jump']);
  assert.deepEqual(anomalies(stable, spike, stable, stable),
    ['temperature-jump', 'temperature-single-sample-spike']);
});

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run, nextRound } = require('../telemetry');
const { Instruction } = require('../../../host/servo-driver');
const { FakePort, transportFor } = require('./fake-port');

function setup(t, samples = [34, 34, 34]) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-test-'));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const port = new FakePort();
  let index = 0;
  port.onRequest = packet => {
    port.silent = false;
    if (packet[4] === Instruction.READ && packet[5] === 56) {
      const temperature = samples[index++];
      port.silent = temperature === null;
      if (!port.silent) port.tables.get(packet[2])[63] = temperature;
    }
  };
  const options = parse(['--port', '/dev/fake', '--output', output, '--ids', '1',
    '--samples', String(samples.length), '--timeout-ms', '5']);
  const dependencies = { transport: transportFor(port), progress: () => {}, sleep: async () => {} };
  return { output, port, options, dependencies };
}

function readAnomalies(output) {
  return fs.readFileSync(path.join(output, 'anomalies.jsonl'), 'utf8')
    .trim().split('\n').filter(Boolean).map(JSON.parse);
}

test('voltage limits support lower-voltage motors and reject invalid ranges', () => {
  const options = parse(['--port', '/dev/fake', '--output', '/tmp/soak',
    '--voltage-min', '5.5', '--voltage-max', '8.4']);
  const value = { position: 1000, speed: 0, pwm: 0, voltage: 74,
    temperature: 34, status: 0, moving: 0, current: 0 };
  assert.deepEqual(anomalies(value, null, value, null, options), []);
  assert(anomalies({ ...value, voltage: 90 }, null, value, null, options).includes('voltage-range'));
  for (const range of [['9', '8'], ['NaN', '8'], ['-1', '8'], ['5', '26']])
    assert.throws(() => parse(['--port', '/dev/fake', '--output', '/tmp/soak',
      '--voltage-min', range[0], '--voltage-max', range[1]]));
  assert.deepEqual(parse(['--help']), { help: true });
  assert.throws(() => parse(['--port', '--output', '/tmp/soak']));
});

test('successful telemetry run is read-only and preserves settings', async t => {
  const { options, dependencies, port, output } = setup(t);
  const before = Buffer.from(port.tables.get(1));
  const { report } = await run(options, dependencies);
  assert.deepEqual(report.errors, []);
  assert.equal(report.devices[1].attempts, 3);
  assert.equal(report.devices[1].responses, 3);
  assert.equal(report.devices[1].latencyMs.count, 3);
  assert.deepEqual(report.devices[1].anomalyCounts, {});
  assert.equal(fs.readFileSync(path.join(output, 'samples.csv'), 'utf8').trim().split('\n').length, 4);
  assert.deepEqual(port.tables.get(1), before);
  assert(port.writes.every(packet => packet[4] === Instruction.READ));
  assert.equal(port.isOpen, false);
});

test('a spike identifies its actual sample and a timeout breaks temperature history', async t => {
  const { options, dependencies, output } = setup(t, [34, 32, null, 34, 32, 34]);
  const { report } = await run(options, dependencies);
  assert.deepEqual(report.errors, []);
  assert.equal(report.devices[1].counts.timeout, 1);
  assert.equal(report.devices[1].responses, 5);
  const events = readAnomalies(output);
  const spikes = events.filter(event => event.flags.includes('temperature-single-sample-spike'));
  assert.deepEqual(spikes.map(event => [event.index, event.spikeAtIndex]), [[5, 4]]);
  assert(!events.some(event => event.index === 3));
});

test('nonzero reply status also breaks temperature history', async t => {
  const { options, dependencies, port, output } = setup(t, [34, 32, 34, 34]);
  const original = port.onRequest;
  let index = 0;
  port.onRequest = packet => {
    original(packet);
    port.status = packet[5] === 56 && index++ === 2 ? 2 : 0;
  };
  const { report } = await run(options, dependencies);
  assert.equal(report.devices[1].counts['status-error'], 1);
  assert(!readAnomalies(output).some(event => event.flags.includes('temperature-single-sample-spike')));
});

test('late rounds skip expired deadlines without a catch-up burst', async t => {
  assert.deepEqual(nextRound(0n, 25000000n, 10), { due: 30000000n, missed: 2 });
  assert.deepEqual(nextRound(0n, 10000000n, 10), { due: 10000000n, missed: 0 });
  const { options, dependencies, port } = setup(t);
  options.intervalMs = 10;
  let now = 1000000000n;
  const starts = [];
  const original = port.onRequest;
  port.onRequest = packet => {
    original(packet);
    if (packet[5] === 56) { starts.push(now); now += 25000000n; }
  };
  const { report } = await run(options, { ...dependencies, clock: () => now,
    sleep: async ms => { now += BigInt(Math.round(ms * 1e6)); } });
  assert.deepEqual(starts.map(at => Number(at - starts[0]) / 1e6), [0, 30, 60]);
  assert.equal(report.missedDeadlines, 6);
});

test('interruption stops sampling but still checks settings and closes the port', async t => {
  const { options, dependencies, port } = setup(t);
  const { report } = await run(options, { ...dependencies,
    stopped: () => port.writes.some(packet => packet[5] === 56) });
  assert.equal(report.interrupted, true);
  assert.equal(report.devices[1].attempts, 1);
  assert(report.after[1]);
  assert.equal(port.isOpen, false);
});

test('logging failure cannot bypass final checks or closing file descriptors', async t => {
  const { options, dependencies, port } = setup(t);
  const opened = new Set();
  let writes = 0;
  const io = { ...fs,
    openSync(...args) { const fd = fs.openSync(...args); opened.add(fd); return fd; },
    closeSync(fd) { fs.closeSync(fd); opened.delete(fd); },
    writeSync(...args) { if (++writes > 1) throw new Error('disk full'); return fs.writeSync(...args); },
  };
  const { report } = await run(options, { ...dependencies, io });
  assert(report.errors.some(error => error.message === 'disk full'));
  assert(report.after[1]);
  assert.equal(port.isOpen, false);
  assert.equal(opened.size, 0);
});

test('partial file-open failure closes the first file without opening the port', async t => {
  const { options, dependencies, port, output } = setup(t);
  fs.writeFileSync(path.join(output, 'anomalies.jsonl'), 'existing evidence');
  const opened = new Set();
  const io = { ...fs,
    openSync(...args) { const fd = fs.openSync(...args); opened.add(fd); return fd; },
    closeSync(fd) { fs.closeSync(fd); opened.delete(fd); },
  };
  const { report } = await run(options, { ...dependencies, io });
  assert(report.errors.length);
  assert.equal(opened.size, 0);
  assert.equal(port.writes.length, 0);
  assert.equal(fs.readFileSync(path.join(output, 'anomalies.jsonl'), 'utf8'), 'existing evidence');
});

test('transport failures stop sampling and close the connection', async t => {
  const { options, dependencies, port } = setup(t);
  const original = port.onRequest;
  port.onRequest = packet => {
    original(packet);
    port.writeError = packet[5] === 56 ? 'disconnected' : null;
  };
  const { report } = await run(options, dependencies);
  assert.equal(report.devices[1].attempts, 1);
  assert.equal(report.devices[1].counts['transport-error'], 1);
  assert(report.errors.some(error => error.message.includes('disconnected')));
  assert.equal(port.isOpen, false);
});
