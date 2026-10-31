#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { StsServo, BAUD_RATES } = require('../../host/servo-driver');
const { openLog } = require('../../host/arm-control/session');
const { LegacyReplay } = require('./LegacyReplay');

const USAGE = `npm run replay-legacy -- POSES.json --port PORT [--run]
  --speed 1000          Maximum speed in encoder counts/s
  --acceleration 5000   Acceleration in counts/s², multiples of 100
  --hold-ms 1000        Hold after each pose
  --baud 1000000        Serial baud rate
Without --run: read-only preview. Uses saved legacy PID settings.`;

function parse(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const options = { filename: args[0], speed: 1000, acceleration: 5000, holdMs: 1000, baudRate: 1000000, move: false };
  if (!options.filename || options.filename.startsWith('--')) throw new Error(USAGE);
  const fields = { '--port': 'port', '--speed': 'speed', '--acceleration': 'acceleration', '--hold-ms': 'holdMs', '--baud': 'baudRate' };
  const seen = new Set();
  for (let i = 1; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw new Error(USAGE);
    seen.add(flag);
    if (flag === '--run') { options.move = true; continue; }
    const key = fields[flag], value = args[++i];
    if (!key || !value || value.startsWith('--')) throw new Error(USAGE);
    options[key] = key === 'port' ? value : Number(value);
  }
  if (!options.port?.trim() || !BAUD_RATES.includes(options.baudRate) ||
      !Number.isInteger(options.speed) || options.speed < 1 || options.speed > 32767 ||
      !Number.isInteger(options.acceleration) || options.acceleration < 100 || options.acceleration > 25400 || options.acceleration % 100 ||
      !Number.isInteger(options.holdMs) || options.holdMs < 0 || options.holdMs > 600000) throw new Error(USAGE);
  return options;
}

async function run(options, { signal, output = console.log, createLog = openLog,
  createServo = config => new StsServo(config), clock, sleep } = {}) {
  if ((await fs.stat(options.filename)).size > 64 * 1024 * 1024) throw new Error('Pose file exceeds 64 MiB');
  const raw = await fs.readFile(options.filename, 'utf8');
  const servo = createServo({ serial: { path: options.port, baudRate: options.baudRate } });
  const abort = new AbortController();
  const stop = () => abort.abort(signal?.reason ?? new Error('Replay interrupted'));
  const fault = error => abort.abort(error instanceof Error ? error : new Error('Servo transport fault'));
  const disconnected = () => fault(new Error('Servo disconnected'));
  let log, controller, failure;
  const cleanupErrors = [];
  const emit = async event => { if (log) await log.write(event); };
  try {
    controller = new LegacyReplay(servo, JSON.parse(raw), options, { signal: abort.signal, clock, sleep, emit });
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    servo.on('fault', fault); servo.on('disconnect', disconnected);
    const limits = await controller.preflight();
    let previous = Object.fromEntries(controller.record.ids.map(id => [id, limits.follower[id].position]));
    const preview = controller.record.poses.map(pose => {
      const targets = controller.frame(pose, previous);
      previous = Object.fromEntries(targets.map(t => [t.id, t.position]));
      return { name: pose.name, targets };
    });
    const preflight = { type: 'preflight', mode: 'legacy', limits,
      config: { ...options, filename: path.resolve(options.filename) },
      replay: { path: path.resolve(options.filename), sha256: createHash('sha256').update(raw).digest('hex'),
        kind: 'poses', frames: preview.length, coordination: 'distance-scaled speed limits' } };
    output(JSON.stringify({ ...preflight, preview }, null, 2));
    if (options.move) {
      controller.check();
      log = await createLog(); output(`Session log: ${log.filename}`);
      await emit(preflight);
      await controller.play();
      controller.check();
      await emit({ type: 'stopped', mode: 'legacy', holdRetained: true, completedPoses: preview.length });
      output('Completed; legacy control holds the final pose. Saved settings unchanged.');
    }
  } catch (error) {
    failure = error;
    if (controller) cleanupErrors.push(...await controller.disableTorque());
    try { await emit({ type: 'error', message: error.message, cleanupFailures: cleanupErrors.map(e => e.message) }); }
    catch (logError) { cleanupErrors.push(logError); }
  } finally {
    signal?.removeEventListener('abort', stop);
    servo.off('fault', fault); servo.off('disconnect', disconnected);
    try { await servo.close(); } catch (error) { cleanupErrors.push(error); }
    try { await log?.close(); } catch (error) { cleanupErrors.push(error); }
  }
  if (cleanupErrors.length) throw new AggregateError(failure ? [failure, ...cleanupErrors] : cleanupErrors,
    [failure?.message, ...cleanupErrors.map(e => e.message)].filter(Boolean).join('; '));
  if (failure) throw failure;
}

async function main(args) {
  const options = parse(args);
  if (options.help) { console.log(USAGE); return; }
  const abort = new AbortController(), stop = () => abort.abort(new Error('Replay interrupted'));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try { await run(options, { signal: abort.signal }); }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parse, run };
