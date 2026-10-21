'use strict';

function classify(iteration) {
  const beforeMalformed = [
    ['before', iteration.before],
    ['calibration response', { atMs: iteration.calibrationResponseAtMs,
      status: iteration.calibrationResponseStatus }],
    ['after calibration', iteration.afterZeroParameterCalibration],
    ...(iteration.postCalibrationWindow ?? []).map(point => ['post-calibration observation', point]),
    ['after calibration reset', iteration.afterCalibrationReset],
    ...iteration.preRestoreWindow.map(point => ['before correction restoration', point]),
    ['after pre-restore wait', iteration.afterPreRestoreWait],
    ['restoration response', { atMs: iteration.restoreResponseAtMs,
      status: iteration.restoreResponseStatus }],
    ['after correction restoration', iteration.afterRestoreWrite],
    ...(iteration.postRestoreWindow ?? []).map(point => ['post-restoration observation', point]),
    ['after immediate reset', iteration.afterImmediateReset],
    ...iteration.firstWindow.map(point => ['first observation window', point]),
    ['before malformed command', iteration.preMalformed]];
  const afterMalformed = [
    ['malformed response', { atMs: iteration.malformedResponseAtMs,
      status: iteration.malformedResponseStatus }],
    ['after malformed command', iteration.postMalformed],
    ...iteration.secondWindow.map(point => ['second observation window', point]),
    ['after wait', iteration.afterWait],
    ['after extra reset', iteration.afterExtraReset]].filter(([, point]) => Boolean(point));
  const alarm = point => Boolean((point.sensorStatus ?? point.status) & 2);
  const all = [...beforeMalformed, ...afterMalformed];
  const firstAlarm = all.find(([, point]) => alarm(point));
  const firstHealthy = firstAlarm && all.find(([, point]) =>
    point.atMs > firstAlarm[1].atMs && !alarm(point));
  const resetClearedAlarm = firstAlarm && firstHealthy &&
    [iteration.calibrationReset, iteration.immediateReset, iteration.extraReset]
      .filter(Boolean).some(reset => reset.sentAtMs > firstAlarm[1].atMs &&
        reset.sentAtMs < firstHealthy[1].atMs);
  const beforeMalformedAlarm = beforeMalformed.some(([, point]) => alarm(point));
  const afterMalformedAlarm = afterMalformed.some(([, point]) => alarm(point));
  const changed = iteration.preMalformed.correction !== iteration.postMalformed.correction ||
    iteration.preMalformed.torque !== iteration.postMalformed.torque;
  let classification = 'healthy throughout';
  if (changed) classification = 'correction or torque unexpectedly changed';
  else if (resetClearedAlarm) classification = 'alarm absent after reset; spontaneous recovery not established';
  else if (firstAlarm && firstHealthy) {
    classification = 'transient alarm that cleared without reset';
  } else if (!beforeMalformedAlarm && afterMalformedAlarm) {
    classification = 'alarm newly appeared after malformed 0x0B';
  } else if (beforeMalformedAlarm) classification = 'alarm present before malformed 0x0B';
  return { classification, firstAlarmPhase: firstAlarm?.[0] ?? null,
    firstAlarmTimestampMs: firstAlarm?.[1].atMs ?? null,
    firstHealthyTimestampMs: firstHealthy?.[1].atMs ?? null,
    alarmPresentBeforeMalformed: beforeMalformedAlarm,
    alarmAfterMalformed: afterMalformedAlarm, resetClearedAlarm: Boolean(resetClearedAlarm),
    correctionOrTorqueChanged: changed };
}

module.exports = { classify };
