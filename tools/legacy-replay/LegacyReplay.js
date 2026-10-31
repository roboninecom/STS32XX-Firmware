'use strict';

const { performance } = require('node:perf_hooks');
const { RequestTimeoutError } = require('../../host/servo-driver');
const { validateRecording } = require('../pose-recorder/capture');
const { coordinatedSpeeds } = require('../../host/arm-control/coordination');

const SETTINGS = ['responseStatusLevel', 'minAngleLimit', 'maxAngleLimit', 'configurationFlags', 'positionPGain',
  'positionDGain', 'positionIGain', 'positionScalingDivisor', 'positionCorrection',
  'operationMode', 'lock', 'asyncWritePending', 'motionRateScale', 'minimumVelocity',
  'maximumVelocity', 'maximumAcceleration'];
const FEEDBACK = ['torqueEnable', 'targetPosition', 'presentPosition', 'presentSpeed', 'presentPWM',
  'presentVoltage', 'presentTemperature', 'servoStatus', 'activeProfileGoalPosition', 'activeProfileVelocity'];
const IO = { timeoutMs: 200, deadlineMs: 1000, rejectOnAlarm: true, maxGap: 87 };

function motionValues(settings, position, speed, acceleration) {
  const scale = settings.configurationFlags & 4 ? 1 : settings.motionRateScale || 1;
  return { acceleration: Math.min(acceleration / 100, settings.maximumAcceleration || 254),
    targetPosition: position, goalPWM: 0, goalVelocity: Math.max(1, Math.floor(speed / scale)) };
}

