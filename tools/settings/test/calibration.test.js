'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ControlTable } = require('../../../host/servo-driver');
const { parseArguments, run, settingKeys, validateSettingsDocument } = require('../cli');
const { RangeCapture, checkConfiguration, validateExpectedRanges, rangeWarning } = require('../calibration');

const IDS = [1, 2, 3, 4, 5, 6];

const wrap = value => ((value % 4096) + 4096) % 4096;
const positions = value => Object.fromEntries(IDS.map(id => [id, value]));

async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sts-calibration-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'arm.json');
  const motorIds = overrides.motorIds ?? IDS, selectedIds = overrides.selectedIds ?? motorIds;
  const states = Object.fromEntries(motorIds.map(id => [id, {
    ...Object.fromEntries(settingKeys().map(key => [key, ControlTable[key].default])),
    id, reserved4: 3, modelMajor: 9, modelMinor: 0, firmwareMajor: 3, firmwareMinor: 10,
    lock: 1, torqueEnable: 0, servoStatus: 0, configurationFlags: 12,
    operationMode: 0, positionScalingDivisor: 1, positionCorrection: 500,
    ...overrides.state,
  }]));
  const initial = structuredClone(states), saves = [], writes = [];
  const offsets = overrides.offsets ?? [0, 100, 200, 300, 400, 400, 400, 300, 200, 100, 0, -100, -200, -200, -200, -100, 0, 100, 100, 100];
  let phase = 'initial', frame = 0, endSweep, prompts = 0, clock = 0;
  const messages = [];
  const servo = {
    closed: false,
    connect: async () => ({ ids: overrides.ids ?? motorIds, alarms: new Map() }),
    close: async () => { servo.closed = true; },
    protocol: { ping: async () => {} },
    bus: {
      has: id => motorIds.includes(id),
      write: async (id, values) => { writes.push({ id, values }); Object.assign(states[id], values); },
      syncWrite: async entries => { writes.push(...entries); for (const { id, values } of entries) Object.assign(states[id], values); },
      read: async (id, keys) => {
        const offset = phase === 'sweep' ? offsets[frame] : phase === 'finished' ? 100 : 0;
        const state = { ...states[id], presentPosition: wrap(id * 200 + offset - states[id].positionCorrection) };
        if (overrides.position && keys.includes('presentPosition'))
          state.presentPosition = overrides.position({ id, position: state.presentPosition, phase, saves: saves.length });
        if (phase === 'sweep' && keys.includes('presentPosition') && id === selectedIds.at(-1)) {
          if (++frame === offsets.length) {
            phase = 'finished';
            if (overrides.changeSettings) states[1].positionPGain++;
            endSweep(overrides.sweepAnswer ?? '');
          }
        }
        return Object.fromEntries(keys.map(key => [key, state[key]]));
      },
    },
    settings: {
      read: async id => Object.fromEntries(settingKeys().map(key => [key, states[id][key]])),
      save: async (id, values) => {
        const record = JSON.parse(await fs.readFile(file, 'utf8'));
        assert.equal(record.attemptedId, id);
        const backup = JSON.parse(await fs.readFile(path.join(record.backupDirectory, `servo-${id}.json`), 'utf8'));
        validateSettingsDocument(backup);
        assert.equal(backup.settings.positionCorrection, initial[id].positionCorrection);
        saves.push({ id, stage: record.stage, values });
        Object.assign(states[id], values);
        if (overrides.failId === id && record.stage === (overrides.failStage ?? 'offsets')) throw new Error('ambiguous persistence failure');
        if (overrides.abortId === id) overrides.controller.abort(new Error('interrupted'));
        if (overrides.corruptId === id) states[id].positionPGain++;
      },
    },
  };
  const dependencies = {
    createServo: () => servo,
    output: text => messages.push(text), signal: overrides.controller?.signal,
    now: () => clock,
    sleep: async ms => { clock += overrides.gap ? 600 : 20; await overrides.onSleep?.(ms); },
    question: async (text, signal) => {
      prompts++;
      if (overrides.cancelAt === prompts) return 'cancel';
      if (text.startsWith('Press Enter to save limits')) {
        phase = 'sweep';
        return new Promise((resolve, reject) => {
          endSweep = resolve;
          signal.addEventListener('abort', () => reject(new Error('prompt cancelled')), { once: true });
        });
      }
      return '';
    },
  };
  return { file, states, initial, saves, writes, servo, dependencies, messages, prompts: () => prompts,
    execute: () => run(parseArguments(['calibrate', '--port', '/dev/fake', '--file', file, ...(overrides.selectedIds ? ['--ids', overrides.selectedIds.join(',')] : [])]), dependencies),
    report: async () => JSON.parse(await fs.readFile(file, 'utf8')) };
}

