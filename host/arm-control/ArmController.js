'use strict';

const { randomInt } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { ArmCodec, Instruction, RegisterCodec } = require('../servo-driver');
const integer = (v, lo, hi, name) => {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`Invalid ${name}`);
  return v;
};
const signed = bytes => RegisterCodec.decode('presentPosition', bytes);

class ArmController {
  constructor({ follower, config, source, gravity, clock = () => performance.now(), sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
    this.follower = follower;
    this.config = config;
    this.source = source;
    this.gravity = gravity;
    if ('gravityModel' in config && (typeof config.gravityModel !== 'string' || !config.gravityModel.trim()))
      throw new Error('gravityModel must be a nonempty file path');
    if (config.gravityModel && !gravity) throw new Error('Load gravityModel before creating the controller');
    const allowed = ['leaderPort', 'followerPort', 'baudRate', 'joints', 'profiles',
      'acceleration', 'rampTimeMs', 'gravityModel', 'hz', 'maxAgeMs',
      'responseTimeoutMs', 'durationMs', 'replay'];
    for (const key of Object.keys(config))
      if (!allowed.includes(key)) throw new Error(`Unknown controller setting: ${key}`);
    this.monitorIntervalMs = integer(source.feedbackIntervalMs ?? (gravity ? 50 : 250),
      20, gravity ? 50 : 250, 'feedback interval');
    this.expectedSequences = new Map();
    this.gravityMaxAgeMs = 100;
    this.gravitySent = new Map();
    this.ready = new Set();
    this.lastMonitorAt = -Infinity;
    this.clock = clock;
    this.sleep = sleep;
    this.joints = source.joints;
    const timeoutMs = integer(config.responseTimeoutMs ?? 100, 25, 10000, 'response timeout');
    this.options = { timeoutMs, deadlineMs: timeoutMs, rejectOnAlarm: true };
    if (!Array.isArray(this.joints) || !this.joints.length || this.joints.length > 6) throw new Error('Expected 1–6 joints');
    for (const key of ['leaderId', 'followerId']) {
      const ids = this.joints.map(j => integer(j[key], 1, 253, key));
      if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${key}`);
    }
    this.hz = integer(config.hz ?? 60, 1, 60, 'hz');
    this.maxAgeMs = integer(config.maxAgeMs ?? 100, 10, 10000, 'maxAgeMs');
    this.session = randomInt(1, 65536);
    integer(config.acceleration, 1, 30000, 'acceleration');
    integer(config.rampTimeMs, 1, 255, 'rampTimeMs');
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
      result[id] = { min, max, responseStatusLevel: b[8], torque: b[40],
        position: signed(b.subarray(56, 58)), acceleration: b[41],
        encoderCalibration: { positionCorrection: RegisterCodec.decode('positionCorrection', b.subarray(31, 33)),
          resolution: b[30] || 1, reverse: !!(b[18] & 0x80) } };
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
      if (caps?.major !== 9) throw new Error(`Follower ${id}: extension v9 required`);
      limits.feedback = await this.feedback(id);
      this.checkHealth(id, limits.feedback);
      const supplied = this.config.profiles?.[id];
      if (!supplied) throw new Error(`Missing explicit RAM gain/effort profile for follower ${id}`);
      const profile = { ...supplied, velocityLimit: supplied.velocityLimit ?? 65535,
        accelerationLimit: this.config.acceleration, rampTimeMs: this.config.rampTimeMs };
      ArmCodec.encodeConfig(profile);
      this.profiles[id] = profile;
    }
    if (this.gravity) {
      const ids = this.joints.map(j => j.followerId);
      this.gravity.validateIds(ids);
      this.gravity.validateCalibration(ids, this.limits.follower);
      this.gravity.evaluate(Object.fromEntries(ids.map(id => [id, this.measuredPosition(id, this.limits.follower[id].feedback)])), ids, this.profiles);
    }
    this.sourceSummary = this.source.describe(this);
    return this.limits;
  }

  feedback(id) {
    // Tuning replaces the probe's normal feedback read with the detailed packet;
    // supporting motors retain compact feedback. There is still only one reader.
    return id === this.source.feedbackId
      ? this.follower.arm.tuning(id, this.options)
      : this.follower.arm.feedback(id, this.options);
  }

  async changeProfile(id, profile) {
    if (!this.ready.has(id)) throw new Error('Profile change requires a ready extension motor');
    if (this.sequence >= 32767) throw new Error('Start a new session before another profile change');
    ArmCodec.encodeConfig(profile); // Validate before releasing any output.
    if (this.gravity) {
      const profiles = { ...this.profiles, [id]: profile };
      this.gravity.evaluate(Object.fromEntries([...this.lastFeedback].map(([key, s]) =>
        [key, this.measuredPosition(key, s)])), this.joints.map(j => j.followerId), profiles);
    }
    await this.finishGravity();
    await this.monitor(this.onTelemetry);
    if ([...this.lastFeedback.values()].some(s => s.running || Math.abs(s.measuredVelocityQ8PerS) > 10 * 256))
      throw new Error('Profile change requires stationary motors');
    const check = async () => {
      if (this.stopping) throw this.failure ?? new Error('Profile change cancelled');
      await this.service(this.onTelemetry);
    };
    await check();
    // v9 configuration is writable only with torque off. Keep every supporting
    // joint powered and continue its measured-gravity service throughout.
    await this.write(id, 40, Buffer.from([0]));
    this.ready.delete(id); this.enabled.delete(id); this.gravitySent.delete(id);
    if ((await this.follower.protocol.read(id, 40, 1, this.options))[0] !== 0)
      throw new Error(`Follower ${id}: profile torque-off verification failed`);
    await check();
    await this.follower.arm.select(id, false, 0, this.options);
    await check();
    await this.follower.arm.configure(id, profile, this.options);
    this.profiles[id] = profile;
    await check();
    await this.follower.arm.select(id, true, this.session, this.options);
    this.expectedSequences.set(id, 0); // This motor's counters reset on torque enable.
    this.lastFeedback.delete(id);
    await check();
    this.enabled.add(id); // An uncertain enable must still be included in cleanup.
    await this.write(id, 40, Buffer.from([1]));
    await this.waitUntilOutputReady(id);
    this.ready.add(id);
    await this.monitor(this.onTelemetry);
    if (this.gravity) await this.monitor(this.onTelemetry, false);
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
    for (const { followerId: id } of this.joints) {
      if ((await this.follower.protocol.read(id, 40, 1, this.options))[0] !== 0)
        throw new Error(`ID ${id}: startup requires torque already off`);
    }
    const frame = await this.sample();
    const q = await this.positions(this.follower, frame.targets.map(t => t.id));
    this.fresh(frame);
    for (const t of frame.targets) {
      if (this.stopping) throw this.failure ?? new Error('Startup cancelled');
      const id = t.id;
      await this.operation(id, 'deselect', () => this.follower.arm.select(id, false, 0, this.options));
      const limits = this.limits.follower[id];
      if (q[id] < limits.min || q[id] > limits.max) throw new Error(`ID ${id}: outside saved position limits`);
      await this.operation(id, 'configure', () => this.follower.arm.configure(id, this.profiles[id], this.options));
      this.prepared.add(id); // Include uncertain setup acknowledgments in cleanup.
      await this.operation(id, 'select extension', () => this.follower.arm.select(id, true, this.session, this.options));
    }
    if (this.stopping) throw new Error('Startup cancelled');
    // Enable all supporting joints together before checking individual readiness.
    const entries = frame.targets.map(t => ({ id: t.id, data: Buffer.from([1]) }));
    for (const { id } of entries) this.enabled.add(id);
    await this.follower.protocol.syncWrite(40, entries, this.options);
    for (const { id } of entries) {
      await this.waitUntilOutputReady(id);
      this.ready.add(id);
    }
    if (this.gravity) {
      await this.monitor(this.onTelemetry);
      await this.monitor(this.onTelemetry, false);
    }
    if (this.stopping) throw this.failure ?? new Error('Startup cancelled');
  }

  async waitUntilOutputReady(id) {
    const started = this.clock();
    while (true) {
      await this.sleep(5);
      if (this.stopping) throw this.failure ?? new Error('Startup cancelled');
      if (this.gravity && this.ready.size && this.clock() - this.lastMonitorAt >= this.monitorIntervalMs)
        await this.monitor(this.onTelemetry);
      const s = await this.feedback(id);
      this.checkHealth(id, s);
      if (!s.armed || s.session !== this.session) {
        const q = s.measuredPositionQ8 / 256, limits = this.limits.follower[id];
        if (Number.isFinite(q) && (q < limits.min || q > limits.max))
          throw new Error(`Follower ${id}: outside saved position limits at torque enable (${q}, limits ${limits.min}–${limits.max})`);
        throw new Error(`Follower ${id}: startup ownership lost`);
      }
      if (s.fresh && s.driveEnabled && s.outputReady) return;
      if (this.stopping || this.clock() - started >= 3000) throw new Error(`Follower ${id}: output readiness timeout`);
    }
  }

  async send(frame) {
    if (this.stopping) return;
    this.fresh(frame);
    this.checkGravityAge();
    const sequence = (this.sequence + 1) & 0xffff;
    const payload = ArmCodec.encodeTargets(frame.targets.map(t => ({ id: t.id, target: {
      sequence, positionQ8: t.position * 256, speedLimit: t.speedLimit ?? 65535,
    } })), this.session);
    const sent = await this.follower.protocol.transaction(async wire => {
      if (this.stopping) return false;
      this.fresh(frame); // Recheck after acquiring the bus queue.
      this.checkGravityAge();
      await wire.armCommand(254, Instruction.ARM_TARGETS, payload, this.options);
      return true;
    }, this.options);
    if (!sent) return;
    this.sequence = sequence;
    for (const target of frame.targets) this.expectedSequences.set(target.id, sequence);
    this.captureNotBefore = this.clock() + 3;
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

  measuredPosition(id, sample) {
    if (!Number.isInteger(sample.measuredPositionQ8)) throw new Error(`Follower ${id}: invalid measured position`);
    return sample.measuredPositionQ8 / 256;
  }

  checkGravityAge() {
    if (this.failure) throw this.failure;
    if (this.gravity) for (const [id, sent] of this.gravitySent)
      if (this.clock() - sent.measuredAt > this.gravityMaxAgeMs)
        throw new Error(`Follower ${id}: gravity update deadline missed`);
  }

  async service(onTelemetry = this.onTelemetry) {
    this.checkGravityAge();
    if (this.clock() - this.lastMonitorAt >= this.monitorIntervalMs) await this.monitor(onTelemetry);
  }

  async waitUntil(due, onTelemetry, shouldStop = () => false) {
    while (this.clock() < due && !this.stopping && !shouldStop()) {
      await this.service(onTelemetry);
      await this.sleep(Math.max(0, Math.min(20, due - this.clock(),
        this.lastMonitorAt + this.monitorIntervalMs - this.clock())));
    }
  }

  async monitor(onTelemetry = () => {}, updateGravity = true) {
    this.checkGravityAge();
    // Acceptance is published on the next fresh control pair after a write.
    if (this.clock() < this.captureNotBefore)
      await this.sleep(this.captureNotBefore - this.clock());
    const started = this.clock(), captures = [];
    // During startup, unpowered coupled axes are also measured. Ownership checks
    // apply only to axes whose control output has become ready.
    const ids = this.gravity ? this.joints.map(j => j.followerId) : [...this.enabled];
    for (const id of ids) {
      const measuredAt = this.clock(); // Conservative: includes request/response time.
      const telemetry = await this.feedback(id);
      this.checkHealth(id, telemetry);
      const previous = this.lastFeedback.get(id);
      if (previous && (telemetry.sampleSequence === previous.sampleSequence || telemetry.sampleMs === previous.sampleMs))
        throw new Error(`Follower ${id}: feedback sample did not advance`);
      const active = this.gravity ? this.ready.has(id) : this.enabled.has(id);
      if (active &&
          (!telemetry.selected || !telemetry.armed || telemetry.session !== this.session || !telemetry.fresh ||
           !telemetry.driveEnabled || !telemetry.outputReady || telemetry.acceptedSequence !== (this.expectedSequences.get(id) ?? this.sequence)))
        throw new Error(`Follower ${id}: extension tracking/session fault`);
      const sent = this.gravitySent.get(id);
      if (sent && (!telemetry.gravityReceived || telemetry.gravitySequence !== sent.sequence))
        throw new Error(`Follower ${id}: gravity acceptance mismatch`);
      this.lastFeedback.set(id, telemetry);
      captures.push({ timestamp: measuredAt, id, telemetry });
    }
    // Back-to-back completion/startup reads must observe a new control sample,
    // even when the preceding pass only confirmed acceptance without a write.
    this.captureNotBefore = this.clock() + 3;
    if (this.gravity && updateGravity) {
      const positions = Object.fromEntries(captures.map(c => [c.id, this.measuredPosition(c.id, c.telemetry)]));
      // Validate all results before writing any axis. Never use desired positions.
      const efforts = this.gravity.evaluate(positions, ids, this.profiles);
      for (const id of this.ready) {
        const sequence = ((this.gravitySent.get(id)?.sequence ?? 0) + 1) & 0xffff;
        const payload = ArmCodec.encodeGravity({ session: this.session, sequence, gravityEffort: efforts[id] });
        await this.follower.protocol.transaction(async wire => {
          this.checkGravityAge();
          if (this.clock() - started > this.gravityMaxAgeMs) throw new Error('Stale coupled gravity measurements');
          await wire.armCommand(id, Instruction.ARM_GRAVITY, payload, this.options);
        }, this.options);
        const previous = this.gravitySent.get(id);
        const change = Math.abs(efforts[id] - (previous?.effort ?? 0));
        // Conservative bound on outstanding firmware slew. Identical updates do
        // not restart the wait; changing effort includes any unfinished slew.
        const settledAt = change ? Math.max(this.clock(), previous?.settledAt ?? 0) +
          change * 1000 / this.profiles[id].gravitySlewEffortPerS : previous?.settledAt ?? this.clock();
        this.gravitySent.set(id, { sequence, effort: efforts[id], measuredAt: started, settledAt });
        this.captureNotBefore = this.clock() + 3;
      }
    }
    this.lastMonitorAt = started;
    for (const capture of captures) await onTelemetry({ ...capture,
      ...(this.gravity ? { gravity: this.gravitySent.get(capture.id) } : {}) });
    this.checkGravityAge();
  }

  async finishGravity() {
    if (!this.gravity || !this.ready.size) return;
    const deadline = this.clock() + 30000;
    let quietSince, previous;
    // Input may have stopped, but compensation must follow the remaining motion.
    // Confirm 200 ms of rest, not a particular tracking error (friction may remain).
    while (true) {
      await this.monitor(this.onTelemetry);
      const samples = [...this.ready].map(id => this.lastFeedback.get(id));
      const slewComplete = [...this.gravitySent.values()].every(sent => this.clock() >= sent.settledAt + 3);
      const quiet = slewComplete && samples.every((s, i) => !s.running && Number.isInteger(s.measuredVelocityQ8PerS) &&
        Math.abs(s.measuredVelocityQ8PerS) <= 10 * 256 && previous &&
        Math.abs(s.measuredPositionQ8 - previous[i]) <= 256);
      quietSince = quiet ? quietSince ?? this.clock() : undefined;
      if (quietSince !== undefined && this.clock() - quietSince >= 200) break;
      if (this.clock() >= deadline) throw new Error('Gravity completion timeout');
      previous = samples.map(s => s.measuredPositionQ8);
      await this.sleep(this.monitorIntervalMs);
    }
    await this.monitor(this.onTelemetry, false); // Final retained effort acknowledged.
  }

  // Failures turn torque off; ordinary extension exit retains target and gravity.
  async disableTorque() {
    const failures = [];
    for (const id of new Set([...this.enabled, ...this.prepared])) {
      let writeError;
      try {
        // Consume replies when enabled, even if they report an alarm. An ignored
        // ACK can collide with the immediate readback on a half-duplex bus.
        await this.follower.protocol.write(id, 40, Buffer.from([0]), { ...this.options,
          rejectOnAlarm: false, expectResponse: this.limits?.follower[id]?.responseStatusLevel !== 0 });
      } catch (error) { writeError = error; }
      try {
        // A missing ACK does not prove the write failed. Always verify output,
        // and continue with the remaining motors if this one cannot be reached.
        if ((await this.follower.protocol.read(id, 40, 1, { ...this.options, rejectOnAlarm: false }))[0] !== 0)
          throw new Error('Torque-off verification failed');
      } catch (error) {
        failures.push({ id, error: [writeError?.message, error.message].filter(Boolean).join('; ') });
      }
    }
    return failures;
  }

  async run({ onFrame = () => {}, onTelemetry = () => {}, onCommand = () => {}, shouldStop = () => false } = {}) {
    let error;
    try {
      if (this.failure) throw this.failure;
      if (this.stopping || shouldStop()) return;
      this.onTelemetry = onTelemetry;
      await this.initialize();
      const callbacks = { onFrame, onTelemetry, onCommand, shouldStop };
      await this.source.play(this, callbacks);
      await this.finishGravity();
      if (this.failure) throw this.failure;
    } catch (e) { error = e; }
    this.stopping = true;
    const failures = error ? await this.disableTorque() : [];
    if (error || failures.length) throw new Error(JSON.stringify({ error: error?.message, cleanupFailures: failures }), { cause: error });
  }
}
module.exports = { ArmController };
