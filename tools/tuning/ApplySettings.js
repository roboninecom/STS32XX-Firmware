'use strict';
// Use the controller's automatic setup without sending a new motion path.
class ApplySettings {
  constructor(config) {
    this.joints = config.joints;
    this.feedbackIntervalMs = 25; this.detailedAll = true;
  }
  preflight() { return {}; }
  describe(controller) { return { kind: 'apply-settings', profiles: controller.profiles }; }
  sample(controller) {
    return { timestamp: controller.clock(), targets: this.joints.map(({ followerId: id }) => ({ id,
      position: (controller.limits.follower[id].feedback.armed
        ? controller.limits.follower[id].feedback.referencePositionQ8
        : controller.limits.follower[id].feedback.measuredPositionQ8) / 256, speedLimit: 200 })) };
  }
  async play() {} // Setup already applied the settings and retained the targets.
}
module.exports = { ApplySettings };
