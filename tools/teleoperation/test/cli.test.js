'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parse, validatePorts, run } = require('../cli');
const { Teleoperation } = require('../Teleoperation');
const { ArmCodec } = require('../../../host/servo-driver');

function fixture() {
  const servos = [], events = [];
  const teleop = {
    session: 123, preflight: async () => ({}), sample: async () => ({ targets: [] }),
    fail(error) { this.failure = error; this.stopping = true; },
    run: async () => { events.push('run'); },
    disableTorque: async () => { events.push('disable'); return []; },
  };
  const config = { leaderPort: 'COM3', followerPort: 'COM4', protocol: 'extension' };
  const options = {
    output: () => {}, createTeleoperation: () => teleop,
    createServo: () => {
      const servo = new EventEmitter();
      servo.open = async () => { events.push('open'); };
      servo.close = async () => { events.push('close'); servo.emit('disconnect'); };
      servos.push(servo); return servo;
    },
    createLog: async () => ({ filename: 'test.ndjson',
      write: async event => { events.push(event.type); }, close: async () => { events.push('closeLog'); } }),
  };
  return { config, options, teleop, servos, events };
}

test('CLI defaults to preview and rejects unknown or duplicate flags', () => {
  assert.deepEqual(parse(['config.json']), { filename: 'config.json', move: false });
  assert.equal(parse(['config.json', '--run']).move, true);
  assert.equal(parse(['--help']).help, true);
  for (const args of [[], ['--run'], ['file', '--bad'], ['file', '--run', '--run']]) assert.throws(() => parse(args));
});

test('distinct Windows ports work and filesystem aliases are rejected', async t => {
  await validatePorts({ leaderPort: 'COM3', followerPort: 'COM4' });
  await assert.rejects(validatePorts({ leaderPort: 'COM3', followerPort: 'com3' }), /distinct/);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'teleop-ports-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const port = path.join(dir, 'port'), alias = path.join(dir, 'alias');
  await fs.writeFile(port, ''); await fs.symlink(port, alias);
  await assert.rejects(validatePorts({ leaderPort: port, followerPort: alias }), /distinct/);
});

test('preview records checks without entering control and removes port listeners', async () => {
  const r = fixture(); await run(r.config, r.options);
  assert.deepEqual(r.events, ['open', 'open', 'preflight', 'preview', 'close', 'close', 'closeLog']);
  assert.equal(r.teleop.failure, undefined);
  for (const servo of r.servos) {
    assert.equal(servo.listenerCount('fault'), 0); assert.equal(servo.listenerCount('disconnect'), 0);
  }
});

for (const event of ['fault', 'disconnect']) test(`${event} in preview is reported before motor control`, async () => {
  const r = fixture();
  r.teleop.preflight = async () => { r.servos[0].emit(event, new Error('cable lost')); return {}; };
  await assert.rejects(run(r.config, { ...r.options, move: true }), /Leader/);
  assert(!r.events.includes('run'));
  assert.equal(r.events.filter(x => x === 'close').length, 2);
});

test('final log failure after successful control attempts torque-off', async () => {
  const r = fixture(), createLog = r.options.createLog;
  r.options.createLog = async () => {
    const log = await createLog(), write = log.write;
    log.write = async event => { if (event.type === 'stopped') throw new Error('disk full'); await write(event); };
    return log;
  };
  await assert.rejects(run(r.config, { ...r.options, move: true }), /disk full/);
  assert(r.events.includes('run')); assert(r.events.includes('disable')); assert(r.events.includes('closeLog'));
});

test('run failure retains original error when error logging and port cleanup also fail', async () => {
  const r = fixture();
  r.teleop.run = async () => { throw new Error('motion failure'); };
  r.options.createLog = async () => ({ filename: 'test', write: async event => {
    if (event.type === 'error') throw new Error('log failure');
  }, close: async () => { throw new Error('close failure'); } });
  await assert.rejects(run(r.config, { ...r.options, move: true }), error => {
    assert.match(error.message, /motion failure.*log failure.*close failure/);
    assert.equal(error.errors.length, 3); return true;
  });
  assert.equal(r.events.filter(x => x === 'close').length, 2);
});

test('already cancelled run opens no ports and still reports cleanup errors', async () => {
  const r = fixture(), abort = new AbortController(), createServo = r.options.createServo;
  abort.abort();
  r.options.createServo = (...args) => {
    const servo = createServo(...args); servo.close = async () => { throw new Error('close failed'); }; return servo;
  };
  await assert.rejects(run(r.config, { ...r.options, signal: abort.signal }), /close failed/);
  assert(!r.events.includes('open')); assert(!r.events.includes('run'));
});

test('published example configurations satisfy control and profile validation', async () => {
  for (const name of ['legacy', 'extension']) {
    const config = JSON.parse(await fs.readFile(path.join(__dirname, '..', 'examples', `${name}.json`), 'utf8'));
    await validatePorts(config);
    new Teleoperation({ leader: {}, follower: {}, config });
    if (name === 'extension') for (const profile of Object.values(config.profiles)) {
      ArmCodec.encodeConfig({ ...profile, accelerationLimit: config.acceleration, rampTimeMs: config.rampTimeMs });
    }
  }
});
