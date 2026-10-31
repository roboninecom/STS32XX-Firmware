#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const {
  BAUD_RATES,
  ControlTable,
  RegisterCodec,
  Storage,
  StsServo,
} = require('../../host/servo-driver');

const { validateIds } = require('../pose-recorder/capture');

const FORMAT = 'factory-sts-settings';
const FORMAT_VERSION = 1;
const COMMUNICATION_KEYS = new Set(['id', 'baudRate', 'responseStatusLevel']);

function usage() {
  return [
    'Usage:',
    '  npm run settings -- discover --port <serial-port> [--baud <rate>]',
    '  npm run settings -- backup --port <serial-port> --id <servo-id> [--baud <rate>] [--file <json>]',
    '  npm run settings -- restore --port <serial-port> --id <current-servo-id> --file <json> [--baud <rate>]',
    '  npm run settings -- calibrate --port <serial-port> [--ids <1,2,...>] [--baud <rate>] [--file <json>] [--expected-ranges <json>]',
    '    Save reference offsets, then measure limits for selected or discovered motors.',
    '',
    'The optional baud rate defaults to 1000000. The ID supplied to restore is',
    'the servo ID before restoration; the JSON may restore a different ID.',
  ].join('\n');
}

function parseArguments(argv) {
  const [command, ...tokens] = argv;
  if (command === '--help') return { help: true };
  if (!['discover', 'backup', 'restore', 'calibrate'].includes(command)) throw new Error(usage());
  const values = {};
  for (let index = 0; index < tokens.length; index += 2) {
    const flag = tokens[index];
    const value = tokens[index + 1];
    if (!['--port', '--id', '--ids', '--baud', '--file', '--expected-ranges'].includes(flag) || value == null || value.startsWith('--') || Object.hasOwn(values, flag.slice(2))) {
      throw new Error(`Invalid argument ${flag ?? ''}\n\n${usage()}`);
    }
    values[flag.slice(2)] = value;
  }
  if (!values.port) throw new Error(`--port is required\n\n${usage()}`);
  if (command !== 'calibrate' && values['expected-ranges'] != null) throw new Error('--expected-ranges is only for calibration');
  const id = ['discover', 'calibrate'].includes(command) ? undefined : parseInteger(values.id, '--id', 0, 0xFD);
  if (command === 'calibrate' && values.id != null) throw new Error('Use --ids to select calibration motors');
  if (command === 'discover' && (values.id != null || values.file != null)) {
    throw new Error('Discovery accepts only --port and --baud');
  }
  if (command !== 'calibrate' && values.ids != null) throw new Error('--ids is only for calibration');
  const ids = values.ids == null ? undefined : validateIds(values.ids.split(',').map(value => parseInteger(value, '--ids', 1, 253)));
  const baudRate = values.baud == null
    ? 1_000_000
    : parseInteger(values.baud, '--baud', 1, Number.MAX_SAFE_INTEGER);
  if (!BAUD_RATES.includes(baudRate)) throw new Error('Unsupported baud rate');
  if (command === 'restore' && !values.file) {
    throw new Error(`--file is required for ${command}\n\n${usage()}`);
  }
  return {
    command,
    port: values.port,
    id,
    baudRate,
    ...(ids ? { ids } : {}),
    ...(values['expected-ranges'] != null ? { expectedRanges: values['expected-ranges'] } : {}),
    file: command === 'discover' ? undefined : values.file ?? path.join('tools', 'settings',
      command === 'calibrate' ? 'calibrations' : 'backups',
      `${command === 'calibrate' ? 'calibration' : `servo-${id}`}-${new Date().toISOString().replaceAll(':', '-')}.json`),
  };
}

