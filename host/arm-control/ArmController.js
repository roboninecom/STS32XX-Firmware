'use strict';

const { randomInt } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { ArmCodec, Instruction } = require('../servo-driver');
const integer = (v, lo, hi, name) => {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`Invalid ${name}`);
  return v;
};
// Legacy position registers use sign-magnitude words, unlike extension Q8 values.
function signed(bytes) {
  const value = bytes.readUInt16LE();
  return value & 0x8000 ? -(value & 0x7fff) : value;
}

function word(value) {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value < 0 ? (-value | 0x8000) : value);
  return bytes;
}

class ArmController {
  constructor({ follower, config, source, clock = () => performance.now(), sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
    this.follower = follower;
    this.config = config;
    this.source = source;
    this.clock = clock;
    this.sleep = sleep;
    this.joints = source.joints;
    const timeoutMs = integer(config.responseTimeoutMs ?? 100, 25, 10000, 'response timeout');
    this.options = { timeoutMs, deadlineMs: timeoutMs, rejectOnAlarm: true };
    if (!['legacy', 'extension'].includes(config.protocol)) throw new Error('Choose legacy or extension');
    if (!Array.isArray(this.joints) || !this.joints.length || this.joints.length > 6) throw new Error('Expected 1–6 joints');
    for (const key of ['leaderId', 'followerId']) {
      const ids = this.joints.map(j => integer(j[key], 1, 253, key));
      if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${key}`);
    }
    this.hz = integer(config.hz ?? 60, 1, 60, 'hz');
    this.maxAgeMs = integer(config.maxAgeMs ?? 100, 10, 10000, 'maxAgeMs');
    this.session = integer(config.session ?? randomInt(1, 65536), 1, 65535, 'session');
    if (config.protocol === 'extension') {
      integer(config.acceleration, 1, 30000, 'extension acceleration');
      if ('braking' in config) throw new Error('braking is obsolete; use symmetric acceleration');
      integer(config.rampTimeMs, 1, 255, 'rampTimeMs');
    } else if (config.legacyAcceleration !== undefined) integer(config.legacyAcceleration, 0, 254, 'legacy acceleration');
    if ('startupBounds' in config) throw new Error('startupBounds was removed; extension uses saved legacy position limits');
    if ('velocityFeedforward' in config) throw new Error('Put velocityFeedforward inside each servo profile');
    if (config.durationMs !== undefined) integer(config.durationMs, 1, 86400000, 'durationMs');
    this.lastFeedback = new Map();
    this.captureNotBefore = -Infinity;
    this.sequence = 0;
    this.enabled = new Set();
    this.prepared = new Set();
    this.stopping = false;
  }

  async inspect(servo, ids, role) {
    const found = await servo.bus.discover();
    if (found.alarms?.size) throw new Error('Bus reports an alarm');
    if (found.ids.length !== ids.length || ids.some(id => !found.ids.includes(id)))
      throw new Error(`${role} bus IDs differ from configured joints: expected [${ids}], found [${found.ids}]. Check servo power, connection and baud rate.`);
    const result = {};
    for (const id of ids) {
      const b = await servo.protocol.read(id, 0, 66, this.options);
      const min = b.readUInt16LE(9), max = b.readUInt16LE(11);
      if (min >= max || max > 32767) throw new Error(`ID ${id}: unusable stored position limits`);
      if (b[33] !== 0 || b[30] > 1) throw new Error(`ID ${id}: requires ordinary position mode and unit resolution`);
      if (b[65]) throw new Error(`ID ${id}: servo alarm ${b[65]}`);
      if (role === 'Follower' && (b[55] !== 1 || b[64] !== 0))
        throw new Error(`Follower ${id}: settings must be locked and no deferred write may be pending`);
      // Legacy pose playback converts counts/s using the saved rate scale.
      // Live streaming retains its existing zero-speed semantics.
      let speedScale;
      if (role === 'Follower' && this.source.kind === 'poses' && this.config.protocol === 'legacy')
        speedScale = b[18] & 4 ? 1 : (await servo.protocol.read(id, 82, 1, this.options))[0] || 1;
      result[id] = { min, max, speedScale, responseStatusLevel: b[8], torque: b[40],
        position: signed(b.subarray(56, 58)), acceleration: b[41] };
    }
    return result;
  }

  async preflight() {
    this.limits = {
      leader: await this.source.preflight(this),
      follower: await this.inspect(this.follower, this.joints.map(j => j.followerId), 'Follower'),
    };
    this.profiles = {};
    for (const j of this.joints) {
      const id = j.followerId, limits = this.limits.follower[id];
      const caps = await this.follower.arm.capabilities(id, this.options);
      if (caps?.major !== 9) throw new Error(`Follower ${id}: rewrite arm v9 required`);
      limits.feedback = await this.follower.arm.feedback(id, this.options);
      this.checkHealth(id, limits.feedback);
      if (this.config.protocol === 'extension') {
        const supplied = this.config.profiles?.[id];
        if (!supplied) throw new Error(`Missing explicit RAM gain/effort profile for follower ${id}`);
        const profile = { ...supplied, velocityLimit: supplied.velocityLimit ?? 65535,
          accelerationLimit: this.config.acceleration, rampTimeMs: this.config.rampTimeMs };
        ArmCodec.encodeConfig(profile);
        this.profiles[id] = profile;
      }
    }
    this.sourceSummary = this.source.describe(this);
    return this.limits;
  }

  async positions(servo, ids) {
    const { responses } = await servo.protocol.syncRead(ids, 56, 2, this.options);
    return Object.fromEntries(ids.map(id => {
      const b = responses.get(id);
      if (!b || b.length !== 2) throw new Error(`Missing position for ${id}`);
      return [id, signed(b)];
    }));
  }

  sample() { return this.source.sample(this); }

  fail(error) {
    this.failure ??= error instanceof Error ? error : new Error(String(error));
    this.stopping = true;
  }

  fresh(frame) {
    const age = this.clock() - frame.timestamp;
    if (this.stopping || !Number.isFinite(age) || age < 0 || age > this.maxAgeMs) throw new Error('Stopped or stale leader frame');
  }

  async operation(id, label, action) {
    try { return await action(); }
    catch (error) { throw new Error(`Follower ${id} ${label}: ${error.message}`, { cause: error }); }
  }

  write(id, address, data) {
    // Legacy WRITE acknowledgements depend on each motor's saved response level.
    return this.follower.protocol.write(id, address, data, { ...this.options,
      expectResponse: this.limits.follower[id].responseStatusLevel !== 0 });
  }

  async initialize() {
    if (this.stopping) throw this.failure ?? new Error('Startup cancelled');
    if (!this.limits) throw new Error('Preflight required');
    // Check the input and follower before changing any motor state.
    await this.source.assertUnpowered?.(this);
    const powered = [];
    for (const { followerId: id } of this.joints) {
      if ((await this.follower.protocol.read(id, 40, 1, this.options))[0] !== 0) {
        if (this.config.rearmPoweredFollower !== true)
          throw new Error(`ID ${id}: startup requires torque already off (or explicit follower rearm)`);
        powered.push(id);
      }
    }
    for (const id of powered) {
      if (this.stopping) throw new Error('Startup cancelled');
      await this.write(id, 40, Buffer.from([0]));
      if ((await this.follower.protocol.read(id, 40, 1, this.options))[0] !== 0)
        throw new Error(`Follower ${id}: torque-off rearm verification failed`);
    }
    const frame = await this.sample();
    const q = await this.positions(this.follower, frame.targets.map(t => t.id));
    this.fresh(frame);
    for (const t of frame.targets) {
      if (this.stopping) throw this.failure ?? new Error('Startup cancelled');
      const id = t.id;
      await this.operation(id, 'select legacy', () => this.follower.arm.select(id, false, 0, this.options));
      // A legacy goal write can auto-enable torque under saved factory flags.
      // Extension torque enable captures measured position itself; never seed legacy goals here.
      if (this.config.protocol === 'legacy') {
        const data = Buffer.alloc(6); word(q[id]).copy(data);
        this.enabled.add(id); // goal-write auto-enable can precede its acknowledgement
        await this.write(id, 42, data);
      }
      if (this.config.protocol === 'extension') {
        const p = this.profiles[id];
        const limits = this.limits.follower[id];
        if (q[id] < limits.min || q[id] > limits.max) throw new Error(`ID ${id}: outside saved position limits`);
        await this.operation(id, 'configure', () => this.follower.arm.configure(id, p, this.options));
        this.prepared.add(id); // include uncertain setup ACKs in torque-off cleanup
        await this.operation(id, 'select extension', () => this.follower.arm.select(id, true, this.session, this.options));
      } else if (this.config.legacyAcceleration !== undefined) {
        await this.write(id, 41, Buffer.from([this.config.legacyAcceleration]));
      }
    }
    for (const t of frame.targets) {
      if (this.stopping) throw new Error('Startup cancelled');
      // Track before write: response loss must still trigger torque-off cleanup.
      this.enabled.add(t.id);
      await this.write(t.id, 40, Buffer.from([1]));
      if (this.config.protocol === 'extension') await this.waitUntilOutputReady(t.id);
    }
  }

  async waitUntilOutputReady(id) {
    const started = this.clock();
    while (true) {
      await this.sleep(5);
      const s = await this.follower.arm.feedback(id, this.options);
      this.checkHealth(id, s);
      if (!s.armed || s.session !== this.session) throw new Error(`Follower ${id}: startup ownership lost`);
      if (s.fresh && s.driveEnabled && s.outputReady) return;
      if (this.stopping || this.clock() - started >= 3000) throw new Error(`Follower ${id}: output readiness timeout`);
    }
  }

  async send(frame) {
    if (this.stopping) return;
    this.fresh(frame);
    if (this.config.protocol === 'legacy') {
      const entries = frame.targets.map(t => {
        const data = Buffer.alloc(6); word(t.position).copy(data);
        if (t.speedLimit !== undefined) {
          const scale = this.limits.follower[t.id].speedScale;
          data.writeUInt16LE(Math.min(32767, Math.max(1, Math.round(t.speedLimit / scale))), 4);
        } // Otherwise time=0, speed=0 retain native maximum/unlimited semantics.
        return { id: t.id, data };
      });
      await this.follower.protocol.transaction(async wire => {
        if (this.stopping) return;
        this.fresh(frame);
        await wire.syncWrite(42, entries, this.options);
      }, this.options);
    } else {
      const sequence = (this.sequence + 1) & 0xffff;
      const payload = ArmCodec.encodeTargets(frame.targets.map(t => ({ id: t.id, target: {
        sequence, positionQ8: t.position * 256, speedLimit: t.speedLimit ?? 65535,
      } })), this.session);
      const sent = await this.follower.protocol.transaction(async wire => {
        if (this.stopping) return false;
        this.fresh(frame); // Recheck after acquiring the bus queue.
        await wire.armCommand(254, Instruction.ARM_TARGETS, payload, this.options);
        return true;
      }, this.options);
      if (!sent) return;
      this.sequence = sequence;
      this.captureNotBefore = this.clock() + 3;
    }
  }

  checkHealth(id, sample) {
    if (!sample?.temperatureValid || !Number.isInteger(sample.temperatureValidated) ||
        sample.temperatureValidated < 0 || sample.temperatureValidated > 255)
      throw new Error(`Follower ${id}: validated temperature unavailable`);
    if (!Number.isInteger(sample.ageMs) || sample.ageMs < 0 || sample.ageMs > 2)
      throw new Error(`Follower ${id}: stale sensor feedback`);
    if (sample.faults) throw new Error(`Follower ${id}: alarm ${sample.faults}`);
    if (sample.temperatureValidated >= 60)
      throw new Error(`Follower ${id}: host 60 C validated temperature guard (${sample.temperatureValidated} C)`);
  }

  async monitor(onTelemetry = () => {}) {
    // A target updates acceptance; C1 publishes it on the next fresh control pair.
    if (this.clock() < this.captureNotBefore)
      await this.sleep(this.captureNotBefore - this.clock());
    for (const id of this.enabled) {
      const telemetry = await this.follower.arm.feedback(id, this.options);
      this.checkHealth(id, telemetry);
      const previous = this.lastFeedback.get(id);
      if (previous && (telemetry.sampleSequence === previous.sampleSequence ||
          telemetry.sampleMs === previous.sampleMs))
        throw new Error(`Follower ${id}: feedback sample did not advance`);
      if (this.config.protocol === 'extension' &&
          (!telemetry.selected || !telemetry.armed ||
           telemetry.session !== this.session || !telemetry.fresh || !telemetry.driveEnabled ||
           !telemetry.outputReady || telemetry.acceptedSequence !== this.sequence))
        throw new Error(`Follower ${id}: extension tracking/session fault`);
      this.lastFeedback.set(id, telemetry);
      await onTelemetry({ timestamp: this.clock(), id, telemetry });
    }
  }

  // Explicit failure cleanup; ordinary extension exit sends no motor command.
  async disableTorque() {
    const failures = [];
    for (const id of new Set([...this.enabled, ...this.prepared])) {
      try {
        // Send even when the motor is alarming or its acknowledgement setting is unknown.
        await this.follower.protocol.write(id, 40, Buffer.from([0]), { ...this.options, expectResponse: false });
        if ((await this.follower.protocol.read(id, 40, 1, { ...this.options, rejectOnAlarm: false }))[0] !== 0)
          throw new Error('Torque-off verification failed');
      } catch (error) { failures.push({ id, error: error.message }); }
    }
    return failures;
  }

  async shutdown() {
    if (this.config.protocol === 'extension') return [];
    const failures = [];
    for (const id of this.enabled) {
      try {
        const q = signed(await this.follower.protocol.read(id, 56, 2, this.options));
        const data = Buffer.alloc(6); word(q).copy(data);
        await this.write(id, 42, data);
      } catch (error) { failures.push({ id, error: error.message }); }
    }
    return failures;
  }

  async run({ onFrame = () => {}, onTelemetry = () => {}, onCommand = () => {}, shouldStop = () => false } = {}) {
    let error;
    try {
      if (this.failure) throw this.failure;
      if (this.stopping || shouldStop()) return;
      await this.initialize();
      const callbacks = { onFrame, onTelemetry, onCommand, shouldStop };
      await this.source.play(this, callbacks);
      if (this.failure) throw this.failure;
    } catch (e) { error = e; }
    this.stopping = true;
    let failures = error ? await this.disableTorque() : await this.shutdown();
    // A disconnect can arrive while the normal hold is being requested.
    if (!error && (this.failure || failures.length)) {
      error = this.failure ?? new Error('Could not request hold on every follower');
      failures = [...failures, ...await this.disableTorque()];
    }
    if (error || failures.length) throw new Error(JSON.stringify({ error: error?.message, cleanupFailures: failures }), { cause: error });
  }
}
module.exports = { ArmController };
