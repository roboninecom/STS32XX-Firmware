'use strict';

const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { validateRecording } = require('./capture');
const { mapPosition, validateLeaderMapping } = require('../teleoperation/Teleoperation');
const { coordinatedSpeeds } = require('../../host/arm-control/coordination');

const MAX_FILE_BYTES = 64 * 1024 * 1024;
function integer(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid replay ${name}: expected ${min}–${max}`);
  return value;
}
const signature = joints => joints?.map(j => [j.leaderId, j.followerId, j.mapping,
  j.direction ?? 1, j.leaderMiddle ?? null, j.followerMiddle ?? null]);

// Reuse recorded positions and timing, never packets, gains or session identities.
class Replay {
  static async load(filename, config) {
    if ((await fs.stat(filename)).size > MAX_FILE_BYTES) throw new Error('Replay file exceeds 64 MiB');
    return new Replay(await fs.readFile(filename, 'utf8'), config, filename);
  }

  constructor(raw, config, filename = '<memory>') {
    if (Buffer.byteLength(raw) > MAX_FILE_BYTES) throw new Error('Replay file exceeds 64 MiB');
    this.filename = filename;
    this.sha256 = createHash('sha256').update(raw).digest('hex');
    // Read the firmware's moving reference for the simulator shadow and
    // tracking-error charts. Replace compact feedback; do not add a second poll.
    this.detailedAll = true;
    this.feedbackIntervalMs = 50;
    const options = config.replay ?? {};
    for (const key of Object.keys(options))
      if (!['speed', 'holdMs', 'repeat', 'moveTimeoutMs', 'toleranceCounts'].includes(key)) throw new Error(`Unknown replay option: ${key}`);
    this.speed = integer(options.speed ?? 1000, 1, 65535, 'speed');
    this.holdMs = integer(options.holdMs ?? 1000, 0, 600000, 'holdMs');
    this.repeat = integer(options.repeat ?? 1, 1, 1000, 'repeat');
    this.moveTimeoutMs = integer(options.moveTimeoutMs ?? 30000, 1, 600000, 'moveTimeoutMs');
    this.toleranceCounts = integer(options.toleranceCounts ?? 10, 0, 32767, 'toleranceCounts');
    let record;
    try { record = JSON.parse(raw); } catch { /* Session logs contain one JSON event per line. */ }
    if (record && !record.type) {
      validateRecording(record);
      if (!record.poses.length) throw new Error('Recording contains no poses');
      this.kind = 'poses';
      this.frames = record.poses;
      this.joints = record.ids.map(id => ({ followerId: id }));
      if (config.joints && JSON.stringify(config.joints.map(j => j.followerId).sort((a, b) => a - b)) !==
          JSON.stringify([...record.ids].sort((a, b) => a - b))) throw new Error('Pose IDs differ from configured follower IDs');
      this.leaderLimits = {};
    } else {
      const events = raw.trim().split('\n').map((line, index) => {
        try { return JSON.parse(line); } catch { throw new Error(`Invalid recording JSON at line ${index + 1}`); }
      });
      const preflight = events.find(event => event.type === 'preflight');
      if (!Array.isArray(config.joints) || !preflight?.limits?.leader) throw new Error('Recording lacks joint mapping or leader limits');
      validateLeaderMapping(config.joints);
      if (JSON.stringify(signature(preflight.config?.joints)) !== JSON.stringify(signature(config.joints)))
        throw new Error('Replay joint mapping differs from recording');
      this.kind = 'session';
      this.joints = config.joints;
      this.leaderLimits = preflight.limits.leader;
      this.frames = events.filter(event => event.type === 'command');
      if (!this.frames.length) throw new Error('Recording contains no command frames');
      let previous = -Infinity;
      for (const frame of this.frames) {
        if (!Number.isFinite(frame.timestamp) || frame.timestamp < previous) throw new Error('Recording timestamps must be monotonic');
        previous = frame.timestamp;
        for (const joint of this.joints) {
          const limits = this.leaderLimits[joint.leaderId];
          if (!limits || !Number.isInteger(limits.min) || !Number.isInteger(limits.max) ||
              limits.min < 0 || limits.max > 32767 || limits.min >= limits.max) throw new Error('Invalid recorded leader limits');
          integer(frame.positions?.[joint.leaderId], -32767, 32767, 'leader position');
        }
      }
    }
  }

  preflight() { return this.leaderLimits; }

  sample(controller) { return this.frame(controller); }

  frame(controller, index = 0, previousTargets) {
    const source = this.frames[index];
    const targets = this.joints.map(joint => {
      const limits = controller.limits.follower[joint.followerId];
      const position = this.kind === 'poses'
        ? Math.max(limits.min, Math.min(limits.max, source.positions[joint.followerId]))
        : mapPosition(source.positions[joint.leaderId], this.leaderLimits[joint.leaderId], limits, joint);
      return { id: joint.followerId, position };
    });
    if (this.kind === 'poses') {
      const previous = new Map(previousTargets?.map(t => [t.id, t.position]));
      const distances = targets.map(({ id, position }) => {
        const sample = controller.lastFeedback.get(id) ?? controller.limits.follower[id].feedback;
        const current = sample.active && sample.armed && Number.isInteger(sample.referencePositionQ8)
          ? sample.referencePositionQ8 / 256 : sample.measuredPositionQ8 / 256;
        return Math.abs(position - (previous.get(id) ?? current));
      });
      const caps = targets.map(t => Math.min(this.speed, controller.profiles[t.id].velocityLimit));
      // Use the slowest joint's distance/speed ratio for the group. Subsequent
      // legs start at the last capped target, so encoder noise during a hold
      // cannot turn an unchanged joint into a spurious slow movement.
      const speeds = coordinatedSpeeds(distances, caps);
      targets.forEach((target, i) => {
        target.speedLimit = speeds[i];
      });
    }
    return { timestamp: controller.clock(), positions: source.positions, targets,
      replay: { index, name: source.name, kind: this.kind } };
  }

  describe(controller) {
    let cappedTargets = 0;
    let previousTargets;
    // Check the entire path during read-only preflight, not just its first pose.
    for (let index = 0; index < this.frames.length; index++) {
      const frame = this.frame(controller, index, previousTargets);
      previousTargets = frame.targets;
      if (this.kind === 'poses') cappedTargets += frame.targets.filter(t => t.position !== frame.positions[t.id]).length;
    }
    return { path: this.filename, sha256: this.sha256, kind: this.kind, frames: this.frames.length,
      telemetry: this.detailedAll ? 'detailed' : 'compact',
      repeat: this.repeat, cappedTargets, ...(this.kind === 'session'
        ? { recordedDurationMs: this.frames.at(-1).timestamp - this.frames[0].timestamp }
        : { speed: this.speed, holdMs: this.holdMs, coordination: 'distance-scaled speed limits' }),
      moveTimeoutMs: this.moveTimeoutMs, toleranceCounts: this.toleranceCounts };
  }

  async play(controller, { onCommand, onFrame, onTelemetry, shouldStop }) {
    const stopped = () => {
      if (controller.failure) throw controller.failure;
      return controller.stopping || shouldStop();
    };
    const monitor = () => controller.monitor(onTelemetry);
    const waitUntil = async due => {
      await controller.waitUntil(due, onTelemetry, stopped);
      return !stopped();
    };
    const arrive = async frame => {
      const deadline = controller.clock() + this.moveTimeoutMs;
      while (!stopped()) {
        // Read time is part of the polling interval. Adding a full interval
        // after a slow read can unnecessarily expire an otherwise fresh
        // gravity update before the next pass starts.
        const nextPoll = controller.clock() + (controller.gravity ? controller.monitorIntervalMs : 20);
        await monitor();
        let complete = true;
        for (const target of frame.targets) {
          const sample = controller.lastFeedback.get(target.id);
          if (!Number.isInteger(sample.measuredPositionQ8)) throw new Error(`Follower ${target.id}: invalid measured position`);
          const running = sample.running;
          if (running || Math.abs(sample.measuredPositionQ8 / 256 - target.position) > this.toleranceCounts) complete = false;
        }
        if (complete) return true;
        if (controller.clock() >= deadline) throw new Error(`Replay arrival timeout at frame ${frame.replay.index}`);
        await controller.sleep(Math.max(0, nextPoll - controller.clock()));
      }
      return false;
    };

    let previousTargets;
    for (let cycle = 0; cycle < this.repeat; cycle++) {
      let previousStart = controller.clock(), finalFrame;
      for (let index = 0; index < this.frames.length; index++) {
        // Preserve recorded gaps. If I/O falls behind, stretch playback rather
        // than burst old targets onto the bus to catch up.
        const gap = this.kind === 'session' && index > 0
          ? this.frames[index].timestamp - this.frames[index - 1].timestamp : 0;
        const due = previousStart + gap;
        if (!await waitUntil(due)) return;
        const frame = this.frame(controller, index, previousTargets);
        previousStart = frame.timestamp;
        frame.replay = { ...frame.replay, cycle: cycle + 1, latenessMs: Math.max(0, controller.clock() - due) };
        await onCommand({ ...frame, sequence: (controller.sequence + 1) & 0xffff });
        if (stopped()) return;
        await controller.send(frame);
        previousTargets = frame.targets;
        const sent = controller.clock();
        if (stopped()) return;
        await onFrame({ ...frame, replay: { ...frame.replay, latenessMs: Math.max(0, sent - due) },
          sequence: controller.sequence, elapsedMs: sent - frame.timestamp });
        finalFrame = frame;
        if (this.kind === 'poses') {
          if (!await arrive(frame) || !await waitUntil(controller.clock() + this.holdMs)) return;
        } else await controller.service(onTelemetry);
      }
      if (this.kind === 'session' && !await arrive(finalFrame)) return;
    }
  }
}
module.exports = { Replay };
