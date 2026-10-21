'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCases } = require('../src/load-cases');
const { selectCases } = require('../src/runner');
const { parse, formatCase, progressReporter } = require('../src/cli');
const { positionDelta, nearbyLogicalPosition, encodeSign15 } = require('../src/position');
const { persistentBytes } = require('../src/register-image');
const { Rig } = require('../src/rig');

test('discovers independent scenario modules with stable test IDs', () => {
  const cases = loadCases();
  assert.ok(cases.length >= 6);
  assert.equal(new Set(cases.map(entry => entry.id)).size, cases.length);
  assert.ok(cases.every(entry => entry.covers));
});

test('CLI accepts every declared stage and persistent image extraction is stable', () => {
  const stages = new Set(loadCases().flatMap(entry => entry.stages));
  for (const stage of stages) assert.equal(parse(['--port', '/dev/test', '--stage', stage]).stage, stage);
  const image = Buffer.from(Array.from({ length: 87 }, (_, address) => address));
  assert.deepEqual(persistentBytes(image), [...Array.from({ length: 36 }, (_, n) => n + 4),
    ...Array.from({ length: 9 }, (_, n) => n + 78)]);
  assert.deepEqual(persistentBytes(image, true), persistentBytes(image).filter(
    address => address !== 31 && address !== 32));
});

test('saved reference requires candidate-only mode', () => {
  assert.throws(() => parse(['--port', '/dev/test', '--reference', 'factory.json']),
    /requires --mode candidate/);
  assert.equal(parse(['--port', '/dev/test', '--mode', 'candidate',
    '--reference', 'factory.json']).reference, 'factory.json');
});

test('live status uses V/X marks and current/total progress', () => {
  const progress = { index: 3, total: 17 };
  assert.equal(formatCase({ id: 'test_ok', status: 'passed' }, progress),
    'V [3/17] test_ok (passed)');
  assert.equal(formatCase({ id: 'test_bad', status: 'mismatch' }, progress),
    'X [3/17] test_bad (mismatch)');
  assert.equal(formatCase({ id: 'test_later', status: 'skipped' }, progress),
    '- [3/17] test_later (skipped)');
});

test('progress stays on one terminal line and one redirected output line', () => {
  const progress = { index: 3, total: 17 };
  const item = { id: 'test_ok', status: 'passed' };
  for (const isTTY of [true, false]) {
    let output = '';
    const stream = { isTTY, write(chunk) { output += chunk; } };
    const reporter = progressReporter(stream);
    reporter.start(item, progress);
    reporter.complete(item, progress);
    assert.equal((output.match(/\n/g) ?? []).length, 1);
    assert.match(output, /V \[3\/17\] test_ok \(passed\)\n$/);
    if (isTTY) assert.match(output, /^\.\.\. \[3\/17\] test_ok/);
    else assert.equal(output, 'V [3/17] test_ok (passed)\n');
  }
});

test('stage and exact-case selection do not include motion implicitly', () => {
  const cases = loadCases();
  assert.ok(selectCases(cases, { stage: 'safe' }).every(entry => entry.risk === 'safe'));
  assert.equal(selectCases(cases, { caseId: 'test_rapid_atomic_register_writes' }).length, 1);
  assert.throws(() => selectCases(cases, { caseId: 'missing' }), /No cases selected/);
});

test('offset comparisons use error relative to each device marker', () => {
  const cases = loadCases();
  const live = cases.find(entry => entry.id === 'test_position_offset_live_write');
  const reanchor = cases.find(entry => entry.id === 'test_position_offset_profile_reanchor');
  const factory = { evidence: { expectedShift: -64, observedShift: -64,
    shaftShift: -63, residual: 0, progressed: 200, reanchorGap: 7, resumedGap: 100 } };
  const candidate = { evidence: { expectedShift: 64, observedShift: 64,
    shaftShift: 64, residual: 0, progressed: 190, reanchorGap: 7, resumedGap: 100 } };
  assert.equal(live.compare(factory, candidate).matched, true);
  assert.equal(reanchor.compare(factory, candidate).matched, true);
});

