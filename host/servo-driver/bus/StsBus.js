'use strict';

const { EventEmitter } = require('events');
const { Priority } = require('../session/RequestScheduler');
const RegisterLayout = require('../registers/RegisterLayout');
const { StsDevice } = require('./StsDevice');

class StsBus extends EventEmitter {
  #ids = new Set();
  #devices = new Map();

  constructor(protocol) {
    super();
    if (!protocol?.ping || !protocol?.transaction) throw new TypeError('An STS protocol driver is required');
    this.protocol = protocol;
  }

  get ids() {
    return [...this.#ids];
  }

  has(id) {
    return this.#ids.has(id);
  }

  scan(options) {
    return this.protocol.ping(undefined, options);
  }

  async discover(options) {
    const result = await this.scan(options);
    this.#ids = new Set(result.ids);
    for (const id of this.#devices.keys()) if (!this.#ids.has(id)) this.#devices.delete(id);
    this.emit('discovery', result);
    return result;
  }

  async verify(ids = this.ids, options = {}) {
    const targets = this._assertKnown(ids);
    const verifiedIds = [];
    const errors = new Map();
    const startedAt = process.hrtime.bigint();

    for (const id of targets) {
      try {
        await this.protocol.ping(id, options);
        verifiedIds.push(id);
      } catch (error) {
        errors.set(id, error);
      }
    }

    return {
      ids: verifiedIds,
      missingIds: targets.filter(id => !verifiedIds.includes(id)),
      errors,
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
    };
  }

  device(id) {
    this._assertKnown([id]);
    if (!this.#devices.has(id)) this.#devices.set(id, new StsDevice(this, id));
    return this.#devices.get(id);
  }

  rebindId(currentId, nextId) {
    this._assertKnown([currentId]);
    if (!Number.isInteger(nextId) || nextId < 0 || nextId > 0xFD) {
      throw new RangeError(`Invalid STS servo ID: ${nextId}`);
    }
    if (nextId !== currentId && this.#ids.has(nextId)) {
      throw new RangeError(`STS servo ID ${nextId} is already registered`);
    }
    this.#ids.delete(currentId);
    this.#devices.delete(currentId);
    this.#ids.add(nextId);
    this.emit('idChanged', { previousId: currentId, id: nextId });
  }

  read(id, registers, options = {}) {
    this._assertKnown([id]);
    const layout = normalizeReadLayout(registers, options);
    const operation = protocol => this._read(protocol, id, layout, options);
    return options.exclusive
      ? this.protocol.transaction(operation, { priority: options.priority ?? Priority.NORMAL })
      : operation(this.protocol);
  }

  readMany(ids, registers, options = {}) {
    const normalizedIds = this._assertKnown(ids);
    const layout = normalizeReadLayout(registers, options);
    const operation = protocol => this._readMany(protocol, normalizedIds, layout, options);
    return options.exclusive
      ? this.protocol.transaction(operation, {
        priority: options.priority ?? Priority.NORMAL,
        coalesceKey: options.coalesceKey,
      })
      : operation(this.protocol);
  }

  write(id, values, options = {}) {
    this._assertKnown([id]);
    const plan = normalizeWrite(values, options.layout);
    return this.protocol.transaction(protocol => this._write(protocol, id, plan, options), {
      priority: options.priority ?? Priority.NORMAL,
    });
  }

  syncWrite(layoutOrEntries, entriesOrOptions, maybeOptions) {
    const { layout, entries, options } = normalizeSyncWrite(layoutOrEntries, entriesOrOptions, maybeOptions);
    this._assertKnown(entries.map(entry => entry.id));
    if (layout.ranges.length !== 1) {
      throw new TypeError('syncWrite requires one contiguous register layout');
    }
    const range = layout.ranges[0];
    const encoded = entries.map(({ id, values }) => ({
      id,
      data: RegisterLayout.encodeLayout(layout, values)[0].data,
    }));
    return this.protocol.syncWrite(range.address, encoded, {
      ...options,
      priority: options.priority ?? Priority.MOTION,
    });
  }

  regWrite(entries, options = {}) {
    const plans = normalizeEntries(entries);
    this._assertKnown(plans.map(entry => entry.id));
    assertStageable(plans);
    return this.protocol.transaction(async protocol => {
      for (const { id, ranges: [range] } of plans) {
        await protocol.regWrite(id, range.address, range.data, options);
      }
      if (options.action !== false) await protocol.action(undefined, options);
    }, { priority: options.priority ?? Priority.MOTION });
  }

  action(options) {
    return this.protocol.action(undefined, options);
  }

  transaction(operation, options = {}) {
    if (typeof operation !== 'function') throw new TypeError('transaction operation must be a function');
    return this.protocol.transaction(protocol => operation(new StsBusTransaction(this, protocol)), options);
  }

  async _read(protocol, id, layout, options) {
    const values = {};
    for (const range of layout.ranges) {
      let data;
      try {
        data = await protocol.read(id, range.address, range.length, options);
      } catch (error) {
        error.details = {
          ...error.details,
          operation: 'read',
          id,
          address: range.address,
          length: range.length,
          registers: range.fields.map(field => field.key),
        };
        throw error;
      }
      RegisterLayout.decodeRange(range, data, values);
    }
    return values;
  }

  async _readMany(protocol, ids, layout, options) {
    const values = new Map(ids.map(id => [id, {}]));
    const missing = new Set();
    let durationMs = 0;
    for (const range of layout.ranges) {
      const result = ids.length === 1
        ? {
          responses: new Map([[ids[0], await protocol.read(ids[0], range.address, range.length, options)]]),
          missingIds: [],
          durationMs: 0,
        }
        : await protocol.syncRead(ids, range.address, range.length, options);
      durationMs += result.durationMs;
      for (const id of result.missingIds) missing.add(id);
      for (const [id, data] of result.responses) RegisterLayout.decodeRange(range, data, values.get(id));
    }
    for (const id of missing) values.delete(id);
    return { values, missingIds: [...missing], durationMs };
  }

  async _write(protocol, id, ranges, options) {
    for (const { address, data, registers } of ranges) {
      try {
        await protocol.write(id, address, data, options);
      } catch (error) {
        error.details = {
          ...error.details,
          operation: 'write',
          id,
          address,
          length: data.length,
          registers,
        };
        throw error;
      }
    }
  }

  _assertKnown(ids) {
    if (!Array.isArray(ids) || !ids.length) throw new TypeError('servo IDs must be a non-empty array');
    const unique = [...new Set(ids)];
    if (unique.length !== ids.length) throw new TypeError('servo IDs must be unique');
    const unknown = unique.filter(id => !this.#ids.has(id));
    if (unknown.length) throw new RangeError(`Unknown STS servo IDs: ${unknown.join(', ')}`);
    return unique;
  }
}

class StsBusTransaction {
  constructor(bus, protocol) {
    this.bus = bus;
    this.protocol = protocol;
  }

  read(id, registers, options = {}) {
    this.bus._assertKnown([id]);
    return this.bus._read(this.protocol, id, normalizeReadLayout(registers, options), options);
  }

  readMany(ids, registers, options = {}) {
    const normalizedIds = this.bus._assertKnown(ids);
    return this.bus._readMany(this.protocol, normalizedIds, normalizeReadLayout(registers, options), options);
  }

  write(id, values, options = {}) {
    this.bus._assertKnown([id]);
    return this.bus._write(this.protocol, id, normalizeWrite(values, options.layout), options);
  }

  async regWrite(entries, options = {}) {
    const plans = normalizeEntries(entries);
    this.bus._assertKnown(plans.map(entry => entry.id));
    assertStageable(plans);
    for (const { id, ranges: [range] } of plans) {
      await this.protocol.regWrite(id, range.address, range.data, options);
    }
  }

  syncWrite(layoutOrEntries, entriesOrOptions, maybeOptions) {
    const { layout, entries, options } = normalizeSyncWrite(layoutOrEntries, entriesOrOptions, maybeOptions);
    this.bus._assertKnown(entries.map(entry => entry.id));
    if (layout.ranges.length !== 1) {
      throw new TypeError('syncWrite requires one contiguous register layout');
    }
    const range = layout.ranges[0];
    const encoded = entries.map(({ id, values }) => ({
      id,
      data: RegisterLayout.encodeLayout(layout, values)[0].data,
    }));
    return this.protocol.syncWrite(range.address, encoded, options);
  }

  action(options) {
    return this.protocol.action(undefined, options);
  }
}

function normalizeReadLayout(registers, options) {
  if (registers?.kind === 'read') return registers;
  return RegisterLayout.compileRead(registers, { maxGap: options.maxGap ?? 0 });
}

function normalizeWrite(values, layout) {
  const compiled = layout ?? RegisterLayout.compileWrite(Object.keys(values ?? {}));
  return RegisterLayout.encodeLayout(compiled, values).map((range, index) => ({
    ...range,
    registers: compiled.ranges[index].fields.map(field => field.key),
  }));
}

function normalizeEntries(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new TypeError('entries must be a non-empty array');
  return entries.map(({ id, values } = {}) => ({ id, ranges: normalizeWrite(values) }));
}

function assertStageable(plans) {
  const invalid = plans.find(({ ranges }) => ranges.length !== 1);
  if (invalid) {
    throw new TypeError(
      `regWrite requires one contiguous register range per servo; ID ${invalid.id} has ${invalid.ranges.length}`
    );
  }
}

function normalizeSyncWrite(layoutOrEntries, entriesOrOptions, maybeOptions) {
  if (layoutOrEntries?.kind === 'write') {
    if (!Array.isArray(entriesOrOptions) || !entriesOrOptions.length) {
      throw new TypeError('syncWrite entries must be a non-empty array');
    }
    return { layout: layoutOrEntries, entries: entriesOrOptions, options: maybeOptions ?? {} };
  }
  const entries = layoutOrEntries;
  if (!Array.isArray(entries) || !entries.length) throw new TypeError('syncWrite entries must be a non-empty array');
  const layout = RegisterLayout.compileWrite(Object.keys(entries[0].values ?? {}));
  return { layout, entries, options: entriesOrOptions ?? {} };
}

module.exports = { StsBus };