function parseInteger(value, name, minimum, maximum) {
  const parsed = value == null || value.trim() === '' ? NaN : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function settingKeys() {
  return Object.entries(ControlTable)
    .filter(([, register]) => register.storage === Storage.EEPROM)
    .map(([key]) => key);
}

async function readSettingsDocument(servo, id, connection = {}) {
  await servo.protocol.ping(id, { rejectOnAlarm: false });
  const [device, settings] = await Promise.all([
    servo.bus.read(id, ['firmwareMajor', 'firmwareMinor', 'modelMinor', 'modelMajor']),
    servo.settings.read(id, settingKeys()),
  ]);
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    source: {
      port: connection.port,
      hostBaudRate: connection.baudRate,
      servoId: id,
    },
    device,
    settings,
  };
}

function validateSettingsDocument(document) {
  if (!document || document.format !== FORMAT || document.version !== FORMAT_VERSION) {
    throw new Error(`Unsupported settings file; expected ${FORMAT} version ${FORMAT_VERSION}`);
  }
  if (!document.settings || typeof document.settings !== 'object' || Array.isArray(document.settings)) {
    throw new Error('Settings file has no settings object');
  }
  const expected = settingKeys();
  const missing = expected.filter(key => !Object.hasOwn(document.settings, key));
  const unknown = Object.keys(document.settings).filter(key => !expected.includes(key));
  if (missing.length) throw new Error(`Settings file is missing: ${missing.join(', ')}`);
  if (unknown.length) throw new Error(`Settings file contains unknown settings: ${unknown.join(', ')}`);
  for (const key of expected) RegisterCodec.encode(key, document.settings[key]);
  for (const key of ['modelMajor', 'modelMinor']) {
    if (!Number.isInteger(document.device?.[key]) || document.device[key] < 0 || document.device[key] > 255)
      throw new Error(`Settings file has no valid ${key}`);
  }
  return document;
}

async function restoreSettingsDocument(servo, currentId, document, sleep = delay) {
  validateSettingsDocument(document);
  const desired = document.settings;
  if (desired.id !== currentId && servo.bus.has(desired.id)) {
    throw new Error(`Cannot restore ID ${desired.id}; that ID is already present on the bus`);
  }
  const before = await servo.bus.read(currentId, [
    'modelMajor', 'modelMinor', 'reserved4', 'torqueEnable', 'lock', 'servoStatus',
    'id', 'baudRate', 'responseStatusLevel',
  ]);
  if (before.torqueEnable !== 0 || before.lock !== 1 || before.servoStatus !== 0)
    throw new Error('Restore requires torque off, settings locked and no active alarm');
  if (before.modelMajor !== document.device.modelMajor || before.modelMinor !== document.device.modelMinor ||
      before.reserved4 !== desired.reserved4)
    throw new Error('Backup model does not match the connected servo');

  const ordinary = Object.fromEntries(
    Object.entries(desired).filter(([key]) => !COMMUNICATION_KEYS.has(key))
  );
  const ordinaryResult = await servo.settings.save(currentId, ordinary);
  let activeId = currentId;
  let activeBaudIndex = before.baudRate;

  // Communication writes may reply at either the old or new ID/baud, or suppress
  // replies altogether. Send once, allow the write to settle, then verify by READ.
  async function writeCommunication(key, value) {
    try {
      await servo.protocol.write(activeId, ControlTable[key].address, RegisterCodec.encode(key, value),
        { expectResponse: false });
    } finally {
      // Follow the attempted connection even after an ambiguous transport failure,
      // so the final relock at least addresses the intended destination.
      if (key === 'id' && value !== activeId) {
        const previousId = activeId;
        activeId = value;
        servo.bus.rebindId(previousId, activeId);
      } else if (key === 'baudRate') {
        activeBaudIndex = value;
        await servo.transport.updateBaudRate(BAUD_RATES[value]);
        servo.protocol.setBaudRate(BAUD_RATES[value]);
      }
    }
    await sleep(60);
    const actual = await servo.bus.read(activeId, [key]);
    if (actual[key] !== value) throw new Error(`${key} did not retain the restored value`);
  }

  if ([...COMMUNICATION_KEYS].some(key => desired[key] !== before[key])) {
    let failure;
    try {
      await writeCommunication('lock', 0);
      for (const key of ['responseStatusLevel', 'id', 'baudRate']) {
        if (desired[key] !== before[key]) await writeCommunication(key, desired[key]);
      }
    } catch (error) { failure = error; }
    try { await writeCommunication('lock', 1); }
    catch (error) {
      throw new AggregateError(failure ? [failure, error] : [error],
        `Could not confirm settings lock at ID ${activeId}, baud ${BAUD_RATES[activeBaudIndex]}`);
    }
    if (failure) throw failure;
  }

  const verification = await servo.settings.read(activeId, settingKeys());
  const mismatches = {};
  for (const key of settingKeys()) {
    if (verification[key] !== desired[key]) {
      mismatches[key] = { expected: desired[key], actual: verification[key] };
    }
  }
  if (Object.keys(mismatches).length) {
    const error = new Error('Restored settings did not verify');
    error.mismatches = mismatches;
    throw error;
  }
  const after = await servo.bus.read(activeId, ['lock', 'torqueEnable', 'servoStatus']);
  if (after.lock !== 1 || after.torqueEnable !== 0 || after.servoStatus !== 0)
    throw new Error('Restore finished with an unexpected lock, torque or alarm state');
  return {
    id: activeId, baudRateIndex: activeBaudIndex, baudRate: BAUD_RATES[activeBaudIndex],
    ordinaryResult, verified: true,
  };
}