test('existing calibration output is replaced while previous motor backups remain intact', async t => {
  const f = await fixture(t);
  const oldBackups = path.join(path.dirname(f.file), 'backups', 'previous-run');
  await fs.mkdir(oldBackups, { recursive: true });
  const oldBackup = path.join(oldBackups, 'servo-1.json');
  await fs.writeFile(oldBackup, 'previous settings');
  await fs.writeFile(f.file, JSON.stringify({ status: 'verified', backupDirectory: oldBackups, oldField: true }));
  await f.execute();
  const report = await f.report();
  assert.equal(report.status, 'verified');
  assert.equal(report.oldField, undefined);
  assert.notEqual(report.backupDirectory, oldBackups);
  assert.equal(await fs.readFile(oldBackup, 'utf8'), 'previous settings');
  assert.equal((await fs.readdir(path.dirname(f.file))).some(name => name.endsWith('.tmp')), false);
});

test('unwritable output target fails before connecting and removes temporary file', async t => {
  const f = await fixture(t);
  await fs.mkdir(f.file);
  f.dependencies.createServo = () => assert.fail('must not connect');
  await assert.rejects(f.execute());
  assert.equal((await fs.readdir(path.dirname(f.file))).some(name => name.endsWith('.tmp')), false);
});

test('expected travel warnings are saved while valid measured ranges remain authoritative', async t => {
  const f = await fixture(t);
  const expectedFile = path.join(path.dirname(f.file), 'expected.json');
  await fs.writeFile(expectedFile, JSON.stringify({ 1: { counts: 1000, tolerance: 50 } }));
  await run(parseArguments(['calibrate', '--port', '/dev/fake', '--file', f.file, '--expected-ranges', expectedFile]), f.dependencies);
  const report = await f.report();
  assert.equal(report.status, 'verified');
  assert.equal(report.joints[1].spanCounts, 600);
  assert.equal(report.joints[1].settings.maxAngleLimit - report.joints[1].settings.minAngleLimit, 580);
  assert.match(report.joints[1].warning, /outside expected 1000/);
  assert.equal(report.joints[2].warning, null);
  assert(f.messages.some(text => text.includes('WARNING M1')));
});

test('bad expected range files fail before opening the serial port or reserving output', async t => {
  const f = await fixture(t);
  const expectedFile = path.join(path.dirname(f.file), 'expected.json');
  await fs.writeFile(expectedFile, JSON.stringify({ 1: { counts: 1000 } }));
  await assert.rejects(run(parseArguments(['calibrate', '--port', '/dev/fake', '--file', f.file,
    '--expected-ranges', expectedFile]), { ...f.dependencies, createServo: () => assert.fail('must not connect') }), /Invalid expected range/);
  await assert.rejects(fs.stat(f.file), { code: 'ENOENT' });
});


test('one calibration command replaces the separate reference workflow', () => {
  const options = parseArguments(['calibrate', '--port', '/dev/test']);
  assert.equal(options.id, undefined);
  assert.match(options.file, /calibrations\/calibration-/);
  assert.throws(() => parseArguments(['calibrate', '--port', '/dev/test', '--id', '2']), /Use --ids/);
  assert.throws(() => parseArguments(['reference', '--port', '/dev/test', '--file', 'arm.json']), /Usage/);
});

