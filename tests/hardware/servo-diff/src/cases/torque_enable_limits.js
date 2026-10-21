'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { PacketEncoder, Instruction } = require('../../../../../host/servo-driver');
const { CleanupError } = require('../errors');
const { persistentBytes } = require('../register-image');
const { encodeSign15 } = require('../position');

const u16 = value => [value & 0xff, value >> 8];
const word = (bytes, at) => bytes[at] | (bytes[at + 1] << 8);
const signed15 = value => value & 0x8000 ? -(value & 0x7fff) : value;
const scenarios = [
  { name: 'below-minimum', low: 64, high: 160, priorGoal: 0, goal: 240, expected: 160 },
  { name: 'above-maximum', low: -160, high: -64, priorGoal: 0, goal: -240, expected: -160 },
  { name: 'inside-limits', low: -64, high: 64, priorGoal: 0, goal: 160, expected: 64 },
  { name: 'limits-disabled-old-goal', low: null, high: null, priorGoal: 96, goal: 128, expected: 128 },
];

async function read(rig, id, address, length) {
  const reply = await rig.exchange(`torque-limit-read:${id}:${address}:${length}`,
    PacketEncoder.frame(id, Instruction.READ, [address, length]), {
      match: packet => packet.id === id && packet.parameters.length === length,
    });
  assert.equal(reply.error, 0, `servo ${id} READ alarm ${reply.error}`);
  return reply.parameters;
}

async function write(rig, id, address, bytes) {
  const reply = await rig.write(id, address, bytes);
  assert.equal(reply.error, 0, `servo ${id} WRITE alarm ${reply.error}`);
}

async function sample(rig, id, origin) {
  const b = await read(rig, id, 40, 31);
  const value = { position: signed15(word(b, 16)), activePosition: signed15(word(b, 27)),
    pwm: word(b, 20), status: b[25], torque: b[0], cap: word(b, 8) };
  assert.equal(value.cap, 0, 'zero-output cap changed');
  assert.equal(value.pwm, 0, 'unexpected PWM in zero-output comparison');
  assert.equal(value.status, 0, `servo status ${value.status}`);
  if (origin != null) assert.ok(Math.abs(value.position - origin) <= 4,
    `shaft moved during zero-output comparison: ${origin} -> ${value.position}`);
  return value;
}

async function trace(rig, id, origin) {
  const started = performance.now();
  const samples = [];
  do {
    samples.push({ elapsedMs: performance.now() - started, ...await sample(rig, id, origin) });
    await delay(10);
  } while (performance.now() - started < 500);
  return samples;
}

