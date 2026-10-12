'use strict';

const { performance } = require('node:perf_hooks');
const { ArmCodec, Instruction } = require('../servo-driver');
const OPTIONS = { timeoutMs: 100, rejectOnAlarm: true };
const integer = (v, lo, hi, name) => {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`Invalid ${name}`);
  return v;
};
const signed = b => (b.readUInt16LE() & 0x8000) ? -(b.readUInt16LE() & 0x7fff) : b.readUInt16LE();
const word = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n < 0 ? (-n | 0x8000) : n); return b; };

function mapPosition(position, leader, follower, joint) {
  if (!Number.isFinite(position)) throw new Error('Missing/nonfinite leader position');
  const direction = joint.direction ?? 1;
  if (direction !== 1 && direction !== -1) throw new Error('Direction must be +1 or -1');
  const p = Math.max(leader.min, Math.min(leader.max, position));
  let target;
  if (joint.mapping === 'range') {
    const lm = joint.leaderMiddle ?? (leader.min + leader.max) / 2;
    const fm = joint.followerMiddle ?? (follower.min + follower.max) / 2;
    if (!Number.isFinite(lm) || !Number.isFinite(fm) ||
        lm <= leader.min || lm >= leader.max || fm <= follower.min || fm >= follower.max)
      throw new Error('Mapping middle must lie strictly inside its own stored limits');
    // Normalize each side independently: asymmetric endpoints still preserve center.
    let fraction = p < lm ? (p - lm) / (lm - leader.min) : (p - lm) / (leader.max - lm);
    fraction *= direction;
    target = fm + fraction * (fraction < 0 ? fm - follower.min : follower.max - fm);
  } else if (joint.mapping === 'angle') {
    target = (follower.min + follower.max) / 2 + direction * (p - (leader.min + leader.max) / 2);
  } else throw new Error('Mapping must be angle or range');
  return Math.max(follower.min, Math.min(follower.max, Math.round(target)));
}

