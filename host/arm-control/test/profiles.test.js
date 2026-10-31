'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadConfiguration } = require('../configuration');
const { GravityModel } = require('../GravityModel');
const { ArmCodec } = require('../../servo-driver');

for (const arm of ['so101', 'so102']) {
  test(`${arm} published profiles load with compatible gravity and firmware settings`, async () => {
    const filename = path.resolve(__dirname, '..', 'profiles', arm, 'controller.json');
    const config = await loadConfiguration(filename);
    const gravity = await GravityModel.load(path.resolve(path.dirname(filename), config.gravityModel));
    const ids = config.joints.map(joint => joint.followerId);
    assert.deepEqual(ids, [1, 2, 3, 4, 5, 6]);
    gravity.validateIds(ids);
    const settings = Object.fromEntries(ids.map(id => [id, {
      encoderCalibration: gravity.document.encoderCalibration[id],
    }]));
    gravity.validateCalibration(ids, settings);
    for (const profile of Object.values(config.profiles)) {
      ArmCodec.encodeConfig({ accelerationLimit: config.acceleration,
        rampTimeMs: config.rampTimeMs, ...profile });
      assert(config.replay.speed <= profile.velocityLimit);
    }
    // The sum of absolute coefficients bounds every pose, including poses
    // outside a particular replay path. No gravity term may exceed its cap.
    for (const id of ids) {
      const model = gravity.document.models[id];
      const bound = model.terms.reduce((sum, term) => sum + Math.abs(term.coefficient), 0);
      assert(bound <= Math.min(model.maxEffort, config.profiles[id].effortLimit));
      if ([1, 5, 6].includes(id)) assert.equal(bound, 0);
      else assert(bound > 0);
    }
    const mismatch = structuredClone(settings);
    mismatch[2].encoderCalibration.positionCorrection++;
    assert.throws(() => gravity.validateCalibration(ids, mismatch), /calibration mismatch/);
  });
}