test('measured limits stay in the reference frame without recentering asymmetric travel', () => {
  const capture = new RangeCapture(positions(2048));
  for (const offset of [0, 100, 200, 300, 400, 400, 400, 200, 0, -200, -200, -200])
    capture.add(positions(2048 + offset));
  const plan = capture.plan();
  assert.deepEqual(plan[1].measuredRange, { min: 1848, max: 2448 });
  assert.equal(plan[1].middleCount, 2148);
  assert.deepEqual(plan[1].settings, { minAngleLimit: 1858, maxAngleLimit: 2438 });
  assert.equal(plan[1].spanCounts, 600);
});

test('wraparound is tracked for diagnosis but cannot become reversed or clipped limits', () => {
  for (const direction of [-1, 1]) {
    const capture = new RangeCapture(positions(2048));
    for (let offset = 0; offset <= 2200; offset += 100) capture.add(positions(wrap(2048 + direction * offset)));
    capture.add(positions(wrap(2048 + direction * 2200)));
    assert.throws(() => capture.plan(), /crosses the encoder boundary/);
  }
});

test('near-full wrist travel fits when the reference is placed correctly', () => {
  const capture = new RangeCapture(positions(2048));
  for (let value = 2048; value > 139; value -= 100) capture.add(positions(value));
  capture.add(positions(139)); capture.add(positions(139));
  for (let value = 139; value < 3957; value += 100) capture.add(positions(value));
  capture.add(positions(3957)); capture.add(positions(3957));
  const wrist = capture.plan()[5];
  assert.equal(wrist.spanCounts, 3818);
  assert.deepEqual(wrist.settings, { minAngleLimit: 149, maxAngleLimit: 3947 });
});

test('a wrapped sweep records the offending range without writing limits', async t => {
  const f = await fixture(t, { cancelAt: 3, offsets: [...Array.from({ length: 23 }, (_, i) => i * 100), 2200, 2200] });
  await assert.rejects(f.execute(), /cancelled/);
  assert(f.messages.some(message => message.includes('crosses zero')));
  assert(f.messages.some(message => message.includes('recording continues')));
  const r = await f.report();
  assert.equal(r.status, 'failed');
  assert.deepEqual(r.measuredRanges[5], { min: 2048, max: 4248 });
  assert.deepEqual(r.appliedIds, { offsets: IDS, limits: [] });
  assert.equal(f.saves.length, 6);
});

test('invalid samples, stationary wrist and excessive travel cannot set limits', () => {
  for (const value of [NaN, undefined, 40000]) {
    const capture = new RangeCapture(positions(2048));
    capture.add(positions(value));
    assert.equal(capture.ranges[5].error, 'invalid reading');
    assert.equal(capture.ranges[5].current, 2048);
  }
  const still = new RangeCapture(positions(2048));
  for (let i = 0; i < 12; i++) still.add({ ...positions(2048 + i * 10), 5: 2048 });
  assert.throws(() => still.plan(), /Motor 5: travel/);
  const wide = new RangeCapture(positions(0));
  for (let i = 1; i <= 43; i++) wide.add(positions(i * 100));
  assert.throws(() => wide.plan(), /travel must/);
});

test('single sensor outliers do not widen the recorded range', () => {
  const capture = new RangeCapture(positions(2048));
  for (const offset of [0, 100, 0, 0, 0, -100, 0, 0, 0, 0]) capture.add(positions(2048 + offset));
  assert.equal(capture.ranges[1].min, 2048);
  assert.equal(capture.ranges[1].max, 2048);
});

test('expected travel remains an optional warning with validated inputs', () => {
  assert.deepEqual(validateExpectedRanges({ 1: { counts: 600, tolerance: 20 } }), { 1: { counts: 600, tolerance: 20 } });
  for (const input of [null, [], {}, { 254: { counts: 600, tolerance: 20 } },
    { 1: { counts: 10, tolerance: 20 } }, { 1: { counts: 600, tolerance: -1 } }])
    assert.throws(() => validateExpectedRanges(input));
  assert.equal(rangeWarning(620, { counts: 600, tolerance: 20 }), null);
  assert.match(rangeWarning(621, { counts: 600, tolerance: 20 }), /outside expected/);
});