class Teleoperation {
  constructor({ leader, follower, config, clock = () => performance.now(), sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
    this.leader = leader; this.follower = follower; this.config = config;
    this.clock = clock; this.sleep = sleep; this.joints = config.joints;
    this.options = { ...OPTIONS, timeoutMs: integer(config.responseTimeoutMs ?? 100, 25, 10000, "response timeout"), deadlineMs: integer(config.responseTimeoutMs ?? 100, 25, 10000, "queue deadline") };
    if (!['legacy', 'extension'].includes(config.protocol)) throw new Error('Choose legacy or extension');
    if (!Array.isArray(this.joints) || !this.joints.length || this.joints.length > 6) throw new Error('Expected 1–6 joints');
    for (const key of ['leaderId', 'followerId']) {
      const ids = this.joints.map(j => integer(j[key], 1, 253, key));
      if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${key}`);
    }
    for (const j of this.joints) mapPosition(2048, {min:0,max:32767}, {min:0,max:32767}, j);
    this.hz = integer(config.hz ?? 60, 1, 60, 'hz');
    this.maxAgeMs = integer(config.maxAgeMs ?? 100, 10, 10000, 'maxAgeMs');
    this.session = integer(config.session ?? 1, 1, 65535, 'session');
    if (config.protocol === 'extension') {
      integer(config.acceleration, 1, 30000, 'extension acceleration');
      if ('braking' in config) throw new Error('braking is obsolete; use symmetric acceleration');
      integer(config.rampTimeMs, 1, 255, 'rampTimeMs');
    } else if (config.legacyAcceleration !== undefined) integer(config.legacyAcceleration, 0, 254, 'legacy acceleration');
    if ('startupBounds' in config) throw new Error('startupBounds was removed; extension uses saved legacy position limits');
    if ('velocityFeedforward' in config) throw new Error('Put velocityFeedforward inside each servo profile');
    this.lastFeedback = new Map();
    this.captureNotBefore = -Infinity;
    this.sequence = 0; this.enabled = new Set(); this.prepared = new Set(); this.stopping = false;
  }

  async inspect(servo, ids, role) {
    const found = await servo.bus.discover({ timeoutMs: 400 });
    if (found.alarms?.size) throw new Error('Bus reports an alarm');
    if (found.ids.length !== ids.length || ids.some(id => !found.ids.includes(id))) throw new Error(`${role ?? 'Servo'} bus IDs differ from configured joints: expected [${ids}], found [${found.ids}]. Check servo power, connection and baud rate.`);
    const result = {};
    for (const id of ids) {
      const b = await servo.protocol.read(id, 0, 66, this.options);
      const min = b.readUInt16LE(9), max = b.readUInt16LE(11);
      if (min >= max || max > 32767) throw new Error(`ID ${id}: unusable stored position limits`);
      if (b[33] !== 0 || b[30] > 1) throw new Error(`ID ${id}: requires ordinary position mode and unit resolution`);
      if (b[65]) throw new Error(`ID ${id}: servo alarm ${b[65]}`);
      result[id] = { min, max, torque: b[40], position: signed(b.subarray(56,58)), acceleration: b[41] };
    }
    return result;
  }

  async preflight() {
    this.limits = {
      leader: await this.inspect(this.leader, this.joints.map(j => j.leaderId), 'Leader'),
      follower: await this.inspect(this.follower, this.joints.map(j => j.followerId), 'Follower'),
    };
    this.profiles = {};
    for (const j of this.joints) {
      const id = j.followerId, limits = this.limits.follower[id];
      mapPosition(this.limits.leader[j.leaderId].position, this.limits.leader[j.leaderId], limits, j);
      const caps = await this.follower.arm.capabilities(id, this.options);
      if (caps?.major !== 9) throw new Error(`Follower ${id}: rewrite arm v9 required`);
      limits.feedback = await this.follower.arm.feedback(id, this.options);
      this.checkHealth(id, limits.feedback);
      if (this.config.protocol === 'extension') {
        const supplied = this.config.profiles?.[id];
        if (!supplied) throw new Error(`Missing explicit RAM gain/effort profile for follower ${id}`);
        const profile = { ...supplied, velocityLimit: 65535,
          accelerationLimit: this.config.acceleration, rampTimeMs: this.config.rampTimeMs };
        ArmCodec.encodeConfig(profile);
        this.profiles[id] = profile;
      }
    }
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

  async sample() {
    const timestamp = this.clock(); // conservative: includes complete acquisition time
    const positions = await this.positions(this.leader, this.joints.map(j => j.leaderId));
    const targets = this.joints.map(j => {
      const target = mapPosition(positions[j.leaderId], this.limits.leader[j.leaderId], this.limits.follower[j.followerId], j);
      return { id: j.followerId, position: target };
    });
    return { timestamp, positions, targets };
  }

  fresh(frame) {
    if (this.stopping || this.clock() - frame.timestamp > this.maxAgeMs) throw new Error('Stopped or stale leader frame');
  }

  async operation(id, label, action) {
    try { return await action(); }
    catch (error) { throw new Error(`Follower ${id} ${label}: ${error.message}`); }
  }

  async initialize() {
    if (!this.limits) throw new Error('Preflight required');
    // Read both buses before mutation. Factory leader always stays unpowered.
    const powered = [];
    for (const servo of [this.leader, this.follower]) {
      const ids = this.joints.map(j => servo === this.leader ? j.leaderId : j.followerId);
      for (const id of ids) if ((await servo.protocol.read(id,40,1,this.options))[0] !== 0) {
        if (servo === this.leader || this.config.rearmPoweredFollower !== true)
          throw new Error(`ID ${id}: startup requires torque already off (or explicit follower rearm)`);
        powered.push(id);
      }
    }
    for (const id of powered) {
      if (this.stopping) throw new Error('Startup cancelled');
      await this.follower.protocol.write(id,40,Buffer.from([0]),this.options);
      if ((await this.follower.protocol.read(id,40,1,this.options))[0] !== 0)
        throw new Error(`Follower ${id}: torque-off rearm verification failed`);
    }
    const frame = await this.sample();
    const q = await this.positions(this.follower, frame.targets.map(t => t.id));
    this.fresh(frame);
    for (const t of frame.targets) {
      const id = t.id;
      await this.operation(id, 'select legacy', () => this.follower.arm.select(id, false, 0, this.options));
      // A legacy goal write can auto-enable torque under saved factory flags.
      // Extension torque enable captures measured position itself; never seed legacy goals here.
      if (this.config.protocol === 'legacy') {
        const data = Buffer.alloc(6); word(q[id]).copy(data);
        this.enabled.add(id); // goal-write auto-enable can precede its acknowledgement
        await this.follower.protocol.write(id, 42, data, this.options);
      }
      if (this.config.protocol === 'extension') {
        const p = this.profiles[id];
        const limits = this.limits.follower[id];
        if (q[id] < limits.min || q[id] > limits.max) throw new Error(`ID ${id}: outside saved position limits`);
        await this.operation(id, 'configure', () => this.follower.arm.configure(id, p, this.options));
        this.prepared.add(id); // include uncertain setup ACKs in torque-off cleanup
        await this.operation(id, 'select extension', () => this.follower.arm.select(id, true, this.session, this.options));
      } else if (this.config.legacyAcceleration !== undefined) {
        await this.follower.protocol.write(id,41,Buffer.from([this.config.legacyAcceleration]),this.options);
      }
    }
    for (const t of frame.targets) {
      if (this.stopping) throw new Error('Startup cancelled');
      // Track before write: response loss must still trigger torque-off cleanup.
      this.enabled.add(t.id);
      await this.follower.protocol.write(t.id,40,Buffer.from([1]),this.options);
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
        const data = Buffer.alloc(6); word(t.position).copy(data); // time=0, speed=0: native maximum/unlimited semantics
        return { id:t.id, data };
      });
      await this.follower.protocol.syncWrite(42, entries, this.options);
    } else {
      const sequence = (this.sequence + 1) & 0xffff;
      const payload = ArmCodec.encodeTargets(frame.targets.map(t => ({ id: t.id, target: {
        sequence, positionQ8: t.position * 256, speedLimit: 65535,
      } })), this.session);
      const sent = await this.follower.protocol.transaction(async wire => {
        if (this.stopping) return false;
        this.fresh(frame); // Recheck after acquiring the bus queue.
        await wire.armCommand(254, Instruction.ARM_TARGETS, payload, this.options);
        return true;
      });
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
      onTelemetry({ timestamp: this.clock(), id, telemetry });
    }
  }

  // Explicit failure cleanup; ordinary extension exit sends no motor command.
  async disableTorque() {
    const failures = [];
    for (const id of new Set([...this.enabled, ...this.prepared])) {
      try {
        await this.follower.protocol.write(id,40,Buffer.from([0]),this.options);
        if ((await this.follower.protocol.read(id,40,1,this.options))[0] !== 0)
          throw new Error('Torque-off verification failed');
      } catch (error) { failures.push({id,error:error.message}); }
    }
    return failures;
  }

  async shutdown() {
    if (this.config.protocol === 'extension') return [];
    const failures = [];
    for (const id of this.enabled) {
      try {
        const q = signed(await this.follower.protocol.read(id,56,2,this.options));
        const data = Buffer.alloc(6); word(q).copy(data);
        await this.follower.protocol.write(id,42,data,this.options);
      } catch (error) { failures.push({id,error:error.message}); }
    }
    return failures;
  }

  async run({ onFrame = () => {}, onTelemetry = () => {}, onCommand = () => {}, shouldStop = () => false } = {}) {
    let error;
    try {
      await this.initialize();
      let monitored = this.clock(), nextCycle = this.clock();
      while (!this.stopping && !shouldStop()) {
        const started = this.clock();
        if (this.beforeSample) await this.beforeSample();
        const acquired = this.clock(), frame = await this.sample(), sampled = this.clock();
        if (this.stopping || shouldStop()) break;
        onCommand({ ...frame, sequence:(this.sequence+1)&0xffff });
        await this.send(frame);
        if (this.stopping) break;
        const sent = this.clock();
        if (this.clock() - monitored >= 250) { await this.monitor(onTelemetry); monitored = this.clock(); }
        onFrame({ ...frame, sequence:this.sequence, elapsedMs:this.clock()-started, timing:{serviceMs:acquired-started, sampleMs:sampled-acquired, sendMs:sent-sampled, monitorMs:this.clock()-sent} });
        if (!frame.replay) {
          const period = 1000/this.hz;
          if (this.config.fixedCadence) {
            nextCycle += period;
            if (nextCycle < this.clock()) nextCycle += Math.ceil((this.clock()-nextCycle)/period)*period;
            await this.sleep(Math.max(0,nextCycle-this.clock()));
          } else await this.sleep(Math.max(0,period-(this.clock()-started)));
        }
      }
    } catch (e) { error = e; }
    this.stopping = true;
    const failures = error ? await this.disableTorque() : await this.shutdown();
    if (error || failures.length) throw new Error(JSON.stringify({error:error?.message, cleanupFailures:failures}));
  }
}
module.exports = { Teleoperation, mapPosition };
