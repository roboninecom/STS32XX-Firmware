'use strict';
const { candidateProfile, hash } = require('./plan');
const { score, aggregate, drift } = require('./analysis');
const { ArmCodec } = require('../../host/servo-driver');

// A controller input, like Replay. All device reads, profile changes, gravity,
// targets and failure cleanup remain owned by the shared ArmController.
class BatchSource {
  constructor(plan, config, { record = async () => {} } = {}) {
    if (plan.poses.support !== undefined) throw new Error('Remove poses.support: tuning retains the current hold without repositioning');
    this.plan = plan; this.config = config; this.record = record;
    this.joints = config.joints;
    this.feedbackId = plan.probeId; this.feedbackIntervalMs = plan.sampling.intervalMs;
    this.detailedAll = true;
    this.trials = []; this.blocks = []; this.index = 0;
    this.summary = { version: 2, planHash: hash(plan), status: 'incomplete', screen: [], validation: [], recommendation: null };
  }
  preflight() { return {}; }
  describe(controller) {
    this.anchors = Object.fromEntries(this.joints.map(({ followerId: id }) => {
      const limits = controller.limits.follower[id], s = limits.feedback;
      const q = s.armed ? s.referencePositionQ8 / 256 : limits.position;
      return [id, q];
    }));
    const limits = controller.limits.follower[this.feedbackId];
    this.poses = Object.fromEntries(['screen', 'validate'].map(split => [split, this.plan.poses[split].map(pair =>
      pair.map(q => Math.max(limits.min, Math.min(limits.max, q))))]));
    this.cappedTargets = ['screen', 'validate'].flatMap(s => this.poses[s].flatMap((p, i) => p.map((q, j) => q !== this.plan.poses[s][i][j]))).filter(Boolean).length;
    // Commands are capped to saved limits. A collapsed exercise cannot measure a response.
    if (Object.values(this.poses).flat().some(([a, b]) => a === b)) throw new Error('Capped tuning endpoints collapse to the same position');
    const screen = new Set(this.poses.screen.map(p => [...p].sort((a,b)=>a-b).join(':')));
    if (this.poses.validate.some(p => screen.has([...p].sort((a,b)=>a-b).join(':')))) throw new Error('Capping removes held-out pose coverage');
    return { kind: 'tuning', stage: this.plan.stage, probeId: this.feedbackId, support: this.anchors,
      cappedTargets: this.cappedTargets, poses: this.poses };
  }
  sample(controller) { return this.frame(controller, this.anchors?.[this.feedbackId] ?? 0, this.plan.motion.speeds[0]); }
  frame(controller, position, speed) {
    return { timestamp: controller.clock(), positions: { ...this.anchors, [this.feedbackId]: position },
      targets: this.joints.map(({ followerId: id }) => ({ id, position: id === this.feedbackId ? position : this.anchors[id], speedLimit: speed })) };
  }
  check(controller) {
    if (controller.failure) throw controller.failure;
    if (controller.stopping || this.callbacks.shouldStop()) throw new Error('Tuning interrupted');
    if (controller.clock() - this.started > this.plan.batch.maxDurationMs) throw new Error('Batch duration budget exhausted');
  }
  async tick(controller) {
    this.check(controller);
    await controller.waitUntil(this.nextSample ?? controller.clock(), this.callbacks.onTelemetry, () => controller.stopping);
    this.check(controller);
    // Serviced waits may already have collected the next pass. Do not add a
    // second read just because the sampling deadline elapsed during that pass.
    if (this.lastPass === undefined || controller.lastMonitorAt <= this.lastPass)
      await controller.monitor(this.callbacks.onTelemetry);
    this.lastPass = controller.lastMonitorAt;
    const now = controller.clock(), s = controller.lastFeedback.get(this.feedbackId), p = this.plan;
    if (this.previous !== undefined && now - this.previous > p.sampling.maxGapMs) throw new Error('Tuning feedback gap exceeded');
    this.previous = now; this.nextSample = now + p.sampling.intervalMs;
    for (const [id, value] of controller.lastFeedback) {
      if (value.temperatureValidated >= p.limits.maxTemperature || value.voltageRaw < p.limits.minVoltageRaw || value.voltageRaw > p.limits.maxVoltageRaw)
        throw new Error(`Motor ${id}: tuning temperature/voltage limit`);
      if (id !== this.feedbackId && Math.abs(value.measuredPositionQ8 / 256 - this.anchors[id]) > p.limits.supportError)
        throw new Error(`Motor ${id}: supporting joint moved outside tolerance`);
    }
    if (!Number.isInteger(s.referencePositionQ8) || !Number.isInteger(s.referenceVelocityQ8PerS)) throw new Error('Detailed tuning feedback unavailable');
    if (Math.abs(s.referencePositionQ8 - s.measuredPositionQ8) / 256 > p.limits.followingError) throw new Error('Following-error safety limit');
    const delta = this.lastOverruns === undefined ? 0 : (s.overrunCount - this.lastOverruns) & 0xffff;
    if (!Number.isInteger(s.overrunCount) || delta) throw new Error('Control overrun during tuning');
    this.lastOverruns = s.overrunCount;
    return { ...s, hostMs: now, positions: Object.fromEntries([...controller.lastFeedback].map(([id, f]) => [id, f.measuredPositionQ8 / 256])) };
  }
  async move(controller, position, speed, trial) {
    this.check(controller);
    const held = controller.lastFeedback.get(this.feedbackId);
    // The previous measured trial already included a hold at this endpoint.
    // Do not resend that target and spend another setup hold before reversing.
    if (!trial && this.completedPosition === position && !held?.running &&
        held?.referencePositionQ8 === position * 256 && held.referenceVelocityQ8PerS === 0) return [];
    const frame = this.frame(controller, position, speed);
    await this.callbacks.onCommand(frame); await controller.send(frame);
    const start = controller.clock(), samples = [];
    let referenceEndMs;
    // Every move is finite: a bad tune may fail acceptance but cannot hold forever.
    while (true) {
      const sample = await this.tick(controller); sample.t = sample.hostMs - start;
      if (!sample.running && sample.referenceVelocityQ8PerS === 0 && sample.referencePositionQ8 === position * 256)
        referenceEndMs ??= sample.t;
      if (referenceEndMs === undefined && sample.t > this.plan.motion.moveTimeoutMs) throw new Error('Motion reference timed out');
      if (trial) {
        samples.push(sample); await this.record({ type: 'sample', trialId: trial.id, sample });
      }
      const holdMs = trial?.holdMs ?? 300;
      if (referenceEndMs !== undefined && sample.t - referenceEndMs >= holdMs) {
        if (trial) trial.referenceEndMs = referenceEndMs;
        this.completedPosition = position;
        return samples;
      }
    }
  }
  async block(controller, name, changes, split, role) {
    this.check(controller);
    const profile = candidateProfile(this.config, this.feedbackId, changes);
    if (!ArmCodec.encodeConfig(profile).equals(ArmCodec.encodeConfig(controller.profiles[this.feedbackId]))) {
      await this.record({ type: 'profile-change', name, id: this.feedbackId, profile });
      await controller.changeProfile(this.feedbackId, profile);
      this.completedPosition = undefined;
    }
    this.previous = undefined; this.nextSample = undefined; this.lastOverruns = undefined; this.lastPass = undefined;
    const start = this.trials.length;
    for (let repeat = 0; repeat < this.plan.batch[`${split}Repeats`]; repeat++)
      for (const speed of this.plan.motion.speeds) for (const [pair, endpoints] of this.poses[split].entries()) {
        const [a, b] = repeat % 2 ? [...endpoints].reverse() : endpoints;
        for (const [from, target] of [[a, b], [b, a]]) {
          await this.move(controller, from, speed);
          const trial = { id: ++this.index, candidate: name, split, from, target, speed, repeat, pair, holdMs: this.plan.batch[`${split}HoldMs`] };
          await this.record({ type: 'trial-start', trial });
          trial.result = score(await this.move(controller, target, speed, trial), trial, this.plan);
          this.trials.push(trial); await this.record({ type: 'trial-end', trial });
          if (!trial.result.valid) throw new Error(`Invalid trial ${trial.id}: ${trial.result.reasons.join(', ')}`);
        }
      }
    const result = aggregate(this.trials.slice(start));
    const block = { name, split, role, result }; this.blocks.push(block);
    await this.record({ type: 'block', block }); return result;
  }
  async compareCandidates(controller, candidates, split) {
    const before = await this.block(controller, 'baseline', {}, split, 'before');
    const results = [];
    for (const candidate of candidates)
      results.push({ candidate, result: await this.block(controller, candidate.name, candidate.changes, split, 'candidate') });
    const after = await this.block(controller, 'baseline', {}, split, 'after');
    const stability = drift(before, after, this.plan);
    const comparisons = [];
    for (const { candidate, result } of results) {
      const comparison = { name: candidate.name, split, result, baseline: { before, after }, stability,
        eligible: result.passed && stability.stable,
        betterThanBaseline: result.passed && (!before.passed || !after.passed || result.score < Math.min(before.score, after.score)) };
      comparisons.push(comparison); await this.record({ type: 'comparison', comparison });
    }
    return comparisons;
  }
  async play(controller, callbacks) {
    this.callbacks = callbacks; this.started = controller.clock();
    try {
      // Capture firmware hold targets, not measured positions: recapturing a
      // loaded joint's steady error on each batch would make it sag repeatedly.
      this.check(controller);
      await controller.monitor(callbacks.onTelemetry);
      for (const [id, s] of controller.lastFeedback) {
          if (s.temperatureValidated >= this.plan.limits.maxTemperature || s.voltageRaw < this.plan.limits.minVoltageRaw ||
              s.voltageRaw > this.plan.limits.maxVoltageRaw) throw new Error(`Motor ${id}: setup temperature/voltage limit`);
          if (!Number.isInteger(s.referencePositionQ8) ||
              Math.abs(s.referencePositionQ8 - s.measuredPositionQ8) / 256 > this.plan.limits.followingError)
            throw new Error(`Motor ${id}: setup following-error limit`);
        if (s.running) throw new Error(`Motor ${id}: tuning requires an idle hold`);
        this.anchors[id] = s.referencePositionQ8 / 256;
      }
      await this.record({ type: 'support-ready', targets: this.anchors, positions: Object.fromEntries([...controller.lastFeedback]
        .map(([id, s]) => [id, s.measuredPositionQ8 / 256])) });
      this.detailedAll = false;
      if (!this.plan.candidates.length) {
        await this.block(controller, 'baseline', {}, 'screen', 'characterize');
        await this.block(controller, 'baseline', {}, 'validate', 'characterize');
      } else {
        this.summary.screen = await this.compareCandidates(controller, this.plan.candidates, 'screen');
        if (this.summary.screen.some(c => !c.stability.stable)) { this.summary.status = 'inconclusive'; return; }
        const finalists = this.summary.screen.filter(c => c.eligible).sort((a,b) => a.result.score - b.result.score).slice(0, this.plan.batch.finalists);
        await this.record({ type: 'shortlist', names: finalists.map(c => c.name) });
        if (finalists.length) this.summary.validation = await this.compareCandidates(controller,
          finalists.map(f => this.plan.candidates.find(c => c.name === f.name)), 'validate');
        if (this.summary.validation.some(c => !c.stability.stable)) { this.summary.status = 'inconclusive'; return; }
        this.summary.recommendation = this.summary.validation.filter(c => c.eligible && c.betterThanBaseline)
          .sort((a,b) => a.result.score - b.result.score)[0]?.name ?? null;
      }
      // Every comparison ends on the baseline. No candidate is promoted or saved.
      this.summary.status = 'complete';
    } finally {
      this.summary.trials = this.trials.length; this.summary.blocks = this.blocks;
      this.summary.elapsedMs = controller.clock() - this.started;
    }
  }
}
module.exports = { BatchSource };
