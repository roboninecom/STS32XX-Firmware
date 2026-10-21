'use strict';

const assert = require('node:assert/strict');
const { PacketEncoder, Instruction } = require('../../../../../host/servo-driver');
const { CleanupError } = require('../errors');
const { persistentBytes } = require('../register-image');
const { decodeOffset, circularError } = require('../position');

const word = (bytes, address) => bytes[address] | (bytes[address + 1] << 8);
const signed15 = value => value & 0x8000 ? -(value & 0x7fff) : value;
const bytes16 = value => [value & 0xff, value >> 8];

// Rig.read intentionally exposes just parameters for generic protocol cases.
// Here a valid packet carrying a device alarm must fail, even if register 65
// has already cleared. Keep the response header in the recorded wire evidence.
async function readHealthy(rig, id, address, length) {
  const response = await rig.exchange(`lerobot-read:${id}:${address}:${length}`,
    PacketEncoder.frame(id, Instruction.READ, [address, length]), {
      match: packet => packet.id === id && packet.parameters.length === length,
    });
  assert.equal(response.error, 0, `servo ${id} READ header alarm ${response.error}`);
  return response.parameters;
}

async function writeHealthy(rig, id, address, data) {
  const response = await rig.write(id, address, data);
  assert.equal(response.error, 0, `servo ${id} WRITE ${address} header alarm ${response.error}`);
}

async function readPosition(rig, id, grouped) {
  if (!grouped) return signed15(word(await readHealthy(rig, id, 56, 2), 0));
  const result = await rig.syncRead([id], 56, 2);
  const response = result.responses.get(id);
  assert.ok(response, `servo ${id} missing SYNC_READ position`);
  assert.equal(response.error, 0, `servo ${id} SYNC_READ header alarm ${response.error}`);
  return signed15(word(response.parameters, 0));
}

function checkTelemetry(bytes, baseline, temperature = { consecutive: 0, outliers: 0 }) {
  assert.equal(bytes[40], 0, 'torque enabled during torque-off calibration');
  assert.equal(word(bytes, 60), 0, 'nonzero PWM during torque-off calibration');
  assert.equal(bytes[65], 0, `telemetry alarm ${bytes[65]}`);
  // Relative limits allow different models and supply voltages. They detect
  // the observed channel rotation (voltage -> temperature, temperature ->
  // current, near-zero current -> voltage) without changing protection limits.
  assert.ok(Math.abs(bytes[62] - baseline[62]) <= 10,
    `voltage changed from ${baseline[62]} to ${bytes[62]} after persistent write`);
  // Factory firmware also emits isolated temperature spikes. Retain every raw
  // value and count them, but distinguish them from persistent slot corruption.
  // This is a test classification, not filtering of telemetry or protection.
  const outlier = Math.abs(bytes[63] - baseline[63]) > 8;
  temperature.consecutive = outlier ? temperature.consecutive + 1 : 0;
  temperature.outliers += Number(outlier);
  assert.ok(temperature.consecutive < 3,
    `temperature changed from ${baseline[63]} to ${bytes[63]} for three consecutive reads`);
  assert.ok(Math.abs(word(bytes, 69) - word(baseline, 69)) <= 50,
    'current changed by more than 50 raw units with torque off');
}

async function withOffsetRestored({ rig, id }, body) {
  const before = await readHealthy(rig, id, 0, 87);
  assert.equal(before[5], id, 'register ID differs from target');
  assert.equal(before[40], 0, 'LeRobot regression requires torque off');
  assert.equal(before[55], 1, 'LeRobot regression requires locked entry');
  assert.equal(before[33], 0, 'LeRobot regression requires position mode');
  checkTelemetry(before, before);
  rig.events.push({ kind: 'evidence', label: `lerobot-before:${id}`,
    registerBytes: before.toString('hex') });
  let result;
  let operationError;
  try {
    // Same persistent unlock as LeRobot.disable_torque(). Lock 2 or a reset
    // between a write and its read would hide the acquisition restart defect.
    await writeHealthy(rig, id, 40, [0]);
    await writeHealthy(rig, id, 55, [0]);
    result = await body(before);
  } catch (error) { operationError = error; }
  try {
    // A failed old image may have latched false voltage/current alarms. Reset
    // before restoring, then verify the durable image with a second reset.
    await rig.reset(id);
    // Preserve alarm-bearing ACKs in the trace but finish recovery: an old
    // image can retrigger its bug on the restoration write itself.
    await rig.write(id, 40, [0]);
    await rig.write(id, 55, [0]);
    await rig.write(id, 31, [...before.subarray(31, 33)]);
    await rig.write(id, 55, [1]);
    await rig.reset(id);
    const after = await readHealthy(rig, id, 0, 87);
    assert.deepEqual(persistentBytes(after), persistentBytes(before),
      'LeRobot regression did not restore the complete persistent image');
    assert.equal(after[55], 1, 'cleanup left persistence unlocked');
    checkTelemetry(after, before);
  } catch (cleanupError) {
    throw new CleanupError(`LeRobot regression cleanup failed on ID ${id}`,
      operationError, cleanupError);
  }
  if (operationError) throw operationError;
  return { exact: { ...result.exact, persistentImageRestored: true, torqueOff: true },
    evidence: { ...result.evidence, preTestRegisterBytes: before.toString('hex') } };
}

