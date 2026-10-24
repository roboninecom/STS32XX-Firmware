'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { move } = require('../examples/v9-move');

const config = { kpQ8: 256, kdQ8: 0, kiQ8: 0, integralLimit: 0,
  effortLimit: 100, velocityLimit: 100, accelerationLimit: 500,
  velocityFilterQ8: 64, rampTimeMs: 30, gravitySlewEffortPerS: 1000,
  velocityFeedforward: { positiveGainQ8: 0, negativeGainQ8: 0, effortLimit: 0 } };
const command = { id: 2, session: 123, config, positionQ8: 2048 * 256, speedLimit: 100 };

function bench({ failEnable = false, failCleanup = false, fault = false, stale = false } = {}) {
  const events = [];
  let powered = false, accepted = false, reads = 0, now = 0;
  const servo = {
    bus: {
      read: async () => ({ torqueEnable: Number(powered), lock: 1, servoStatus: 0,
        responseStatusLevel: 0, asyncWritePending: 0 }),
      write: async (_id, values, options) => {
        events.push(`torque:${values.torqueEnable}`);
        assert.equal(options.expectResponse, false);
        powered = Boolean(values.torqueEnable);
        if (powered && failEnable) throw new Error('Enable reply lost');
        if (!powered && failCleanup) throw new Error('Disconnected during cleanup');
      },
    },
    arm: {
      configure: async () => events.push('configure'),
      select: async (_id, enabled, session) => {
        assert.equal(enabled, true); assert.equal(session, 123); events.push('select');
      },
      feedback: async () => {
        events.push('feedback'); ++reads;
        return { fresh: !stale, ageMs: 0, driveEnabled: true, outputReady: true,
          faults: fault ? 1 : 0, session: 123, selected: true, armed: true,
          acceptedSequence: accepted ? 1 : 0, gravitySequence: accepted ? 1 : 0,
          running: accepted && reads === 2 };
      },
      updateGravity: async (_id, value) => { assert.equal(value.sequence, 1); events.push('gravity'); },
      setTargets: async () => { accepted = true; events.push('targets'); },
    },
  };
  return { servo, events, options: { sleep: async ms => { now += ms; }, clock: () => now } };
}

test('motion example checks readiness and acceptance before completing, then releases torque', async () => {
  const { servo, events, options } = bench();
  const result = await move(servo, command, options);
  assert.equal(result.acceptedSequence, 1);
  assert.equal(result.running, false);
  assert.deepEqual(events, ['configure', 'select', 'torque:1', 'feedback', 'gravity',
    'targets', 'feedback', 'feedback', 'torque:0']);
});

test('invalid example configuration fails before touching the servo', async () => {
  const { servo, events } = bench();
  servo.bus.read = async () => assert.fail('Unexpected I/O');
  await assert.rejects(move(servo, { ...command, config: { ...config, effortLimit: 0 } }), /effortLimit/);
  assert.deepEqual(events, []);
});

test('lost enable reply and reported faults both trigger torque-off cleanup', async () => {
  for (const failure of [{ failEnable: true }, { fault: true }]) {
    const { servo, events, options } = bench(failure);
    await assert.rejects(move(servo, command, options));
    assert.equal(events.at(-1), 'torque:0');
    assert(!events.includes('targets'));
  }
});

test('a stalled sample stream times out and releases torque', async () => {
  const { servo, events, options } = bench({ stale: true });
  await assert.rejects(move(servo, command, options), /Timed out/);
  assert.equal(events.at(-1), 'torque:0');
});

test('cancellation after selection never enables torque', async () => {
  const { servo, events, options } = bench();
  await assert.rejects(move(servo, command, { ...options, cancelled: () => events.includes('select') }), /cancelled/);
  assert(!events.includes('torque:1'));
  assert.equal(events.at(-1), 'torque:0');
});

test('cleanup failure retains the initial failure too', async () => {
  const { servo, options } = bench({ failEnable: true, failCleanup: true });
  await assert.rejects(move(servo, command, options), error => {
    assert(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    assert.match(error.errors[0].message, /Enable reply lost/);
    return true;
  });
});