test('preflight requires supported motors, position mode, locked settings and no alarms', () => {
  const base = { modelMajor: 9, reserved4: 3, operationMode: 0, positionScalingDivisor: 1,
    configurationFlags: 12, lock: 1, servoStatus: 0 };
  checkConfiguration(1, base);
  for (const variant of [3, 8, 11]) checkConfiguration(1, { ...base, reserved4: variant });
  for (const change of [{ modelMajor: 8 }, { operationMode: 1 }, { positionScalingDivisor: 2 }, { lock: 0 }, { servoStatus: 2 }])
    assert.throws(() => checkConfiguration(1, { ...base, ...change }));
});

test('two prompts save offsets before recording ranges, then save only limits', async t => {
  const f = await fixture(t, { state: { configurationFlags: 140 } });
  const result = await f.execute();
  const r = await f.report();
  assert.equal(result.verified, true);
  assert.equal(r.status, 'verified');
  assert.equal(r.stage, 'complete');
  assert.equal(f.prompts(), 2);
  assert.deepEqual(r.appliedIds, { offsets: IDS, limits: IDS });
  assert.deepEqual(r.referenceReadbackCounts, positions(2048));
  assert.deepEqual(f.saves.map(s => s.stage), [...IDS.map(() => 'offsets'), ...IDS.map(() => 'limits')]);
  for (const id of IDS) {
    assert.deepEqual(Object.keys(f.saves[id - 1].values), ['positionCorrection']);
    assert.deepEqual(Object.keys(f.saves[6 + id - 1].values).sort(), ['maxAngleLimit', 'minAngleLimit']);
    assert.equal(wrap(r.referenceInputCounts[id] + f.initial[id].positionCorrection - f.states[id].positionCorrection), 2048);
    assert.deepEqual(r.joints[id].measuredRange, { min: 1848, max: 2448 });
    assert.equal(r.joints[id].encoderCalibration.reverse, true);
    assert.equal(r.joints[id].referenceCount, 2048);
    for (const key of settingKeys()) if (!['positionCorrection', 'minAngleLimit', 'maxAngleLimit'].includes(key))
      assert.equal(f.states[id][key], f.initial[id][key]);
  }
  assert(f.writes.every(entry => entry.values.torqueEnable === 0));
  assert(f.servo.closed);
});

test('cancelling before offsets writes nothing; cancelling the sweep retains saved offsets only', async t => {
  for (const cancelAt of [1, 2]) {
    const f = await fixture(t, { cancelAt });
    await assert.rejects(f.execute(), /cancelled/);
    const r = await f.report();
    assert.equal(f.saves.length, cancelAt === 1 ? 0 : 6);
    assert.deepEqual(r.appliedIds.limits, []);
    assert(f.saves.every(s => s.stage === 'offsets'));
    assert(f.servo.closed);
  }
  const powered = await fixture(t, { cancelAt: 1, state: { torqueEnable: 1 } });
  await assert.rejects(powered.execute(), /before torque release/);
  assert.deepEqual(powered.writes, []);
  assert.deepEqual(powered.saves, []);
});

test('wrong IDs stay open until discovery succeeds', async t => {
  const overrides = { ids: [1, 2], selectedIds: IDS };
  const f = await fixture(t, overrides);
  overrides.onSleep = () => { overrides.ids = IDS; };
  await f.execute();
  assert(f.messages.some(text => text.includes('Adapter  ERROR:')));
  assert.equal((await f.report()).status, 'verified');
});

