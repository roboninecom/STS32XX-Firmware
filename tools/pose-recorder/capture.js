'use strict';

const { performance } = require('node:perf_hooks');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');

function validateIds(ids) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 6 || new Set(ids).size !== ids.length ||
      ids.some(id => !Number.isInteger(id) || id < 1 || id > 253))
    throw new Error('Expected 1–6 unique servo IDs in 1–253');
  return [...ids];
}

class PoseCapture {
  constructor(bus, ids, { timeoutMs = 1000 } = {}) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000)
      throw new Error('Capture timeout must be an integer in 1–10000 ms');
    this.options = { timeoutMs, deadlineMs: timeoutMs + 1000, rejectOnAlarm: true };
    this.ids = validateIds(ids);
    const missing = this.ids.filter(id => !bus.has(id));
    if (missing.length) throw new Error(`Servos not discovered: ${missing.join(', ')}`);
    this.bus = bus;
  }

  async release() {
    const failures = [];
    try {
      await this.bus.syncWrite(this.ids.map(id => ({ id, values: { torqueEnable: 0 } })), this.options);
    } catch (error) { failures.push(error); }
    // Check every selected motor even when an earlier verification fails.
    for (const id of this.ids) {
      try {
        const state = await this.bus.read(id, ['torqueEnable'], this.options);
        if (state?.torqueEnable !== 0) throw new Error(`Servo ${id}: torque-off verification failed`);
      } catch (error) { failures.push(new Error(`Servo ${id}: ${error.message}`, { cause: error })); }
    }
    if (failures.length) throw new AggregateError(failures, 'Could not confirm torque off on all selected motors');
  }

  async read({ signal, tolerateReadErrors = false } = {}) {
    signal?.throwIfAborted();
    const capturedAt = new Date().toISOString(), start = performance.now(), positions = {}, errors = {};
    for (const id of this.ids) {
      signal?.throwIfAborted();
      try {
        const state = await this.bus.read(id, ['torqueEnable', 'presentPosition', 'servoStatus'], this.options);
        signal?.throwIfAborted();
        if (state?.torqueEnable !== 0) throw new Error('torque is not off');
        if (state?.servoStatus !== 0) throw new Error(`protection status ${state?.servoStatus}`);
        if (!Number.isInteger(state?.presentPosition) || Math.abs(state.presentPosition) > 32767)
          throw new Error('invalid reading');
        positions[id] = state.presentPosition;
      } catch (cause) {
        signal?.throwIfAborted();
        if (!tolerateReadErrors) throw new Error(`Servo ${id}: ${cause.message}`, { cause });
        // Calibration displays failures per joint and excludes their samples.
        // Alarms and unexpected torque are never accepted as valid positions.
        errors[id] = cause.message;
      }
    }
    return { capturedAt, durationMs: performance.now() - start, positions, ...(tolerateReadErrors ? { errors } : {}) };
  }
}

function validateRecording(record) {
  if (record?.format !== 'sts-poses' || record.version !== 1 || record.units !== 'encoder-counts')
    throw new Error('Expected sts-poses version 1 in encoder-counts');
  const ids = validateIds(record.ids).map(String);
  if (!Array.isArray(record.poses)) throw new Error('Expected a poses array');
  const names = new Set();
  for (const pose of record.poses) {
    if (typeof pose.name !== 'string' || !pose.name.trim() || names.has(pose.name)) throw new Error('Pose names must be unique and nonempty');
    names.add(pose.name);
    const positions = pose.positions;
    if (!positions || Array.isArray(positions) || Object.keys(positions).length !== ids.length ||
        ids.some(id => !Object.hasOwn(positions, id) || !Number.isInteger(positions[id]) || Math.abs(positions[id]) > 32767))
      throw new Error(`Pose ${pose.name}: expected one encoder count for every selected ID`);
    if (!Number.isFinite(Date.parse(pose.capturedAt)) || !Number.isFinite(pose.durationMs) || pose.durationMs < 0)
      throw new Error(`Pose ${pose.name}: invalid capture timing`);
  }
  return record;
}

async function saveRecording(filename, record, io = fs) {
  validateRecording(record);
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await io.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
    await io.rename(temporary, filename);
  } finally { await io.rm(temporary, { force: true }); }
}

module.exports = { PoseCapture, validateIds, validateRecording, saveRecording };
