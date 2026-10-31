'use strict';

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

// Only live input and recorded leader playback need leader IDs and mappings.
function validateLeaderMapping(joints) {
  if (!Array.isArray(joints) || !joints.length || joints.length > 6) throw new Error('Expected 1–6 joints');
  const ids = joints.map(joint => joint.leaderId);
  if (ids.some(id => !Number.isInteger(id) || id < 1 || id > 253)) throw new Error('Invalid leaderId');
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate leaderId');
  for (const joint of joints) mapPosition(2048, { min: 0, max: 32767 }, { min: 0, max: 32767 }, joint);
}

// Live input owns leader reads and mapping; ArmController owns every follower write.
class TeleoperationInput {
  constructor({ leader, config }) {
    this.leader = leader;
    this.joints = config.joints;
    validateLeaderMapping(this.joints);
  }

  preflight(controller) {
    return controller.inspect(this.leader, this.joints.map(joint => joint.leaderId), 'Leader');
  }

  describe(controller) {
    for (const joint of this.joints) mapPosition(controller.limits.leader[joint.leaderId].position,
      controller.limits.leader[joint.leaderId], controller.limits.follower[joint.followerId], joint);
  }

  async assertUnpowered(controller) {
    for (const joint of this.joints) {
      if ((await this.leader.protocol.read(joint.leaderId, 40, 1, controller.options))[0] !== 0)
        throw new Error(`Leader ${joint.leaderId}: startup requires torque already off`);
    }
  }

  async sample(controller) {
    const timestamp = controller.clock();
    const positions = await controller.positions(this.leader, this.joints.map(joint => joint.leaderId));
    const targets = this.joints.map(joint => ({ id: joint.followerId,
      position: mapPosition(positions[joint.leaderId], controller.limits.leader[joint.leaderId],
        controller.limits.follower[joint.followerId], joint) }));
    return { timestamp, positions, targets };
  }

  async play(controller, { onFrame, onTelemetry, onCommand, shouldStop }) {
    let nextCycle = controller.clock();
    while (!controller.stopping && !shouldStop()) {
      const started = controller.clock(), frame = await controller.sample(), sampled = controller.clock();
      if (controller.stopping || shouldStop()) break;
      // Await logging so disk failures are handled like other run failures.
      await onCommand({ ...frame, sequence: (controller.sequence + 1) & 0xffff });
      await controller.send(frame);
      if (controller.stopping) break;
      const sent = controller.clock();
      await controller.service(onTelemetry);
      await onFrame({ ...frame, sequence: controller.sequence, elapsedMs: controller.clock() - started,
        timing: { sampleMs: sampled - started, sendMs: sent - sampled, monitorMs: controller.clock() - sent } });
      // Skip missed deadlines: never queue a burst of old leader positions.
      const period = 1000 / controller.hz;
      nextCycle += period;
      if (nextCycle < controller.clock()) nextCycle += Math.ceil((controller.clock() - nextCycle) / period) * period;
      await controller.waitUntil(nextCycle, onTelemetry, shouldStop);
    }
  }

}
module.exports = { TeleoperationInput, mapPosition, validateLeaderMapping };
