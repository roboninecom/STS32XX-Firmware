'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { parse, decodeTelemetry, anomalies } = require('./telemetry_soak');

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