async function persistentAcquisition(context) {
  const { rig, id } = context;
  return withOffsetRestored(context, async before => {
    const original = word(before, 31);
    const trials = [];
    const temperature = { consecutive: 0, outliers: 0 };
    for (let iteration = 0; iteration < 100; iteration++) {
      const marker = iteration % 2 === 0 ? original ^ 1 : original;
      await writeHealthy(rig, id, 31, bytes16(marker));
      const ranges = { voltage: [255, 0], temperature: [255, 0], current: [65535, 0] };
      for (let sample = 0; sample < 30; sample++) {
        const bytes = await readHealthy(rig, id, 0, 87);
        checkTelemetry(bytes, before, temperature);
        assert.equal(word(bytes, 31), marker, 'offset write was not applied');
        for (const [name, value] of [['voltage', bytes[62]],
          ['temperature', bytes[63]], ['current', word(bytes, 69)]]) {
          ranges[name][0] = Math.min(ranges[name][0], value);
          ranges[name][1] = Math.max(ranges[name][1], value);
        }
      }
      trials.push({ iteration, marker, ranges });
    }
    return { exact: { writes: 100, telemetryReads: 3000, noAlarms: true },
      evidence: { trials, temperatureOutlierReads: temperature.outliers } };
  });
}

async function immediateHoming(context) {
  const { rig, id } = context;
  return withOffsetRestored(context, async before => {
    const rawPosition = ((signed15(word(before, 56)) +
      decodeOffset(word(before, 31))) % 4096 + 4096) % 4096;
    const trials = [];
    const temperature = { consecutive: 0, outliers: 0 };
    for (let iteration = 0; iteration < 20; iteration++) {
      // Force a nonzero previous coordinate system, even if the motor starts
      // with offset zero or already happens to be centred. Establish it before
      // the critical clear -> immediate read -> computed offset sequence.
      await writeHealthy(rig, id, 31, bytes16(64));
      for (let sample = 0; sample < 10; sample++) {
        checkTelemetry(await readHealthy(rig, id, 0, 87), before, temperature);
      }
      const grouped = iteration % 2 === 1;
      await writeHealthy(rig, id, 31, [0, 0]);
      // Deliberately no sleep, reset, retries or other transaction here.
      const clearedPosition = await readPosition(rig, id, grouped);
      assert.ok(Math.abs(circularError(clearedPosition, rawPosition)) <= 4,
        `stale position after clearing offset: ${clearedPosition}, expected ${rawPosition}`);
      const offset = clearedPosition - 2047;
      assert.ok(offset >= -2047 && offset <= 2047,
        'shaft must be away from encoder endpoint 4095 for LeRobot sign-bit-11 offset');
      const encoded = offset < 0 ? -offset | 0x800 : offset;
      await writeHealthy(rig, id, 31, bytes16(encoded));
      const immediatePosition = await readPosition(rig, id, grouped);
      assert.ok(Math.abs(immediatePosition - 2047) <= 2,
        `immediate homing position ${immediatePosition}, expected 2047`);
      const following = await readHealthy(rig, id, 0, 87);
      checkTelemetry(following, before, temperature);
      assert.equal(word(following, 31), encoded, 'homing offset did not apply');
      assert.ok(Math.abs(signed15(word(following, 56)) - 2047) <= 2,
        'homing centre changed on the following read');
      trials.push({ iteration, read: grouped ? 'sync' : 'individual',
        clearedPosition, offset, immediatePosition });
    }
    return { exact: { homings: 20, clearedCoordinatesCorrect: true, centred: true },
      evidence: { rawPosition, trials, temperatureOutlierReads: temperature.outliers } };
  });
}

module.exports = [
  { id: 'test_lerobot_persistent_write_sensor_integrity', scope: 'device', risk: 'safe',
    stages: ['lerobot'], requiresPersistenceWrite: true,
    covers: { registers: [31, 32, 40, 55, 60, 61, 62, 63, 65, 69, 70],
      persistence: ['mid-scan-restart', 'repeated-offset-write', 'restore'] },
    run: persistentAcquisition },
  { id: 'test_lerobot_immediate_offset_homing', scope: 'device', risk: 'safe',
    stages: ['lerobot'], requiresPersistenceWrite: true,
    covers: { registers: [31, 32, 40, 55, 56, 57, 62, 63, 65],
      persistence: ['clear-read-home-without-delay', 'restore'] },
    run: immediateHoming },
];
