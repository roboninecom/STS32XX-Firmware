'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { waitForDrive } = require('../src/motion');

function rigFor(values) {
  let index = 0;
  return { async read() {
    const value = values[Math.min(index++, values.length - 1)];
    const bytes = Buffer.alloc(17);
    bytes.writeUInt16LE(Math.abs(value.pwm) | (value.pwm < 0 ? 0x400 : 0), 4);
    bytes[9] = value.status ?? 0;
    return bytes;
  } };
}

test('drive readiness accepts a ramp that crosses the threshold after 220 ms', async () => {
  const samples = await waitForDrive(rigFor([
    ...Array.from({ length: 11 }, () => ({ pwm: -79 })), { pwm: -80 },
  ]), 1);
  assert.ok(samples.at(-1).elapsedMs > 220);
  assert.equal(samples.at(-1).pwm, -80);
});

test('absent drive fails within a bounded timeout', async () => {
  await assert.rejects(waitForDrive(rigFor([{ pwm: 0 }]), 1, 80, 30),
    /did not reach absolute PWM 80.*last PWM 0/);
});

test('an alarm aborts drive setup before fault injection', async () => {
  await assert.rejects(waitForDrive(rigFor([{ pwm: 100, status: 32 }]), 1),
    /alarm 32 while establishing drive/);
});
