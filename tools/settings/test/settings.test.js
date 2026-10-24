'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { BAUD_RATES, ControlTable } = require('../../../host/servo-driver');
const { FORMAT, FORMAT_VERSION, parseArguments, readSettingsDocument,
  restoreSettingsDocument, settingKeys, validateSettingsDocument, run } = require('../cli');

function defaultSettings(overrides = {}) {
  return Object.fromEntries(settingKeys().map(key => [key, overrides[key] ?? ControlTable[key].default]));
}
const identity = { firmwareMajor: 3, firmwareMinor: 10, modelMinor: 0, modelMajor: 9 };
const documentWith = (settings = defaultSettings()) => ({ format: FORMAT, version: FORMAT_VERSION, device: identity, settings });

function fakeServo(overrides = {}) {
  const state = { ...identity, ...defaultSettings({ id: 2 }), lock: 1, torqueEnable: 0, servoStatus: 0, ...overrides };
  const writes = [], baudUpdates = [];
  const servo = {
    state, writes, baudUpdates, closed: false, ids: [state.id],
    connect: async () => ({ ids: [...servo.ids], alarms: new Map() }),
    close: async () => { servo.closed = true; },
    protocol: {
      ping: async () => {},
      write: async (id, address, data, options) => {
        assert.equal(id, state.id);
        const key = Object.keys(ControlTable).find(key => ControlTable[key].address === address);
        writes.push({ id, key, value: data[0], expectResponse: options.expectResponse });
        state[key] = data[0];
        if (servo.failWrite === key) throw new Error(`ambiguous ${key} write`);
      },
      setBaudRate: baud => baudUpdates.push(['protocol', baud]),
    },
    transport: { updateBaudRate: async baud => baudUpdates.push(['transport', baud]) },
    bus: {
      has: id => servo.ids.includes(id),
      rebindId: (before, after) => { servo.ids = servo.ids.map(id => id === before ? after : id); },
      read: async (id, keys) => {
        assert.equal(id, state.id);
        return Object.fromEntries(keys.map(key => [key, state[key]]));
      },
    },
    settings: {
      read: async (_id, keys) => Object.fromEntries(keys.map(key => [key, state[key]])),
      save: async (_id, values) => {
        servo.savedOrdinary = values;
        Object.assign(state, values);
        return { verified: true };
      },
    },
  };
  return servo;
}

test('parse discovery, backup and restore with supported baud rates and explicit IDs', () => {
  const backup = parseArguments(['backup', '--port', '/dev/fake', '--id', '7', '--baud', '500000']);
  assert.equal(backup.id, 7);
  assert.equal(backup.baudRate, 500000);
  assert.match(backup.file, /^tools\/settings\/backups\/servo-7-/);
  assert.equal(parseArguments(['discover', '--port', '/dev/fake']).id, undefined);
  assert.equal(parseArguments(['restore', '--port', '/dev/fake', '--id', '3', '--file', 'backup.json']).file, 'backup.json');
  assert.deepEqual(parseArguments(['--help']), { help: true });
  for (const args of [[], ['backup', '--port', '/dev/fake'], ['backup', '--port', '--id', '2'],
    ['backup', '--port', '/dev/fake', '--id', '254'], ['discover', '--port', '/dev/fake', '--baud', '12345'],
    ['discover', '--port', '/dev/fake', '--id', '2'], ['restore', '--port', '/dev/fake', '--id', '2']])
    assert.throws(() => parseArguments(args));
});

test('validate every setting and its encoding before any restore writes', () => {
  assert(validateSettingsDocument(documentWith()));
  const missing = documentWith(); delete missing.settings.positionPGain;
  assert.throws(() => validateSettingsDocument(missing), /positionPGain/);
  assert.throws(() => validateSettingsDocument(documentWith({ ...defaultSettings(), mystery: 0 })), /unknown/);
  assert.throws(() => validateSettingsDocument(documentWith(defaultSettings({ reserved7: 256 }))));
  const noModel = documentWith(); delete noModel.device;
  assert.throws(() => validateSettingsDocument(noModel), /modelMajor/);
});

