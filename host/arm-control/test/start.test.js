'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ArmController } = require('../ArmController');
const { rig, poses, configuration, profile } = require('../../../tools/teleoperation/test/fake-arm');
const { ApplySettings } = require('../../../tools/tuning/ApplySettings');

async function powered() {
  const config = configuration();
  config.joints.push({ leaderId: 2, followerId: 2, mapping: 'angle' });
  config.profiles[2] = structuredClone(profile);
  const r = rig(poses([1500], [1, 2]), config);
  await r.controller.preflight(); await r.controller.run();
  return r;
}
async function next(r, config = r.config, source = r.replay) {
  const c = new ArmController({ follower: r.follower, config, source,
    clock: r.controller.clock, sleep: r.controller.sleep });
  await c.preflight(); return c;
}
const releases = calls => calls.filter(c => c.type === 'write' && c.address === 40 && c.value === 0);

test('repeating replay automatically retains the powered session without rewriting settings', async () => {
  const r = await powered(), before = r.calls.length, c = await next(r);
  await c.run();
  assert.equal(c.session, r.controller.session);
  assert(!r.calls.slice(before).some(c => ['write', 'configure', 'select', 'enable-group'].includes(c.type)));
  assert([...r.motors.values()].every(m => m.torque === 1));
});

test('replay applies only changed profiles while supporting motors remain powered', async () => {
  const r = await powered(), config = structuredClone(r.config);
  config.profiles[1].kpQ8 = 512;
  const c = await next(r, config), before = r.calls.length;
  await c.run();
  assert.equal(r.motors.get(1).config.kpQ8, 512);
  assert.deepEqual(releases(r.calls.slice(before)).map(c => c.id), [1]);
  assert([...r.motors.values()].every(m => m.torque === 1 && m.position === 1500));
});

test('omitting gravity clears retained effort without cycling torque', async () => {
  const r = await powered();
  Object.assign(r.motors.get(2), { gravityReceived: true, gravitySequence: 65535, gravityEffort: -40 });
  const c = await next(r), before = r.calls.length;
  await c.run();
  assert.equal(r.motors.get(2).gravityEffort, 0);
  assert.equal(releases(r.calls.slice(before)).length, 0);
  assert(r.calls.slice(before).some(c => c.type === 'gravity' && c.id === 2 && c.sequence === 0 && c.effort === 0));
});

test('replay waits for an existing move before continuing without releasing motors', async () => {
  const r = await powered(), started = r.controller.clock(), read = r.follower.arm.feedback;
  r.follower.arm.feedback = async id => ({ ...await read(id), running: r.controller.clock() - started < 100 });
  const c = await next(r), before = r.calls.length;
  await c.run();
  assert(r.calls.slice(before).filter(c => c.type === 'target').every(c => c.at - started >= 300));
  assert.equal(releases(r.calls.slice(before)).length, 0);
});

for (const mode of ['legacy', 'mixed']) test(`replay sets up ${mode} motor state automatically`, async () => {
  const r = await powered();
  if (mode === 'legacy') for (const m of r.motors.values()) Object.assign(m, { selected: false, session: 0 });
  else r.motors.get(2).torque = 0;
  const c = await next(r);
  await c.run();
  assert([...r.motors.values()].every(m => m.torque === 1 && m.session === c.session));
});

test('settings apply also starts an unpowered motor and retains its current position', async () => {
  const r = rig(), source = new ApplySettings(r.config), c = await next(r, r.config, source);
  await c.run();
  assert.equal(r.motors.get(1).torque, 1);
  assert.equal(r.motors.get(1).position, 1000);
  assert.equal(r.motors.get(1).config.kpQ8, profile.kpQ8);
});

test('failed gravity removal stops before replay targets and cleans up all owned motors', async () => {
  const r = await powered();
  Object.assign(r.motors.get(2), { gravityReceived: true, gravitySequence: 1, gravityEffort: 40 });
  const send = r.follower.protocol.armCommand;
  r.follower.protocol.armCommand = async (id, instruction, data) => {
    await send(id, instruction, data);
    r.motors.get(2).gravityEffort = 40;
  };
  const c = await next(r), before = r.calls.length;
  await assert.rejects(c.run(), /Gravity removal timeout/);
  assert(!r.calls.slice(before).some(c => c.type === 'target'));
  assert([...r.motors.values()].every(m => m.torque === 0));
});

test('automatic continuation handles wrapping and unequal command counters', async () => {
  const r = await powered();
  r.motors.get(1).sequence = 65535;
  r.motors.get(2).sequence = 65534;
  const c = await next(r);
  await c.run();
  assert.equal(c.sequence, 0);
  assert([...r.motors.values()].every(m => m.sequence === 0 && m.torque === 1));
});

test('another controller changing the session during startup leaves its hold untouched', async () => {
  const r = await powered(), c = await next(r), read = r.follower.arm.tuning;
  let reads = 0;
  r.follower.arm.tuning = async id => {
    const sample = await read(id);
    if (++reads > 2) sample.acceptedSequence++;
    return sample;
  };
  const before = r.calls.length;
  await assert.rejects(c.run(), /session changed during startup/);
  assert(!r.calls.slice(before).some(c => ['write', 'configure', 'select', 'target'].includes(c.type)));
  assert([...r.motors.values()].every(m => m.torque === 1));
});

test('compact-feedback sources use detailed startup then return to their normal reader', async () => {
  const r = await powered();
  r.replay.detailedAll = false;
  Object.assign(r.motors.get(2), { gravityReceived: true, gravitySequence: 1, gravityEffort: 40 });
  const config = structuredClone(r.config); config.profiles[1].kpQ8 = 512;
  const c = await next(r, config);
  await c.run();
  assert.equal(r.replay.detailedAll, false);
  assert.equal(r.motors.get(2).gravityEffort, 0);
  assert.equal(r.motors.get(1).config.kpQ8, 512);
});
