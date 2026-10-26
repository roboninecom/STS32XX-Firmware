'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rig, poses, configuration, profile } = require('../../../tools/teleoperation/test/fake-arm');
const { GravityModel } = require('../GravityModel');

async function setup(gravity) {
  const config = configuration(); delete config.joints; config.profiles[2] = profile;
  const r = rig(poses([1000], [1, 2]), config, gravity);
  // Match firmware: enabling torque resets only this motor's command counters.
  const write = r.follower.protocol.write;
  r.follower.protocol.write = async (id, address, bytes, options) => {
    await write(id, address, bytes, options);
    if (address === 40 && bytes[0] === 1) Object.assign(r.motors.get(id), { sequence: 0, gravityReceived: false, gravitySequence: 0 });
  };
  await r.controller.preflight(); await r.controller.initialize();
  await r.controller.send(await r.controller.sample());
  return r;
}
test('profile replacement resets one axis while supports retain torque and command identity', async () => {
  const r = await setup(); const before = r.calls.length;
  await r.controller.changeProfile(1, { ...r.controller.profiles[1], kpQ8: 512 });
  assert.equal(r.controller.profiles[1].kpQ8, 512);
  assert.equal(r.motors.get(2).torque, 1);
  assert(!r.calls.slice(before).some(c => c.id === 2 && ['write', 'configure', 'select'].includes(c.type)));
  await r.controller.send(await r.controller.sample()); await r.controller.monitor();
  assert.equal(r.motors.get(1).sequence, 2); assert.equal(r.motors.get(2).sequence, 2);
});
test('invalid profile or moving support is rejected before output changes', async () => {
  const r = await setup(); const before = r.calls.length;
  await assert.rejects(r.controller.changeProfile(1, { ...r.controller.profiles[1], effortLimit: 0 }), /effortLimit/);
  const feedback = r.follower.arm.feedback;
  r.follower.arm.feedback = async id => ({ ...await feedback(id), running: id === 2 });
  await assert.rejects(r.controller.changeProfile(1, r.controller.profiles[1]), /stationary/);
  assert(!r.calls.slice(before).some(c => c.type === 'write'));
});
test('profile replacement waits through support movement before releasing torque', async () => {
  const r = await setup(), start = r.controller.clock();
  const feedback = r.follower.arm.feedback;
  let lastMovingAt;
  r.follower.arm.feedback = async id => {
    const value = await feedback(id);
    if (id === 2 && r.controller.clock() - start < 600) {
      lastMovingAt = r.controller.clock();
      value.running = true;
      value.measuredPositionQ8 += 4 * 256;
    }
    return value;
  };
  const write = r.follower.protocol.write;
  r.follower.protocol.write = async (id, address, bytes, options) => {
    if (address === 40 && bytes[0] === 0)
      assert(r.controller.clock() - lastMovingAt >= 200, 'release must follow a quiet interval');
    return write(id, address, bytes, options);
  };
  await r.controller.changeProfile(1, { ...r.controller.profiles[1], kpQ8: 512 });
  assert.equal(r.controller.profiles[1].kpQ8, 512);
  assert.equal(r.motors.get(2).torque, 1);
});
test('settling uses the complete position window despite quantized velocity spikes', async () => {
  const r = await setup(), feedback = r.follower.arm.feedback;
  let reads = 0;
  r.follower.arm.feedback = async id => {
    const value = await feedback(id);
    if (id === 2) {
      value.measuredPositionQ8 += (++reads % 2) * 256;
      value.measuredVelocityQ8PerS = 52 * 256;
    }
    return value;
  };
  await r.controller.changeProfile(1, r.controller.profiles[1]);
  assert(reads >= 2);
});
test('slow drift cannot pass settling by moving only one count per sample', async () => {
  const r = await setup(), feedback = r.follower.arm.feedback, before = r.calls.length;
  r.controller.monitorIntervalMs = 50;
  let position = 1000;
  r.follower.arm.feedback = async id => ({ ...await feedback(id),
    ...(id === 2 ? { measuredPositionQ8: ++position * 256 } : {}) });
  await assert.rejects(r.controller.changeProfile(1, r.controller.profiles[1]), /completion timeout/);
  assert(!r.calls.slice(before).some(c => c.type === 'write'));
});
test('cancelling a settling wait does not start a profile change', async () => {
  const r = await setup(), before = r.calls.length;
  const sleep = r.controller.sleep;
  r.controller.sleep = async ms => { await sleep(ms); r.controller.stopping = true; };
  await assert.rejects(r.controller.changeProfile(1, r.controller.profiles[1]), /cancelled/);
  assert(!r.calls.slice(before).some(c => c.type === 'write'));
});
test('profile failure through shared run removes output from all prepared axes', async () => {
  const r = await setup();
  r.follower.arm.configure = async () => { throw new Error('injected config failure'); };
  r.controller.initialize = async () => {};
  r.controller.source.play = c => c.changeProfile(1, c.profiles[1]);
  await assert.rejects(r.controller.run(), /injected config failure/);
  assert([...r.motors.values()].every(m => m.torque === 0));
});
test('support gravity remains serviced while a different motor changes profile', async () => {
  const gravity = new GravityModel({ format: 'sts-gravity', version: 1, units: 'pwm-effort', name: 'test',
    calibration: 'test', mounting: 'test', payload: 'empty', encoderCalibration: {},
    models: { 1: { maxEffort: 100, note: 'test', terms: [{ fn: 'constant', offsetRad: 0, weights: {}, coefficient: 5 }] },
      2: { maxEffort: 100, note: 'test', terms: [{ fn: 'constant', offsetRad: 0, weights: {}, coefficient: 10 }] } } });
  const r = await setup(gravity); const before = r.calls.length;
  const configure = r.follower.arm.configure;
  r.follower.arm.configure = async (...args) => { r.advance(40); return configure(...args); };
  await r.controller.changeProfile(1, r.controller.profiles[1]);
  assert(r.calls.slice(before).some(c => c.type === 'gravity' && c.id === 2));
  assert.equal(r.controller.gravitySent.get(1).effort, 5);
  assert.equal(r.motors.get(2).torque, 1);
});