test('backup records device identity and every persistent setting without writes', async () => {
  const servo = fakeServo();
  const doc = await readSettingsDocument(servo, 2, { port: '/dev/fake', baudRate: 1000000 });
  assert.deepEqual(doc.device, identity);
  assert.deepEqual(doc.settings, defaultSettings({ id: 2 }));
  assert.deepEqual(servo.writes, []);
});

test('restore follows changed response level, ID and baud, verifies reads and relocks', async () => {
  const servo = fakeServo();
  const desired = defaultSettings({ id: 9, baudRate: 1, responseStatusLevel: 0 });
  const result = await restoreSettingsDocument(servo, 2, documentWith(desired), async () => {});
  assert.equal(servo.savedOrdinary.id, undefined);
  assert.equal(servo.savedOrdinary.baudRate, undefined);
  assert.equal(servo.savedOrdinary.responseStatusLevel, undefined);
  assert.deepEqual(servo.writes.map(w => [w.id, w.key, w.value, w.expectResponse]), [
    [2, 'lock', 0, false], [2, 'responseStatusLevel', 0, false], [2, 'id', 9, false],
    [9, 'baudRate', 1, false], [9, 'lock', 1, false],
  ]);
  assert.deepEqual(servo.baudUpdates, [['transport', BAUD_RATES[1]], ['protocol', BAUD_RATES[1]]]);
  assert.equal(result.id, 9); assert.equal(result.verified, true);
});

test('restore refuses unsafe state, incompatible model and known ID collision before mutation', async () => {
  for (const overrides of [{ torqueEnable: 1 }, { lock: 0 }, { servoStatus: 2 }, { modelMajor: 8 }, { reserved4: 7 }]) {
    const servo = fakeServo(overrides);
    await assert.rejects(restoreSettingsDocument(servo, 2, documentWith()));
    assert.equal(servo.savedOrdinary, undefined);
    assert.deepEqual(servo.writes, []);
  }
  const servo = fakeServo(); servo.ids.push(1);
  await assert.rejects(restoreSettingsDocument(servo, 2, documentWith()), /already present/);
  assert.equal(servo.savedOrdinary, undefined);
});

test('ambiguous ID change still attempts to relock the new address', async () => {
  const servo = fakeServo(); servo.failWrite = 'id';
  await assert.rejects(restoreSettingsDocument(servo, 2, documentWith(), async () => {}), /ambiguous id/);
  assert.equal(servo.state.lock, 1);
  assert.equal(servo.writes.at(-1).id, 1);
});

test('readback mismatch is reported instead of a successful restore', async () => {
  const servo = fakeServo();
  servo.settings.read = async () => defaultSettings({ id: 2, positionPGain: 99 });
  await assert.rejects(restoreSettingsDocument(servo, 2, documentWith(defaultSettings({ id: 2 }))),
    error => error.mismatches.positionPGain.actual === 99);
});

test('discovery returns plain JSON with alarms and closes the connection', async () => {
  const servo = fakeServo();
  servo.connect = async () => ({ ids: [7, 2], alarms: new Map([[7, ['overload']]]) });
  const result = await run(parseArguments(['discover', '--port', '/dev/fake']), { createServo: () => servo });
  assert.deepEqual(result.devices, [{ id: 2, alarms: [] }, { id: 7, alarms: ['overload'] }]);
  assert.equal(servo.closed, true);
  assert.deepEqual(servo.writes, []);
});

test('failed connection still closes the port', async () => {
  const servo = fakeServo(); servo.connect = async () => { throw new Error('connection lost'); };
  await assert.rejects(run(parseArguments(['discover', '--port', '/dev/fake']), { createServo: () => servo }), /connection lost/);
  assert.equal(servo.closed, true);
});

test('backup refuses overwrite and malformed restore files fail before connecting', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-cli-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'backup.json');
  const options = parseArguments(['backup', '--port', '/dev/fake', '--id', '2', '--file', file]);
  const servo = fakeServo();
  await run(options, { createServo: () => servo });
  const content = await fs.readFile(file, 'utf8');
  await assert.rejects(run(options, { createServo: () => servo }), /EEXIST/);
  assert.equal(await fs.readFile(file, 'utf8'), content);
  assert.equal(servo.closed, true);
  await fs.writeFile(file, '{}');
  await assert.rejects(run({ ...options, command: 'restore' }, { createServo: () => { assert.fail('must not connect'); } }), /Unsupported settings/);
});