class LegacyReplay {
  constructor(servo, record, options, { signal, clock = () => performance.now(),
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), emit = async () => {} } = {}) {
    validateRecording(record);
    if (!record.poses.length) throw new Error('Recording contains no poses');
    this.servo = servo; this.record = record; this.options = options;
    this.signal = signal; this.clock = clock; this.sleep = sleep; this.emit = emit;
    this.settings = {}; this.extension = new Set(); this.prepared = new Set();
  }

  check() { this.signal?.throwIfAborted(); }

  async preflight() {
    this.check();
    const found = await this.servo.connect();
    const missing = this.record.ids.filter(id => !found.ids.includes(id));
    if (missing.length) throw new Error(`Recording motors missing: ${missing.join(', ')}`);
    const follower = {};
    for (const id of this.record.ids) {
      this.check();
      // Factory firmware does not implement this instruction. Only its absence
      // (timeout) is tolerated; malformed replies and transport faults propagate.
      let caps;
      try { caps = await this.servo.arm.capabilities(id, IO); }
      catch (error) { if (!(error instanceof RequestTimeoutError)) throw error; }
      if (caps && caps.major !== 9) throw new Error(`Motor ${id}: unsupported extension version ${caps.major}`);
      if (caps) this.extension.add(id);
      const s = await this.servo.bus.read(id, [...SETTINGS, ...FEEDBACK], IO);
      if (s.operationMode !== 0 || (s.positionScalingDivisor || 1) !== 1)
        throw new Error(`Motor ${id}: absolute position mode with unit resolution required`);
      if (s.minAngleLimit > s.maxAngleLimit || s.maximumVelocity === 0 ||
          s.minimumVelocity * (s.motionRateScale || 1) > s.maximumVelocity * 50)
        throw new Error(`Motor ${id}: invalid saved motion limits`);
      if (s.lock !== 1 || s.asyncWritePending) throw new Error(`Motor ${id}: lock settings and clear pending writes first`);
      if (s.servoStatus) throw new Error(`Motor ${id}: protection status ${s.servoStatus}`);
      this.settings[id] = s;
      follower[id] = { min: s.minAngleLimit, max: s.maxAngleLimit, position: s.presentPosition,
        pid: { p: s.positionPGain, d: s.positionDGain, i: s.positionIGain },
        encoderCalibration: { positionCorrection: s.positionCorrection,
          resolution: s.positionScalingDivisor || 1, reverse: !!(s.configurationFlags & 0x80) } };
    }
    return { follower };
  }

  frame(pose, previous) {
    const targets = this.record.ids.map(id => {
      const s = this.settings[id];
      const position = s.minAngleLimit === s.maxAngleLimit ? pose.positions[id]
        : Math.max(s.minAngleLimit, Math.min(s.maxAngleLimit, pose.positions[id]));
      return { id, position };
    });
    const distances = targets.map(t => Math.abs(t.position - previous[t.id]));
    const caps = targets.map(({ id }) => {
      const s = this.settings[id], scale = s.configurationFlags & 4 ? 1 : s.motionRateScale || 1;
      return Math.min(this.options.speed, s.maximumVelocity * 50, 32767 * scale);
    });
    const speeds = coordinatedSpeeds(distances, caps);
    return targets.map((target, i) => ({ ...target, speedLimit: speeds[i],
      values: motionValues(this.settings[target.id], target.position, speeds[i], this.options.acceleration) }));
  }

  write(id, values) {
    return this.servo.bus.write(id, values, { ...IO, expectResponse: this.settings[id].responseStatusLevel !== 0 });
  }

  async start() {
    // Switch one motor at a time. Seed its current position before enabling
    // torque so a stale legacy target cannot cause an unexpected first move.
    for (const id of this.record.ids) {
      this.check(); this.prepared.add(id);
      await this.write(id, { torqueEnable: 0 });
      if (this.extension.has(id)) await this.servo.arm.select(id, false, 0, IO);
      const s = await this.servo.bus.read(id, ['torqueEnable', 'presentPosition'], IO);
      if (s.torqueEnable !== 0) throw new Error(`Motor ${id}: could not disable torque for setup`);
      await this.write(id, motionValues(this.settings[id], s.presentPosition,
        this.options.speed, this.options.acceleration));
      this.check();
      await this.write(id, { torqueEnable: 1 });
      if (this.extension.has(id)) {
        const feedback = await this.servo.arm.feedback(id, IO);
        if (feedback.selected || feedback.armed) throw new Error(`Motor ${id}: still in extension mode`);
      }
    }
  }

  async sample(targets) {
    const latest = {};
    for (const id of this.record.ids) {
      this.check();
      const native = await this.servo.bus.read(id, FEEDBACK, IO);
      await this.emit({ type: 'telemetry', id, timestamp: this.clock(), native,
        telemetry: { measuredPositionQ8: native.presentPosition * 256,
          referencePositionQ8: native.activeProfileGoalPosition * 256,
          appliedEffort: native.presentPWM, faults: native.servoStatus,
          voltageRaw: native.presentVoltage, temperatureRaw: native.presentTemperature } });
      if (native.servoStatus || native.torqueEnable !== 1)
        throw new Error(`Motor ${id}: protection status ${native.servoStatus}, torque ${native.torqueEnable}`);
      const target = targets?.find(t => t.id === id);
      if (target && native.targetPosition !== target.position)
        throw new Error(`Motor ${id}: legacy target was not accepted`);
      latest[id] = native;
    }
    return latest;
  }

  async play() {
    await this.start();
    let latest = await this.sample();
    let previous = Object.fromEntries(this.record.ids.map(id => [id, latest[id].presentPosition]));
    for (const [index, pose] of this.record.poses.entries()) {
      this.check();
      const targets = this.frame(pose, previous);
      await this.emit({ type: 'command', timestamp: this.clock(), positions: pose.positions,
        replay: { index, name: pose.name, kind: 'poses' }, targets });
      await this.servo.bus.syncWrite(targets.map(({ id, values }) => ({ id, values })), IO);
      const deadline = this.clock() + 30000;
      let arrivedAt;
      do {
        const nextPoll = this.clock() + 50;
        latest = await this.sample(targets);
        const arrived = targets.every(t => latest[t.id].activeProfileGoalPosition === t.position &&
          latest[t.id].activeProfileVelocity === 0);
        if (arrived) arrivedAt ??= this.clock();
        else arrivedAt = undefined;
        if (arrivedAt !== undefined && this.clock() - arrivedAt >= this.options.holdMs) break;
        if (arrivedAt === undefined && this.clock() >= deadline) throw new Error(`Legacy motion timeout at ${pose.name}`);
        await this.sleep(Math.max(0, nextPoll - this.clock()));
      } while (true);
      previous = Object.fromEntries(targets.map(t => [t.id, t.position]));
    }
  }

  async disableTorque() {
    const errors = [];
    for (const id of this.prepared) {
      // An alarm or lost write acknowledgement must not skip readback. The
      // write may have reached the motor even when its reply did not reach us.
      const options = { ...IO, rejectOnAlarm: false };
      let writeError;
      try {
        await this.servo.bus.write(id, { torqueEnable: 0 }, { ...options,
          expectResponse: this.settings[id].responseStatusLevel !== 0 });
      } catch (error) { writeError = error; }
      try {
        if ((await this.servo.bus.read(id, ['torqueEnable'], options)).torqueEnable !== 0)
          throw writeError ?? new Error('Torque-off verification failed');
      } catch (error) { errors.push(new Error(`Motor ${id}: ${error.message}`, { cause: error })); }
    }
    return errors;
  }
}

module.exports = { LegacyReplay, motionValues };
