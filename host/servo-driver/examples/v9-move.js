'use strict';

const fs = require('node:fs/promises');
const { randomInt } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { StsServo, ArmCodec } = require('sts32xx-servo-driver');

// A single-motor bench example, not a controller for an unsupported arm load.
// The caller owns the serial connection; this function owns torque cleanup.
async function move(servo, { id, session, config, positionQ8, speedLimit, gravityEffort = 0 },
  { sleep = delay, clock = () => performance.now(), cancelled = () => false } = {}) {
  const entries = [{ id, target: { sequence: 1, positionQ8, speedLimit } }];
  const gravity = { session, sequence: 1, gravityEffort };
  // Validate all command data before any motor state is changed.
  ArmCodec.encodeConfig(config);
  ArmCodec.encodeTargets(entries, session);
  ArmCodec.encodeGravity(gravity);
  const options = { timeoutMs: 100, rejectOnAlarm: true };
  const before = await servo.bus.read(id,
    ['torqueEnable', 'lock', 'servoStatus', 'responseStatusLevel', 'asyncWritePending'], options);
  if (before.torqueEnable || before.servoStatus || before.lock !== 1 || before.asyncWritePending)
    throw new Error('Requires torque off, locked settings, no alarms and no queued legacy command');
  const writeOptions = { ...options, expectResponse: before.responseStatusLevel !== 0 };
  let prepared = false, result, failure;

  function checkCancelled() { if (cancelled()) throw new Error('Motion cancelled'); }

  async function waitFor(accept, timeoutMs) {
    const start = clock();
    while (clock() - start < timeoutMs) {
      checkCancelled();
      await sleep(10);
      checkCancelled();
      const sample = await servo.arm.feedback(id, options);
      if (sample.faults || sample.session !== session || !sample.armed || !sample.selected)
        throw new Error('Motor fault or extension session lost');
      if (sample.fresh && sample.ageMs <= 10 && sample.driveEnabled && sample.outputReady && accept(sample))
        return sample;
    }
    throw new Error('Timed out waiting for fresh, ready feedback');
  }

  try {
    checkCancelled();
    await servo.arm.configure(id, config, options);
    prepared = true; // Include an ambiguous selection or enable reply in cleanup.
    await servo.arm.select(id, true, session, options);
    checkCancelled();
    await servo.bus.write(id, { torqueEnable: 1 }, writeOptions);
    await waitFor(() => true, 3000);
    await servo.arm.updateGravity(id, gravity, options);
    checkCancelled();
    await servo.arm.setTargets(entries, session, options);
    // Broadcast completion means sent, not accepted. Confirm both independent
    // sequences in a fresh sample, then wait until the motion planner finishes.
    result = await waitFor(sample => sample.acceptedSequence === 1 && sample.gravitySequence === 1 &&
      !sample.running, 30000);
  } catch (error) { failure = error; }
  if (prepared) {
    try {
      await servo.bus.write(id, { torqueEnable: 0 }, writeOptions);
      if ((await servo.bus.read(id, ['torqueEnable'], options)).torqueEnable !== 0)
        throw new Error('Torque-off readback failed');
    } catch (error) {
      throw new AggregateError(failure ? [failure, error] : [error], 'Could not confirm torque off');
    }
  }
  if (failure) throw failure;
  return result;
}

async function main() {
  const [port, idText, positionText, speedText, configFile, gravityText = '0', extra] = process.argv.slice(2);
  const usage = 'node examples/v9-move.js PORT ID POSITION_COUNTS SPEED_COUNTS_S CONFIG_JSON [GRAVITY_EFFORT]';
  if (port === '--help') { console.log(usage); return; }
  if (!port || !idText || !positionText || !speedText || !configFile || extra) throw new Error(usage);
  const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  const command = { id: Number(idText), session: randomInt(1, 65536), config,
    positionQ8: Number(positionText) * 256, speedLimit: Number(speedText), gravityEffort: Number(gravityText) };
  // Validate before opening the port as well as before control starts.
  ArmCodec.encodeConfig(config);
  ArmCodec.encodeTargets([{ id: command.id, target: { sequence: 1,
    positionQ8: command.positionQ8, speedLimit: command.speedLimit } }], command.session);
  ArmCodec.encodeGravity({ session: command.session, sequence: 1, gravityEffort: command.gravityEffort });
  const servo = new StsServo({ serial: { path: port, baudRate: 1000000 } });
  let stopped = false;
  const stop = () => { stopped = true; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    await servo.connect();
    console.log(JSON.stringify(await move(servo, command, { cancelled: () => stopped }), null, 2));
  } finally {
    try { await servo.close(); }
    finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { move };