test('locked register-write sweep stays isolated from bus and calibration fields', () => {
  const cases = selectCases(loadCases(), { stage: 'register-writes' });
  assert.equal(cases.length, 35);
  assert.ok(cases.every(entry => entry.scope === 'device' && entry.risk === 'safe'));
  const addresses = cases.flatMap(entry => entry.covers.registers);
  for (const address of [5, 6, 8, 9, 13, 14, 15, 18, 19, 20, 28, 29, 31, 32, 33, 40, 42, 43, 44, 45, 46, 47, 55]) {
    assert.ok(!addresses.includes(address), `unsafe register ${address} included`);
  }
});

test('communication cases are isolated and include guarded recovery commands', () => {
  const cases = selectCases(loadCases(), { stage: 'communication' });
  assert.deepEqual(cases.map(entry => entry.id), [
    'test_encoder_home_command', 'test_temporary_id_and_reset',
    'test_invalid_baud_index_clamp',
  ]);
  assert.ok(cases.every(entry => entry.scope === 'device' && entry.risk === 'safe'));
});

test('supported baud cases cover every non-default index in pair mode', () => {
  const cases = selectCases(loadCases(), { stage: 'baud' });
  assert.deepEqual(cases.slice(0, 7).map(entry => entry.covers.baudIndex), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(cases.at(-1).id, 'test_sync_read_slot_timing_all_bauds');
  assert.ok(cases.every(entry => entry.scope === 'pair' && entry.risk === 'safe'));
});

test('expanded SYNC and staged cases remain separate modules', () => {
  const cases = loadCases();
  assert.equal(selectCases(cases, { stage: 'sync' }).length, 12);
  assert.ok(selectCases(cases, { stage: 'sync' })
    .some(entry => entry.id === 'test_sync_read_register_bounds'));
  assert.ok(selectCases(cases, { stage: 'sync' })
    .some(entry => entry.id === 'test_sync_write_selected_id_multibyte_isolation'));
  assert.deepEqual(selectCases(cases, { stage: 'staged' }).map(entry => entry.id),
    ['test_staged_multiregister_ram_write',
      'test_staged_write_replacement_and_short_args',
      'test_staged_write_discarded_by_reset']);
});

test('protection threshold cases stay torque-off and isolated by sensor path', () => {
  const cases = selectCases(loadCases(), { stage: 'protection' });
  assert.deepEqual(cases.map(entry => entry.id), [
    'test_overvoltage_threshold', 'test_undervoltage_threshold',
    'test_overtemperature_threshold', 'test_overtemperature_hysteresis_boundary',
  ]);
  assert.ok(cases.every(entry => entry.scope === 'device' && entry.risk === 'safe'));
});

test('work-mode transition case is distinct from motion behavior', () => {
  const cases = selectCases(loadCases(), { stage: 'modes' });
  assert.deepEqual(cases.map(entry => entry.id), ['test_work_mode_transitions_torque_off']);
  assert.equal(cases[0].risk, 'safe');
  assert.deepEqual(cases[0].covers.modes, [0, 1, 2, 3]);
});

test('driven work modes require the motion safety gate', () => {
  const cases = selectCases(loadCases(), { stage: 'mode-motion' });
  assert.deepEqual(cases.map(entry => entry.id), ['test_mode0_position_motion',
    'test_mode1_velocity_reversal', 'test_mode2_pwm_reversal',
    'test_mode3_relative_motion', 'test_driven_work_mode_transition_matrix']);
  assert.ok(cases.every(entry => entry.risk === 'motion' && entry.scope === 'device'));
});

test('long-swipe profiles cover direction and acceleration separately', () => {
  const cases = selectCases(loadCases(), { stage: 'profiles' });
  assert.deepEqual(cases.map(entry => entry.covers.swipeTicks),
    [1600, 1600, 5000, -1600, -5000, 1600, 1600, 5000, -5000, 5000, -5000,
      2400, 2400, 2400, 2400]);
  assert.deepEqual(cases.map(entry => entry.covers.acceleration),
    [8, 30, 80, 30, 80, 5, 80, 100, 100, 100, 100, 10, 80, 10, 80]);
  assert.deepEqual(cases.map(entry => entry.covers.torqueLimit),
    [650, 650, 650, 650, 650, 650, 650, 650, 650, 1000, 1000,
      650, 650, 650, 650]);
  assert.ok(cases.every(entry => entry.risk === 'motion' && entry.scope === 'device'));
  const matrix = selectCases(loadCases(), { stage: 'motion-matrix' });
  assert.deepEqual(matrix.map(entry => entry.covers.speedTicksPerSecond),
    [900, 900, 3000, 3000]);
});

test('value and persistence matrices stay isolated and appropriately gated', () => {
  const cases = loadCases();
  const values = selectCases(cases, { stage: 'value-matrix' });
  assert.deepEqual(values.map(entry => entry.covers.registers[0]),
    [21, 22, 23, 24, 25, 41, 48]);
  assert.ok(values.every(entry => entry.risk === 'safe' && !entry.requiresPersistenceWrite));
  const persisted = selectCases(cases, { stage: 'persistence-matrix' });
  assert.deepEqual(persisted.map(entry => entry.covers.registers[0]),
    [20, 24, 26, 30, 78, 79, 85, 86]);
  assert.ok(persisted.every(entry => entry.requiresPersistenceWrite && entry.risk === 'safe'));
});

test('torque cap and driven current protection are separately gated', () => {
  const cases = loadCases();
  const torque = selectCases(cases, { stage: 'torque' });
  const current = selectCases(cases, { stage: 'current-protection' });
  assert.deepEqual(torque.map(entry => entry.id), ['test_runtime_torque_limit_and_gate']);
  assert.deepEqual(current.map(entry => entry.id), ['test_overcurrent_shutdown_under_swipe',
    'test_overcurrent_duration_scaling_under_swipe']);
  assert.ok(current.every(entry => entry.requiresCurrentProtection));
  assert.ok(current.every(entry => entry.risk === 'motion'));
  assert.equal(parse(['--port', '/dev/test', '--stage', 'current-protection',
    '--allow-motion', '--allow-current-protection']).allowCurrentProtection, true);
});

test('reset-loaded persistence cases require their own opt-in', () => {
  const cases = selectCases(loadCases(), { stage: 'persistence' });
  assert.deepEqual(cases.map(entry => entry.id), [
    'test_max_torque_reset_boot_copy', 'test_pid_gain_persistence_latency',
    'test_max_velocity_reset_boot_cap', 'test_motion_rate_reset_boot_scale',
    'test_minimum_velocity_reset_boot_floor',
  ]);
  assert.ok(cases.every(entry => entry.requiresPersistenceWrite));
  assert.equal(parse(['--port', '/dev/test', '--stage', 'persistence',
    '--allow-persistence-write']).allowPersistenceWrite, true);
});

test('EEPROM timing compares fast and slow phases rather than a pooled median', () => {
  const entry = loadCases().find(item => item.id === 'test_pid_gain_persistence_latency');
  const observation = (fast, slow) => ({ evidence: { phaseSummary: {
    fast: { medianMs: fast }, slow: { medianMs: slow },
  } } });
  assert.equal(entry.compare(observation(2.5, 35), observation(2.6, 41)).matched, true);
  assert.equal(entry.compare(observation(2.5, 35), observation(2.6, 60)).matched, false);
});

test('wire timing is RAM-only and EEPROM timing is persistence-gated', () => {
  const cases = loadCases();
  assert.deepEqual(selectCases(cases, { stage: 'timing' }).map(entry => entry.id),
    ['test_wire_response_latency_baseline']);
  const eeprom = selectCases(cases, { stage: 'eeprom-timing' });
  assert.deepEqual(eeprom.map(entry => entry.id), ['test_pid_gain_persistence_latency',
    'test_persistence_commit_under_bus_traffic']);
  assert.ok(eeprom.every(entry => entry.requiresPersistenceWrite));
});

test('calibration alarm case is isolated and requires motion and persistence opt-ins', () => {
  const cases = selectCases(loadCases(), { stage: 'calibration' });
  assert.deepEqual(cases.map(entry => entry.id),
    ['test_calibration_explicit_signed_targets',
      'test_calibration_encoder_alarm_after_offset_restore']);
  assert.equal(cases[0].risk, 'safe');
  assert.equal(cases[1].risk, 'motion');
  assert.ok(cases.every(entry => entry.requiresPersistenceWrite));
  assert.equal(parse(['--port', '/dev/test', '--stage', 'calibration']).stage,
    'calibration');
  const observation = classifications => ({ evidence: { iterations: classifications.map(
    ([target, classification, firstAlarmPhase]) => ({ target, classification, firstAlarmPhase })) } });
  const factory = observation([[2048, 'healthy throughout'], [4094, 'healthy throughout'],
    [4094, 'transient alarm that cleared without reset', 'after immediate reset']]);
  const reordered = observation([[2048, 'healthy throughout'],
    [2048, 'transient alarm that cleared without reset', 'first observation window'],
    [4094, 'healthy throughout']]);
  const changed = observation([[2048, 'healthy throughout'],
    [4094, 'alarm newly appeared after malformed 0x0B', 'malformed response'],
    [4094, 'healthy throughout']]);
  assert.equal(cases[1].compare(factory, reordered).matched, true);
  assert.equal(cases[1].compare(factory, changed).matched, false);
});

test('paced rapid writes validate a goal-last factory stimulus', () => {
  const entry = loadCases().find(item => item.id === 'test_paced_atomic_register_writes');
  assert.equal(entry.requiresFactoryEffect, true);
  const observation = exact => ({ exact });
  assert.equal(entry.validateFactoryStimulus(observation({ fourRegistersChanged: true,
    torqueEnabled: true, profileStarted: true, shaftMoved: true })).valid, true);
  assert.equal(entry.validateFactoryStimulus(observation({ fourRegistersChanged: true,
    torqueEnabled: false, profileStarted: false, shaftMoved: false })).valid, false);
});

test('rapid stage covers acknowledged write order and gap effects', () => {
  const cases = selectCases(loadCases(), { stage: 'rapid' });
  assert.deepEqual(cases.map(entry => entry.id), ['test_rapid_atomic_register_writes',
    'test_paced_atomic_register_writes', 'test_motion_write_order_gap_matrix']);
});

test('calibration classification distinguishes reset-cleared from spontaneous alarm recovery', () => {
  const { classify } = require('../src/calibration-classify');
  const point = (atMs, sensorStatus = 0) => ({ atMs, sensorStatus, correction: 0, torque: 0 });
  const iteration = {
    before: point(0), calibrationResponseAtMs: 1, calibrationResponseStatus: 0,
    afterZeroParameterCalibration: point(2), calibrationReset: { sentAtMs: 3 },
    afterCalibrationReset: point(10), preRestoreWindow: [], afterPreRestoreWait: point(10),
    restoreResponseAtMs: 11, restoreResponseStatus: 0,
    afterRestoreWrite: point(12, 2), immediateReset: { sentAtMs: 13 },
    afterImmediateReset: point(20), firstWindow: [], preMalformed: point(21),
    malformedResponseAtMs: 22, malformedResponseStatus: 0,
    postMalformed: point(23), secondWindow: [], afterWait: point(24),
  };
  assert.equal(classify(iteration).classification, 'alarm absent after reset; spontaneous recovery not established');
  iteration.immediateReset.sentAtMs = 11.5;
  assert.equal(classify(iteration).classification, 'transient alarm that cleared without reset');
});

test('driven shutdown-mask cases isolate voltage and temperature alarms', () => {
  const cases = selectCases(loadCases(), { stage: 'drive-protection' });
  assert.deepEqual(cases.map(entry => entry.id), [
    'test_overvoltage_shutdown_mask_under_drive',
    'test_undervoltage_shutdown_mask_under_drive',
    'test_overtemperature_shutdown_mask_under_drive',
    'test_masked_overvoltage_profile_reanchor',
  ]);
  assert.ok(cases.every(entry => entry.risk === 'motion' && entry.scope === 'device'));
});

test('register behavior cases remain isolated with per-case motion gating', () => {
  const cases = selectCases(loadCases(), { stage: 'register-behavior' });
  assert.deepEqual(cases.map(entry => entry.id), [
    'test_position_offset_live_write',
    'test_position_offset_partial_writes',
    'test_config_motor_polarity_reverses_direction',
    'test_config_encoder_polarity_reverses_direction',
    'test_position_p_gain_contrast', 'test_velocity_p_gain_contrast',
    'test_position_angle_limits', 'test_position_scaling_divisor',
    'test_output_punch_contrast', 'test_config_velocity_telemetry_scale',
    'test_config_position_display_wrap', 'test_config_negative_position_display_wrap',
    'test_position_offset_profile_reanchor',
    'test_position_p_transfer_matrix',
    'test_position_deadzone_directions', 'test_position_derivative_term',
    'test_position_integral_clamp', 'test_velocity_integral_term',
    'test_acceleration_limit_and_default', 'test_zero_velocity_config_policy',
    'test_cached_motion_controls_ram_only', 'test_live_motion_rate_telemetry_and_moving',
  ]);
  assert.ok(cases.every(entry => entry.scope === 'device'));
  assert.equal(cases[0].risk, 'safe');
  assert.ok(cases.slice(0, 2).every(entry => entry.risk === 'safe'));
  assert.ok(cases.slice(2).every(entry => entry.risk === 'motion'));
});

test('dead-zone comparison checks blocked output, not just treatment delta', () => {
  const entry = loadCases().find(item => item.id === 'test_position_deadzone_directions');
  const trial = (direction, open, blocked) => ({ direction,
    open: { peakPwm: open }, blocked: { peakPwm: blocked } });
  const factory = { evidence: { trials: [trial(1, 100, 0), trial(-1, 90, 0)] } };
  const candidate = { evidence: { trials: [trial(1, 105, 50), trial(-1, 95, 50)] } };
  const result = entry.compare(factory, candidate);
  assert.equal(result.matched, false);
  assert.deepEqual(result.checks.filter(check => !check.matched).map(check => check.name),
    ['positive blocked PWM', 'negative blocked PWM']);
});

test('P matrix comparison detects output independent of gain and settings drift', () => {
  const entry = loadCases().find(item => item.id === 'test_position_p_transfer_matrix');
  const trial = (residual, settings) => ({ speed: 1200, direction: 1,
    distance: 1024, gain: 0, medianPwmResidual: residual, p90PwmResidual: residual,
    travel: residual, peakSpeed: residual, settings });
  const factory = { evidence: { trials: [trial(0, { 21: 0, 22: 0 })] } };
  const candidate = { evidence: { trials: [trial(240, { 21: 0, 22: 0 })] } };
  assert.equal(entry.compare(factory, candidate).matched, false);
  candidate.evidence.trials[0] = trial(0, { 21: 0, 22: 1 });
  assert.deepEqual(entry.compare(factory, candidate).checks.filter(check => !check.matched)
    .map(check => check.name), ['1200/+1024/P0 settings']);
});

test('CLI uses current IDs and validates port and risk options', () => {
  const options = parse(['--port', '/dev/test']);
  assert.equal(options.factoryId, 1);
  assert.equal(options.candidateId, 2);
  assert.equal(options.mode, 'pair');
  assert.throws(() => parse([]), /--port is required/);
  assert.throws(() => parse(['--port', '/dev/test', '--factory-id', '2']), /IDs must differ/);
});

test('position comparison uses relative displacement across 4096 wrap', () => {
  assert.equal(positionDelta(4094, 4094, false), 0);
  assert.equal(positionDelta(42, 4094, false), 44);
  assert.equal(positionDelta(124, 4051, false), 169); // Encoder-polarity pulse crossed wrap.
  assert.equal(positionDelta(4094, 42, false), -44);
  assert.equal(positionDelta(-12, -20, true), 8);
  assert.equal(nearbyLogicalPosition(4094, false), -2);
  assert.deepEqual(encodeSign15(254), [254, 0]);
  assert.deepEqual(encodeSign15(-2), [2, 128]);
});

test('negative calibration targets use signed little-endian wire encoding', async () => {
  const rig = Object.create(Rig.prototype);
  rig.command = async (id, instruction, parameters) => ({ id, instruction, parameters });
  assert.deepEqual((await rig.setOffset(2, -1)).parameters, [0xff, 0xff]);
  assert.deepEqual((await rig.setOffset(2, -2048)).parameters, [0x00, 0xf8]);
  assert.deepEqual((await rig.setOffset(2, -4095)).parameters, [0x01, 0xf0]);
});
