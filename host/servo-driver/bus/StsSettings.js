'use strict';

const { setTimeout: delay } = require('node:timers/promises');
const RegisterLayout = require('../registers/RegisterLayout');
const { ControlTable, Storage } = require('../registers/ControlTable');
const { SettingsVerificationError, RequestTimeoutError, SerialOperationTimeoutError,
  InvalidPacketError } = require('../protocol/errors');

const GUARDED_SETTINGS = new Set(['id', 'baudRate', 'responseStatusLevel']);
const DEFAULT_EEPROM_TIMEOUT_MS = 250;
// A WRITE acknowledgment precedes flash completion. Requests sent immediately
// after it can be lost while the motor saves its settings.
const EEPROM_SETTLE_MS = 60;
const REQUEST_ATTEMPTS = 3;

function transient(error) {
  return error instanceof RequestTimeoutError || error instanceof SerialOperationTimeoutError ||
    error instanceof InvalidPacketError;
}

class StsSettings {
  constructor(bus) {
    if (!bus?.transaction || !bus?.read) throw new TypeError('An STS bus is required');
    this.bus = bus;
  }

  read(id, keys = eepromKeys()) {
    validateKeys(keys, { readable: true });
    return this.bus.read(id, keys);
  }

  save(id, values, { verify = true, timeoutMs = DEFAULT_EEPROM_TIMEOUT_MS } = {}) {
    validateValues(values);
    const keys = Object.keys(values);
    RegisterLayout.encodeLayout(RegisterLayout.compileWrite(keys), values);
    return this.bus.transaction(async transaction => {
      const read = async (keys, options) => {
        for (let attempt = 1; ; attempt++) {
          try { return await transaction.read(id, keys, options); }
          catch (error) {
            if (!transient(error) || attempt === REQUEST_ATTEMPTS) throw error;
            await delay(EEPROM_SETTLE_MS);
          }
        }
      };
      const { responseStatusLevel } = await read(
        ['responseStatusLevel'],
        { timeoutMs }
      );
      const requestOptions = {
        timeoutMs,
        expectResponse: responseStatusLevel !== 0,
      };
      const before = await read(keys, requestOptions);
      const changed = keys.filter(key => values[key] !== before[key]);
      if (!changed.length) return { id, before, after: verify ? before : undefined, verified: verify };
      const ranges = RegisterLayout.compileWrite(changed).ranges;
      const write = async (update, persistent = false) => {
        for (let attempt = 1; ; attempt++) {
          let failure;
          try { await transaction.write(id, update, requestOptions); }
          catch (error) { failure = error; }
          finally { if (persistent) await delay(EEPROM_SETTLE_MS); }
          if (!failure) return;
          if (!transient(failure)) throw failure;
          // A missing ACK does not mean the write failed. Read back before
          // retrying so an already-applied EEPROM write is never repeated.
          const actual = await read(Object.keys(update), requestOptions);
          if (Object.entries(update).every(([key, value]) => actual[key] === value)) return;
          if (attempt === REQUEST_ATTEMPTS) throw failure;
          await delay(EEPROM_SETTLE_MS);
        }
      };
      let result;
      let failure;
      try {
        await write({ lock: 0 });
        for (const range of ranges) {
          const update = Object.fromEntries(range.fields.map(({ key }) => [key, values[key]]));
          await write(update, true);
        }
        const after = verify ? await read(keys, requestOptions) : undefined;
        if (verify) verifyValues(id, values, after);
        result = { id, before, after, verified: verify };
      } catch (error) {
        failure = error;
      }

      try {
        await write({ lock: 1 });
      } catch (lockError) {
        if (failure) {
          throw new AggregateError(
            [failure, lockError],
            `Failed to save settings and relock STS servo ${id}`
          );
        }
        throw lockError;
      }
      if (failure) throw failure;
      return result;
    });
  }

  async saveMany(entries, options) {
    if (!Array.isArray(entries) || !entries.length) throw new TypeError('settings entries are required');
    const results = [];
    for (const { id, values } of entries) results.push(await this.save(id, values, options));
    return results;
  }
}

function eepromKeys() {
  return Object.entries(ControlTable)
    .filter(([, register]) => register.storage === Storage.EEPROM)
    .map(([key]) => key);
}

function validateKeys(keys, { readable = false } = {}) {
  if (!Array.isArray(keys) || !keys.length) throw new TypeError('setting keys are required');
  for (const key of keys) {
    const register = ControlTable[key];
    if (!register || register.storage !== Storage.EEPROM) {
      throw new TypeError(`${key} is not an EEPROM setting`);
    }
    if (!readable && GUARDED_SETTINGS.has(key)) {
      throw new TypeError(`${key} is communication-critical and cannot be changed through save()`);
    }
  }
}

function validateValues(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new TypeError('settings values are required');
  }
  const keys = Object.keys(values);
  validateKeys(keys);
}

function verifyValues(id, expected, actual) {
  const mismatches = {};
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) mismatches[key] = { expected: value, actual: actual[key] };
  }
  if (Object.keys(mismatches).length) {
    throw new SettingsVerificationError(`Settings verification failed for STS servo ${id}`, {
      id,
      mismatches,
    });
  }
}

module.exports = { StsSettings, GUARDED_SETTINGS };