async function run({ rig, id }) {
  const before = await read(rig, id, 0, 87);
  assert.equal(before[5], id);
  assert.equal(before[40], 0, 'torque must be off at entry');
  assert.equal(before[55], 1, 'settings must be locked at entry');
  assert.equal(before[33], 0, 'requires legacy position mode');
  assert.equal(before[30], 1, 'requires position divisor 1');
  assert.equal(before[65], 0, 'requires fault-free entry');
  const origin = signed15(word(before, 56));
  assert.ok(origin >= 240 && origin <= 3855,
    'position must leave 240 counts of room inside 0..4095 for this comparison');
  rig.events.push({ label: `torque-limit-before:${id}`, kind: 'evidence',
    registerBytes: before.toString('hex') });
  const trials = [];
  let operationError;
  try {
    // Lock 2 makes all setup RAM-only. The cap and all position gains are zero
    // before any goal (which can auto-enable torque) or enable is sent.
    await write(rig, id, 55, [2]);
    await write(rig, id, 48, [0, 0]);
    await write(rig, id, 21, [0, 0, 0, 0]);
    await write(rig, id, 41, [30]);
    await write(rig, id, 46, encodeSign15(600));
    const setup = await read(rig, id, 0, 87);
    assert.equal(setup[40], 0);
    assert.equal(setup[55], 2);
    assert.equal(word(setup, 48), 0);
    assert.deepEqual([...setup.subarray(21, 25)], [0, 0, 0, 0]);
    for (const scenario of scenarios) {
      await write(rig, id, 40, [0]);
      await write(rig, id, 9, [0, 0, 0, 0]);
      // Deliberately seed an old goal, then let torque-off control reanchor.
      await write(rig, id, 42, encodeSign15(origin + scenario.priorGoal));
      await delay(25);
      await write(rig, id, 40, [0]);
      await delay(60);
      const low = scenario.low == null ? 0 : origin + scenario.low;
      const high = scenario.high == null ? 0 : origin + scenario.high;
      await write(rig, id, 9, [...u16(low), ...u16(high)]);
      await delay(25);
      const disabled = await sample(rig, id, origin);
      assert.equal(disabled.torque, 0);
      assert.ok(Math.abs(disabled.activePosition - disabled.position) <= 4,
        'torque-off profile did not reanchor before enable');
      assert.deepEqual([...await read(rig, id, 9, 4)], [...u16(low), ...u16(high)]);
      await write(rig, id, 40, [1]); // The event under test: no new position goal.
      const enabled = await trace(rig, id, origin);
      assert.ok(enabled.every(s => s.torque === 1), 'torque did not remain enabled');
      assert.deepEqual([...await read(rig, id, 42, 2)],
        encodeSign15(origin + scenario.priorGoal), 'enable changed the goal register');
      const enableDelta = enabled.at(-1).activePosition - disabled.position;
      const peakEnableDelta = Math.max(...enabled.map(s =>
        Math.abs(s.activePosition - disabled.position)));

      // Positive control: an explicit goal must still move the internal
      // profile and respect configured limits. A frozen profile cannot pass.
      await write(rig, id, 42, encodeSign15(origin + scenario.goal));
      const commanded = await trace(rig, id, origin);
      const commandError = commanded.at(-1).activePosition - origin - scenario.expected;
      assert.ok(Math.abs(commandError) <= 4,
        `${scenario.name} explicit goal missed expected target by ${commandError}`);
      trials.push({ name: scenario.name, low, high,
        oldGoal: origin + scenario.priorGoal, disabled, enabled, commanded,
        enableDelta, peakEnableDelta, commandError });
    }
  } catch (error) { operationError = error; }
  try {
    // Reset restores RAM-only limits/gains and the original output cap.
    await rig.write(id, 40, [0]);
    await rig.reset(id);
    const after = await read(rig, id, 0, 87);
    assert.deepEqual(persistentBytes(after), persistentBytes(before),
      'persistent settings changed during torque-enable comparison');
    assert.equal(after[40], 0);
    assert.equal(after[55], 1);
    assert.equal(after[65], 0);
  } catch (cleanupError) {
    throw new CleanupError(`torque-enable comparison cleanup failed on ID ${id}`,
      operationError, cleanupError);
  }
  if (operationError) throw operationError;
  return { exact: { holds: trials.map(t => t.peakEnableDelta <= 4),
    explicitGoalsApplied: true, zeroOutput: true, persistentImageRestored: true },
  evidence: { origin, preTestRegisterBytes: before.toString('hex'), trials } };
}

function compare(factory, candidate) {
  const checks = scenarios.map(({ name }) => {
    const a = factory.evidence.trials.find(t => t.name === name);
    const b = candidate.evidence.trials.find(t => t.name === name);
    return { name: `${name} torque enable holds measured position`,
      factory: a?.enableDelta, candidate: b?.enableDelta, tolerance: 4,
      matched: Boolean(a && b && a.peakEnableDelta <= 4 && b.peakEnableDelta <= 4 &&
        Math.abs(a.commandError) <= 4 && Math.abs(b.commandError) <= 4) };
  });
  return { matched: checks.every(c => c.matched), checks };
}

module.exports = [{ id: 'test_torque_enable_outside_position_limits', scope: 'device',
  risk: 'motion', stages: ['torque-enable-limits'],
  covers: { modes: [0], registers: [9, 10, 11, 12, 21, 22, 23, 24, 40, 42, 43, 48, 49, 67, 68] },
  run, compare }];