test('lost acknowledgements in either stage preserve completed motors and finish by readback', async t => {
  for (const failStage of ['offsets', 'limits']) {
    const f = await fixture(t, { failId: 2, failStage });
    await f.execute();
    const r = await f.report();
    assert.equal(r.status, 'verified');
    assert.deepEqual([...r.appliedIds[failStage]].sort(), IDS);
    assert.equal(f.saves.filter(s => s.stage === failStage && s.id === 2).length, 1);
    assert(f.messages.some(text => text.includes('M2  ERROR: ambiguous persistence failure')));
    assert.equal(f.prompts(), 2);
  }
});

test('cancellation remains available during persistent settings errors', async t => {
  const controller = new AbortController();
  let retries = 0;
  const f = await fixture(t, { controller, corruptId: 3,
    onSleep: ms => { if (ms === 500 && ++retries === 5) controller.abort(new Error('user cancelled')); } });
  await assert.rejects(f.execute(), /user cancelled/);
  assert.equal(retries, 5);
  assert.equal((await f.report()).status, 'failed');
  assert.equal(f.saves.filter(s => s.id === 3).length, 1);
  assert(f.messages.some(text => text.includes('M3  ERROR:')));
});

test('unexpected settings changes pause only until corrected, without repeating the sweep', async t => {
  const overrides = { changeSettings: true };
  const f = await fixture(t, overrides);
  overrides.onSleep = ms => { if (ms === 500) f.states[1].positionPGain = f.initial[1].positionPGain; };
  await f.execute();
  assert.equal(f.prompts(), 2);
  assert.equal((await f.report()).status, 'verified');
  assert(f.messages.some(text => text.includes('M1  ERROR: unrelated settings changed')));
});

test('hand jitter and slight movement while saving do not interrupt reference calibration', async t => {
  let sample = 0;
  const jitter = [-12, 8, -4, 0, 5, -8, 12, 0];
  const f = await fixture(t, { position: ({ id, position, phase, saves }) => {
    if (id !== 3 || phase !== 'initial') return position;
    return wrap(position + jitter[sample++ % jitter.length] + (saves === 6 ? 32 : 0));
  } });
  await f.execute();
  const r = await f.report();
  assert.equal(r.status, 'verified');
  assert.equal(f.prompts(), 2);
  assert.equal(r.referenceReadbackCounts[3], 2080);
  assert.equal(wrap(r.referenceInputCounts[3] + f.initial[3].positionCorrection - f.states[3].positionCorrection), 2048);
});

test('a motor ignoring offset writes stays in error until the user cancels', async t => {
  const controller = new AbortController();
  let retries = 0;
  const f = await fixture(t, { controller,
    onSleep: ms => { if (ms === 500 && ++retries === 3) controller.abort(new Error('user cancelled')); } });
  const save = f.servo.settings.save;
  f.servo.settings.save = async (id, values) => {
    await save(id, values);
    if (id === 3 && Object.hasOwn(values, 'positionCorrection'))
      f.states[id].positionCorrection = f.initial[id].positionCorrection;
  };
  await assert.rejects(f.execute(), /user cancelled/);
  assert(f.messages.some(text => text.includes('M3  ERROR: settings readback mismatch')));
  assert.deepEqual((await f.report()).appliedIds.limits, []);
  assert.equal(f.saves.filter(s => s.id === 1).length, 1);
});

test('reference read errors stay beside the motor and recover without another prompt', async t => {
  const f = await fixture(t);
  const read = f.servo.bus.read;
  let failed = 0;
  f.servo.bus.read = async (id, keys) => {
    if (id === 3 && keys.includes('presentPosition') && failed++ < 3) throw new Error('sensor unavailable');
    return read(id, keys);
  };
  await f.execute();
  assert.equal(f.prompts(), 2);
  assert.equal(f.messages.filter(message => message.includes('M3  ERROR: sensor unavailable')).length, 1);
  assert(f.messages.includes('M3  ready'));
  assert.equal((await f.report()).status, 'verified');
});

