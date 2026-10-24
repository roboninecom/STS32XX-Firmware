'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { StsServo, BAUD_RATES } = require('../servo-driver');
const { ArmController } = require('./ArmController');

async function validatePorts(config, hasSource = false) {
  const ports = hasSource ? [config.followerPort] : [config.leaderPort, config.followerPort];
  if (ports.some(port => typeof port !== 'string' || !port.trim()))
    throw new Error(hasSource ? 'Follower serial port is required' : 'Leader and follower must have distinct serial ports');
  const resolved = await Promise.all(ports.map(async port => {
    // Windows COM names are device names, not filesystem paths.
    if (/^COM\d+$/i.test(port)) return port.toUpperCase();
    try { return await fs.realpath(port); }
    catch (error) { if (error.code === 'ENOENT') return path.resolve(port); throw error; }
  }));
  if (resolved[0] === resolved[1]) throw new Error('Leader and follower must have distinct serial ports');
  if (!BAUD_RATES.includes(config.baudRate ?? 1000000)) throw new Error('Unsupported baudRate');
}

async function openLog() {
  const directory = path.resolve(__dirname, '../../logs/motion');
  await fs.mkdir(directory, { recursive: true });
  const filename = path.join(directory, `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}.ndjson`);
  const file = await fs.open(filename, 'wx');
  return { filename,
    write: event => file.writeFile(`${JSON.stringify({ wallTime: new Date().toISOString(), ...event })}\n`),
    close: () => file.close() };
}

async function run(config, { move = false, source, createSource, gravity, signal, output = console.log,
  createServo = options => new StsServo(options), createLog = openLog,
  createController = options => new ArmController(options) } = {}) {
  await validatePorts(config, !!source);
  const leader = source ? null : createServo({ serial: { path: config.leaderPort, baudRate: config.baudRate ?? 1000000 } });
  const follower = createServo({ serial: { path: config.followerPort, baudRate: config.baudRate ?? 1000000 } });
  const controller = createController({ follower, config, source: source ?? createSource({ leader, config }), gravity });
  let log, error, runEntered = false, runCompleted = false;
  const cleanupErrors = [], listeners = [];
  const stop = () => { controller.stopping = true; };
  const checkFault = () => { if (controller.failure) throw controller.failure; };
  if (signal?.aborted) stop();
  signal?.addEventListener('abort', stop, { once: true });
  for (const [role, servo] of [['Leader', leader], ['Follower', follower]]) {
    if (!servo) continue;
    const fault = cause => controller.fail(new Error(`${role} serial fault: ${cause?.message ?? cause}`, { cause }));
    const disconnect = () => controller.fail(new Error(`${role} disconnected`));
    servo.on('fault', fault); servo.on('disconnect', disconnect);
    listeners.push(() => { servo.off('fault', fault); servo.off('disconnect', disconnect); });
  }
  try {
    if (!controller.stopping) {
      log = await createLog();
      output(`Session log: ${log.filename}`);
      await leader?.open(); checkFault();
      await follower.open(); checkFault();
      const preflight = { type: 'preflight', config, session: controller.session, limits: await controller.preflight() };
      if (gravity) preflight.gravityModel = gravity.identity;
      if (source) preflight.replay = controller.sourceSummary;
      checkFault(); await log.write(preflight); output(JSON.stringify(preflight));
      const preview = { type: 'preview', frame: await controller.sample() };
      checkFault(); await log.write(preview); output(JSON.stringify(preview));
      if (move && !controller.stopping) {
        let lastReport = 0;
        const started = Date.now();
        runEntered = true;
        await controller.run({
          shouldStop: () => config.durationMs !== undefined && Date.now() - started >= config.durationMs,
          onTelemetry: sample => log.write({ type: 'telemetry', ...sample }),
          onCommand: frame => log.write({ type: 'command', ...frame }),
          onFrame: async frame => {
            await log.write({ type: 'frame', ...frame });
            if (Date.now() - lastReport >= 1000) { output(JSON.stringify({ type: 'frame', ...frame })); lastReport = Date.now(); }
          },
        });
        runCompleted = true;
        const stopped = { type: 'stopped', follower: gravity
          ? 'motion settled; last target and gravity retained; torque remains enabled'
          : 'last target retained; torque remains enabled' };
        await log.write(stopped); checkFault(); output(JSON.stringify(stopped));
      }
      checkFault();
    }
  } catch (cause) {
    error = cause;
    // The loop cleans up its own failures. Also cover errors after a successful run,
    // such as failure to write the final log record while followers are still powered.
    if (!runEntered || runCompleted) {
      const failures = await controller.disableTorque();
      if (failures.length) cleanupErrors.push(new Error(`Torque-off cleanup: ${JSON.stringify(failures)}`));
    }
    try { await log?.write({ type: 'error', message: cause.message }); }
    catch (logError) { cleanupErrors.push(logError); }
  } finally {
    signal?.removeEventListener('abort', stop);
    // Closing our own ports must not turn an intentional exit into a disconnect fault.
    for (const remove of listeners) remove();
    const closed = await Promise.allSettled([leader?.close(), follower.close()]);
    for (const result of closed) if (result.status === 'rejected') cleanupErrors.push(result.reason);
    try { await log?.close(); } catch (closeError) { cleanupErrors.push(closeError); }
  }
  if (cleanupErrors.length) throw new AggregateError(error ? [error, ...cleanupErrors] : cleanupErrors,
    [error?.message, ...cleanupErrors.map(item => item.message)].filter(Boolean).join('; '));
  if (error) throw error;
}

module.exports = { validatePorts, run };
