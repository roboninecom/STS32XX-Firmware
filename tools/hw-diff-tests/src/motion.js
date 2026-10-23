'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { Instruction } = require('../../../host/servo-driver');
const { CleanupError } = require('./errors');
const { persistentBytes } = require('./register-image');

function signed15(low, high) {
  const raw = low | (high << 8);
  return raw & 0x8000 ? -(raw & 0x7fff) : raw;
}

function signedPwm(low, high) {
  const raw = low | (high << 8);
  return raw & 0x0400 ? -(raw & 0xfbff) : raw;
}

async function sample(rig, id) {
  const bytes = await rig.read(id, 56, 17);
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

async function trace(rig, id, durationMs, intervalMs = 25) {
  const started = process.hrtime.bigint();
  const samples = [];
  do {
    const value = await sample(rig, id);
    assert.equal(value.status, 0, `servo ${id} alarm ${value.status} during motion`);
    samples.push({ elapsedMs: Number(process.hrtime.bigint() - started) / 1e6, ...value });
    await delay(intervalMs);
  } while (Number(process.hrtime.bigint() - started) / 1e6 < durationMs);
  return samples;
}

async function pacedWrite(rig, id, address, values) {
  await rig.write(id, address, values);
  await delay(25);
}

async function waitForDrive(rig, id, minimumPwm = 80, timeoutMs = 1000) {
  const started = process.hrtime.bigint();
  const samples = [];
  do {
    const value = await sample(rig, id);
    assert.equal(value.status, 0, `servo ${id} alarm ${value.status} while establishing drive`);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    samples.push({ elapsedMs, ...value });
    if (Math.abs(value.pwm) >= minimumPwm) return samples;
    if (elapsedMs >= timeoutMs) break;
    await delay(25);
  } while (true);
  assert.fail(`servo ${id} drive did not reach absolute PWM ${minimumPwm} within ` +
    `${timeoutMs} ms (last PWM ${samples.at(-1).pwm})`);
}

async function prepare(rig, id, mode, before) {
  assert.equal(before[40], 0, 'torque must be off before driven mode test');
  assert.equal(before[33], 0, 'driven mode test requires position-mode entry');
  assert.equal(before[55], 1, 'persistence must start locked');
  await rig.write(id, 55, [2]);
  await pacedWrite(rig, id, 40, [0]);
  if (mode !== 0) await pacedWrite(rig, id, 33, [mode]);
  if ((mode === 0 || mode === 3) &&
      (before[9] !== before[11] || before[10] !== before[12])) {
    await pacedWrite(rig, id, 9, [0, 0, 0, 0]);
  }
  await rig.command(id, Instruction.ENCODER_HOME);
  await delay(35);
}

async function cleanup(rig, id, before, operationError) {
  try {
    await rig.reset(id);
    const after = await rig.read(id, 0, 87);
    assert.deepEqual(persistentBytes(after), persistentBytes(before),
      `servo ${id} persistent settings changed during driven mode test`);
    assert.equal(after[40], 0, 'reset did not disable torque');
    assert.equal(after[33], before[33], 'reset did not restore work mode');
    assert.equal(after[55], 1, 'reset did not restore lock');
  } catch (cleanupError) {
    throw new CleanupError(`driven mode cleanup failed on ID ${id}`,
      operationError, cleanupError);
  }
}

async function exercise(context, mode, body) {
  const { rig, id } = context;
  const before = await rig.read(id, 0, 87);
  let operationError;
  let result;
  try {
    await prepare(rig, id, mode, before);
    result = await body(rig, id, before);
  } catch (error) { operationError = error; }
  await cleanup(rig, id, before, operationError);
  if (operationError) throw operationError;
  return result;
}

module.exports = { sample, trace, pacedWrite, exercise, waitForDrive };
