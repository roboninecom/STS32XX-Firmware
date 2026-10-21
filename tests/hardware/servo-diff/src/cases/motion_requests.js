'use strict';

const assert = require('node:assert/strict');
const { encodeSign15, positionDelta, nearbyLogicalPosition } = require('../position');
const { sample, trace, pacedWrite, exercise } = require('../motion');

async function replacementAndZeroSpeed(context) {
  return exercise(context, 0, async (rig, id, before) => {
    assert.ok(before[18] & 0x10, 'motion request test requires signed position telemetry');
    await pacedWrite(rig, id, 41, [30]);
    await pacedWrite(rig, id, 46, encodeSign15(600));
    await pacedWrite(rig, id, 48, [144, 1]);
    const start = await sample(rig, id);
    const origin = nearbyLogicalPosition(start.position, true);
    const direction = origin > 28000 ? -1 : 1;
    const firstGoal = origin + direction * 1200;
    const replacementGoal = origin - direction * 300;
    await rig.write(id, 42, encodeSign15(firstGoal));
    const first = await trace(rig, id, 180, 10);
    assert.ok(direction * positionDelta(first.at(-1).activePosition,
      start.activePosition, true) >= 40, 'first request did not start');

    await pacedWrite(rig, id, 18, [before[18] & ~0x08]);
    await pacedWrite(rig, id, 46, [0, 0]);
    await rig.write(id, 42, encodeSign15(replacementGoal));
    const rejected = await trace(rig, id, 350, 10);
    const activeAfterRejected = direction * positionDelta(
      rejected.at(-1).activePosition, start.activePosition, true);
    const shaftAfterRejected = direction * positionDelta(
      rejected.at(-1).position, start.position, true);

    await pacedWrite(rig, id, 18, [before[18]]);
    await pacedWrite(rig, id, 46, encodeSign15(600));
    await rig.write(id, 42, encodeSign15(replacementGoal));
    const accepted = await trace(rig, id, 1800, 15);
    const finalError = Math.abs(accepted.at(-1).position - replacementGoal);
    assert.ok(finalError <= 40, `replacement request ended ${finalError} ticks from goal`);
    return { exact: { firstStarted: true, zeroSpeedSequenceObserved: true,
      replacementAccepted: true },
    evidence: { origin, direction, firstGoal, replacementGoal, first,
      rejected, accepted, activeAfterRejected, shaftAfterRejected, finalError } };
  });
}

module.exports = [{
  id: 'test_motion_request_replacement_and_zero_speed', scope: 'device', risk: 'motion',
  stages: ['motion-requests'],
  covers: { modes: [0], registers: [18, 40, 41, 42, 46, 48, 56, 67, 71] },
  compare: (factory, candidate) => {
    const checks = [['active position after zero-speed request', 'activeAfterRejected', 35],
      ['shaft position after zero-speed request', 'shaftAfterRejected', 50],
      ['replacement final error', 'finalError', 15]].map(([name, field, tolerance]) => ({
      name, factory: factory.evidence[field], candidate: candidate.evidence[field], tolerance,
      matched: Math.abs(factory.evidence[field] - candidate.evidence[field]) <= tolerance }));
    return { matched: checks.every(check => check.matched), checks };
  },
  run: replacementAndZeroSpeed,
}];