test('motor protection pauses that motor without writing until its alarm clears', async t => {
  let cleared = false;
  const overrides = { onSleep: ms => { if (ms === 500) cleared = true; } };
  const f = await fixture(t, overrides);
  const read = f.servo.bus.read, save = f.servo.settings.save;
  f.servo.bus.read = async (id, keys) => {
    const state = await read(id, keys);
    if (id === 3 && f.saves.length >= 2 && !cleared && keys.includes('servoStatus')) state.servoStatus = 1;
    return state;
  };
  f.servo.settings.save = async (id, values) => {
    if (id === 3) assert.equal(cleared, true);
    return save(id, values);
  };
  await f.execute();
  assert(f.messages.some(message => message.includes('M3  ERROR: protection status 1')));
  assert.equal((await f.report()).status, 'verified');
});

test('a disconnected adapter is reopened without losing calibration progress', async t => {
  const f = await fixture(t);
  const read = f.servo.bus.read;
  let disconnect = true, reopened = 0;
  f.servo.isConnected = true;
  f.servo.connect = async () => { f.servo.isConnected = true; reopened++; return { ids: IDS }; };
  f.servo.bus.read = async (id, keys) => {
    if (disconnect && keys.includes('presentPosition')) {
      disconnect = false;
      f.servo.isConnected = false;
      throw new Error('adapter disconnected');
    }
    return read(id, keys);
  };
  await f.execute();
  assert.equal(reopened, 2);
  assert.equal(f.prompts(), 2);
  assert.equal((await f.report()).status, 'verified');
});

test('cancellation during final connection cleanup preserves writes without reporting success', async t => {
  const controller = new AbortController();
  const f = await fixture(t, { controller,
    onSleep: ms => { if (ms === 500) controller.abort(new Error('user cancelled')); } });
  const close = f.servo.close;
  let attempts = 0;
  f.servo.close = async () => {
    if (++attempts === 1) throw new Error('close unavailable');
    return close();
  };
  await assert.rejects(f.execute(), /user cancelled/);
  const report = await f.report();
  assert.equal(report.status, 'failed');
  assert.equal(report.stage, 'limits');
  assert.deepEqual(report.appliedIds, { offsets: IDS, limits: IDS });
  assert(f.servo.closed);
});

test('calibration accepts an explicit selection of unique motor IDs', () => {
  assert.deepEqual(parseArguments(['calibrate', '--port', 'PORT', '--ids', '7,42']).ids, [7, 42]);
  for (const ids of ['0', '254', '2,2', '1,', '1,2,3,4,5,6,7'])
    assert.throws(() => parseArguments(['calibrate', '--port', 'PORT', '--ids', ids]));
  assert.throws(() => parseArguments(['discover', '--port', 'PORT', '--ids', '7']), /only for calibration/);
});

test('calibration discovers arbitrary IDs and saves no assumed arm geometry', async t => {
  const f = await fixture(t, { motorIds: [7, 42] });
  await f.execute();
  const report = await f.report();
  assert.deepEqual(report.ids, [7, 42]);
  assert.deepEqual(report.appliedIds, { offsets: [7, 42], limits: [7, 42] });
  assert.equal(report.robot, undefined);
  assert.equal(report.referencePose.geometryDeg, undefined);
  assert.equal(report.joints[42].name, 'motor-42');
  assert.equal(report.referenceReadbackCounts[42], 2048);
  assert.equal(f.prompts(), 2);
});

test('calibrating a selected subset leaves all other connected motors untouched', async t => {
  const f = await fixture(t, { selectedIds: [2, 5] });
  await f.execute();
  assert.deepEqual((await f.report()).ids, [2, 5]);
  assert(f.saves.every(entry => [2, 5].includes(entry.id)));
  assert(f.writes.every(entry => [2, 5].includes(entry.id)));
  for (const id of [1, 3, 4, 6]) assert.deepEqual(f.states[id], f.initial[id]);
});

test('expected travel accepts arbitrary supported motor IDs', () => {
  assert.deepEqual(validateExpectedRanges({ 42: { counts: 1000, tolerance: 50 } }), { 42: { counts: 1000, tolerance: 50 } });
});
