#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createInterface } = require('node:readline/promises');
const { StsServo, BAUD_RATES } = require('../../host/servo-driver');
const { PoseCapture, validateIds, saveRecording } = require('./capture');

const USAGE = 'npm run record-poses -- --port PORT --ids 1,2,3 [--baud 1000000] [--output DIR] [--timeout-ms 1000]';
function parse(args) {
  const options = { baudRate: 1000000, timeoutMs: 1000, output: path.join(__dirname, 'recordings') };
  const fields = { '--port': 'port', '--ids': 'ids', '--baud': 'baudRate', '--output': 'output', '--timeout-ms': 'timeoutMs' };
  if (args.includes('--help')) return { help: true };
  const seen = new Set();
  for (let i = 0; i < args.length; i += 2) {
    const key = fields[args[i]], value = args[i + 1];
    if (!key || !value || value.startsWith('--') || seen.has(key)) throw new Error(USAGE);
    seen.add(key);
    options[key] = key === 'ids' ? value.split(',').map(value => value.trim() ? Number(value) : NaN)
      : ['baudRate', 'timeoutMs'].includes(key) ? Number(value) : value;
  }
  if (!options.port || !BAUD_RATES.includes(options.baudRate) ||
      !Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 10000) throw new Error(USAGE);
  validateIds(options.ids);
  return options;
}

async function run(options, { createServo = config => new StsServo(config), question,
  signal, output = console.log, save = saveRecording } = {}) {
  const directory = path.resolve(options.output);
  await fs.mkdir(directory, { recursive: true });
  const filename = path.join(directory, `poses-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}.json`);
  const record = { format: 'sts-poses', version: 1, units: 'encoder-counts',
    capturedAt: new Date().toISOString(), port: options.port, baudRate: options.baudRate,
    ids: options.ids, readMode: 'sequential', poses: [] };
  // Reserve a new file before asking to release torque; never overwrite a run.
  await fs.writeFile(filename, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  const servo = createServo({ serial: { path: options.port, baudRate: options.baudRate } });
  let capture, releaseAttempted = false, failure;
  const failures = [];
  try {
    signal?.throwIfAborted();
    const found = await servo.connect();
    output(`Discovered: ${found.ids.join(', ') || 'none'}; selected: ${options.ids.join(', ')}`);
    capture = new PoseCapture(servo.bus, options.ids, { timeoutMs: options.timeoutMs });
    const confirmation = await question('Support the mechanism against gravity. Press Enter to release the selected motors, or type cancel: ');
    signal?.throwIfAborted();
    if (confirmation.trim() !== '') throw new Error('Capture cancelled before torque release');
    releaseAttempted = true;
    await capture.release();
    output(`Torque off verified. Keep supporting the mechanism. Saving to ${filename}`);
    while (true) {
      signal?.throwIfAborted();
      const answer = (await question('Enter to capture, type a pose name, or type done: ')).trim();
      if (answer.toLowerCase() === 'done') break;
      const name = answer || `position-${record.poses.length + 1}`;
      if (record.poses.some(pose => pose.name === name)) { output(`Pose ${name} already exists`); continue; }
      const pose = { name, ...await capture.read({ signal }) };
      record.poses.push(pose);
      await save(filename, record);
      output(`${name}: ${JSON.stringify(pose.positions)}`);
    }
  } catch (error) { failure = error; }
  finally {
    if (releaseAttempted) {
      try { await capture.release(); } catch (error) { failures.push(error); }
    }
    try { await servo.close(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failure ? [failure, ...failures] : failures, 'Capture cleanup failed');
  if (failure) throw failure;
  return { filename, poses: record.poses.length };
}

async function main() {
  const options = parse(process.argv.slice(2));
  if (options.help) { console.log(USAGE); return; }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Pose recording requires an interactive terminal');
  const abort = new AbortController(), terminal = createInterface({ input: process.stdin, output: process.stdout });
  const stop = () => abort.abort(new Error('Capture interrupted'));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  terminal.on('SIGINT', stop);
  terminal.on('close', () => { if (!abort.signal.aborted) stop(); });
  try {
    console.log(JSON.stringify(await run(options, { signal: abort.signal,
      question: text => terminal.question(text, { signal: abort.signal }) }), null, 2));
  } finally {
    terminal.close();
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { parse, run };
