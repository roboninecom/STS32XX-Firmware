'use strict';

const { Access } = require('./ControlTable');
const RegisterCodec = require('./RegisterCodec');

const readCache = new Map();
const writeCache = new Map();

function compileRead(keys, { maxGap = 0 } = {}) {
  const normalized = normalizeKeys(keys);
  if (!Number.isInteger(maxGap) || maxGap < 0) throw new RangeError('maxGap must be a non-negative integer');
  const cacheKey = `${maxGap}:${[...normalized].sort().join('|')}`;
  if (readCache.has(cacheKey)) return readCache.get(cacheKey);

  const fields = fieldsFor(normalized);
  const ranges = [];
  for (const field of fields) {
    const previous = ranges.at(-1);
    const previousEnd = previous ? previous.address + previous.length : -1;
    if (previous && field.address >= previousEnd && field.address - previousEnd <= maxGap) {
      previous.length = field.address + field.size - previous.address;
      previous.fields.push(Object.freeze({ ...field, offset: field.address - previous.address }));
    } else {
      ranges.push({
        address: field.address,
        length: field.size,
        fields: [Object.freeze({ ...field, offset: 0 })],
      });
    }
  }
  const layout = Object.freeze({
    kind: 'read',
    keys: Object.freeze(normalized),
    ranges: Object.freeze(ranges.map(range => Object.freeze({
      ...range,
      fields: Object.freeze(range.fields),
    }))),
  });
  readCache.set(cacheKey, layout);
  return layout;
}

function compileWrite(keys) {
  const normalized = normalizeKeys(keys);
  const cacheKey = [...normalized].sort().join('|');
  if (writeCache.has(cacheKey)) return writeCache.get(cacheKey);
  const fields = fieldsFor(normalized);
  for (const field of fields) {
    if (field.register.access !== Access.READ_WRITE) throw new TypeError(`${field.key} is read-only`);
  }

  const ranges = [];
  for (const field of fields) {
    const previous = ranges.at(-1);
    if (
      previous &&
      previous.storage === field.register.storage &&
      previous.address + previous.length === field.address
    ) {
      previous.length += field.size;
      previous.fields.push(Object.freeze({ ...field, offset: field.address - previous.address }));
    } else {
      ranges.push({
        address: field.address,
        length: field.size,
        storage: field.register.storage,
        fields: [Object.freeze({ ...field, offset: 0 })],
      });
    }
  }

  const layout = Object.freeze({
    kind: 'write',
    keys: Object.freeze(normalized),
    ranges: Object.freeze(ranges.map(range => Object.freeze({
      ...range,
      fields: Object.freeze(range.fields),
    }))),
  });
  writeCache.set(cacheKey, layout);
  return layout;
}

function encodeLayout(layout, values) {
  assertLayout(layout, 'write');
  if (!values || typeof values !== 'object') throw new TypeError('register values are required');
  for (const key of layout.keys) {
    if (!Object.hasOwn(values, key)) throw new TypeError(`Missing value for ${key}`);
  }
  for (const key of Object.keys(values)) {
    if (!layout.keys.includes(key)) throw new TypeError(`${key} is not part of the compiled layout`);
  }
  return layout.ranges.map(range => {
    const data = Buffer.allocUnsafe(range.length);
    for (const field of range.fields) RegisterCodec.encodeInto(field.key, values[field.key], data, field.offset);
    return { address: range.address, data };
  });
}

function decodeRange(range, data, output = {}) {
  if (!Buffer.isBuffer(data) || data.length !== range.length) {
    throw new RangeError(`Expected ${range.length} register bytes, received ${data?.length}`);
  }
  for (const field of range.fields) output[field.key] = RegisterCodec.decode(field.key, data, field.offset);
  return output;
}

function assertLayout(layout, kind) {
  if (!layout || layout.kind !== kind || !Array.isArray(layout.ranges)) {
    throw new TypeError(`A compiled ${kind} layout is required`);
  }
}

function normalizeKeys(keys) {
  if (!Array.isArray(keys) || !keys.length) throw new TypeError('register keys must be a non-empty array');
  const normalized = [...new Set(keys)];
  for (const key of normalized) RegisterCodec.descriptor(key);
  return normalized;
}

function fieldsFor(keys) {
  return keys.map(key => {
    const register = RegisterCodec.descriptor(key);
    return { key, register, address: register.address, size: register.size };
  }).sort((left, right) => left.address - right.address);
}

module.exports = { assertLayout, compileRead, compileWrite, decodeRange, encodeLayout };