async function run(options, dependencies = {}) {
  if (options.command === 'calibrate') {
    return require('./calibration').runCalibration(options, { ...dependencies, readSettingsDocument });
  }
  const { createServo = config => new StsServo(config) } = dependencies;
  // Reject malformed backups before touching a serial port.
  const input = options.command === 'restore' ? path.resolve(options.file) : undefined;
  const document = input ? validateSettingsDocument(JSON.parse(await fs.readFile(input, 'utf8'))) : undefined;
  const servo = createServo({
    serial: { path: options.port, baudRate: options.baudRate },
  });
  try {
    const discovery = await servo.connect();
    if (options.command === 'discover') {
      return { operation: 'discover', port: options.port, baudRate: options.baudRate,
        devices: discovery.ids.sort((a, b) => a - b).map(id => ({
          id, alarms: discovery.alarms.get(id) ?? [],
        })) };
    }
    if (!discovery.ids.includes(options.id)) {
      throw new Error(
        `Servo ID ${options.id} was not found; discovered: ${discovery.ids.join(', ') || 'none'}`
      );
    }
    if (options.command === 'backup') {
      const document = await readSettingsDocument(servo, options.id, options);
      const output = path.resolve(options.file);
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, `${JSON.stringify(document, null, 2)}\n`, { flag: 'wx' });
      return { operation: 'backup', file: output, settings: settingKeys().length };
    }
    return {
      operation: 'restore',
      file: input,
      ...(await restoreSettingsDocument(servo, options.id, document)),
    };
  } finally {
    await servo.close();
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) { console.log(usage()); return; }
  if (options.command === 'calibrate') {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Calibration requires an interactive terminal');
    const terminal = require('node:readline/promises').createInterface({ input: process.stdin, output: process.stdout });
    const abort = new AbortController();
    const stop = () => abort.abort(new Error('Calibration interrupted'));
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    terminal.on('SIGINT', stop); terminal.on('close', stop);
    try {
      console.log(JSON.stringify(await run(options, {
        signal: abort.signal,
        question: (text, signal = abort.signal) => terminal.question(text, { signal }),
      }), null, 2));
    } finally {
      terminal.close();
      process.off('SIGINT', stop); process.off('SIGTERM', stop);
    }
    return;
  }
  const result = await run(options);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) main().catch(error => {
  console.error(error.message);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  if (error.mismatches) console.error(JSON.stringify(error.mismatches, null, 2));
  process.exitCode = 1;
});

module.exports = {
  FORMAT,
  FORMAT_VERSION,
  parseArguments,
  readSettingsDocument,
  restoreSettingsDocument,
  run,
  settingKeys,
  usage,
  validateSettingsDocument,
};
