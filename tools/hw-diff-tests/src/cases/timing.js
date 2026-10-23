'use strict';

const assert = require('node:assert/strict');
const { withPersistedSettings } = require('../persistence');
const { setTimeout: delay } = require('node:timers/promises');
const { PacketEncoder, Instruction } = require('../../../../host/servo-driver');
const { CleanupError } = require('../errors');
const { persistentBytes } = require('../register-image');

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(fraction * sorted.length) - 1];
}

function summarize(samples) {
  return { count: samples.length, medianMs: percentile(samples, 0.5),
    p90Ms: percentile(samples, 0.9), maxMs: Math.max(...samples) };
}

function lastTiming(rig, expectedLabel) {
  const event = rig.events.at(-1);
  assert.equal(event?.label, expectedLabel);
  assert.equal(event.outcome, 'response');
  assert.ok(Number.isFinite(event.timingMs.matchedFrame), `${expectedLabel} lacks frame timing`);
  return { firstRxMs: event.timingMs.firstRx, matchedFrameMs: event.timingMs.matchedFrame,
    writeDrainMs: event.timingMs.writeDrain };
}

async function wireBaseline({ rig, ids }) {
  const before = new Map();
  const samples = Object.fromEntries(ids.map(id => [id, { ping: [], read1: [], read87: [], write: [] }]));
  for (const id of ids) {
    const snapshot = await rig.read(id, 0, 87);
    assert.equal(snapshot[40], 0, `servo ${id} torque must be off`);
    assert.equal(snapshot[55], 1, `servo ${id} persistence must be locked`);
    before.set(id, snapshot);
  }
  for (let round = 0; round < 24; round++) {
    const order = round % 2 ? [...ids].reverse() : ids;
    for (const id of order) {
      await rig.ping(id);
      samples[id].ping.push(lastTiming(rig, `ping:${id}`));
      await rig.read(id, 41, 1);
      samples[id].read1.push(lastTiming(rig, `read:${id}:41:1`));
      await rig.read(id, 0, 87);
      samples[id].read87.push(lastTiming(rig, `read:${id}:0:87`));
      await rig.write(id, 41, [before.get(id)[41]]);
      samples[id].write.push(lastTiming(rig, `write:${id}:41`));
    }
  }
  const summary = Object.fromEntries(ids.map(id => [id,
    Object.fromEntries(Object.entries(samples[id]).map(([name, values]) =>
      [name, summarize(values.map(value => value.matchedFrameMs))]))]));
  for (const id of ids) {
    const after = await rig.read(id, 0, 87);
    assert.deepEqual(after.subarray(4, 40), before.get(id).subarray(4, 40));
    assert.deepEqual(after.subarray(78, 87), before.get(id).subarray(78, 87));
    assert.equal(after[40], 0);
    assert.equal(after[55], 1);
  }
  const checks = Object.keys(samples[ids[0]]).map(name => {
    const factory = summary[ids[0]][name];
    const candidate = summary[ids[1]][name];
    return { operation: name, factoryMedianMs: factory.medianMs,
      candidateMedianMs: candidate.medianMs, factoryP90Ms: factory.p90Ms,
      candidateP90Ms: candidate.p90Ms,
      withinHostTolerance: Math.abs(factory.medianMs - candidate.medianMs) <= 1.5 &&
        Math.abs(factory.p90Ms - candidate.p90Ms) <= 4 };
  });
  assert.ok(checks.every(check => check.withinHostTolerance),
    `wire response timing differs beyond host tolerance: ${JSON.stringify(checks)}`);
  return { exact: { sampleRounds: 24, matchedWithinHostTolerance: true,
    settingsUnchanged: true }, evidence: { summary, checks, samples } };
}

async function persistenceLatency(context) {
  const { rig, id } = context;
  const before = await rig.read(id, 0, 87);
  assert.equal(before[40], 0, 'persistence timing requires torque off');
  assert.equal(before[55], 1, 'persistence timing requires locked entry');
  const observations = [];
  for (const address of [21, 22, 23]) {
    const marker = before[address] ^ 1;
    const firstEvent = rig.events.length;
    await withPersistedSettings(context, address, [marker], async () => {
      assert.equal((await rig.read(id, address, 1))[0], marker);
    });
    const writes = rig.events.slice(firstEvent).filter(event =>
      event.label === `write:${id}:${address}` && event.outcome === 'response');
    assert.equal(writes.length, 2, `expected change and restoration WRITE at ${address}`);
    observations.push({ address, original: before[address], marker,
      changeAckMs: writes[0].timingMs.matchedFrame,
      restoreAckMs: writes[1].timingMs.matchedFrame });
  }
  const after = await rig.read(id, 0, 87);
  assert.deepEqual(after.subarray(4, 40), before.subarray(4, 40));
  assert.deepEqual(after.subarray(78, 87), before.subarray(78, 87));
  assert.equal(after[40], 0);
  assert.equal(after[55], 1);
  const ack = observations.flatMap(item => [item.changeAckMs, item.restoreAckMs]);
  const fast = observations.map(item => Math.min(item.changeAckMs, item.restoreAckMs));
  const slow = observations.map(item => Math.max(item.changeAckMs, item.restoreAckMs));
  return { exact: { threeBytesPersistedAndRestored: true, torqueOff: true },
    evidence: { observations, ackSummary: summarize(ack),
      phaseSummary: { fast: summarize(fast), slow: summarize(slow) },
      preTestRegisterBytes: before.toString('hex') } };
}

function comparePersistenceLatency(factory, candidate) {
  const checks = ['fast', 'slow'].map(phase => {
    const factoryMs = factory.evidence.phaseSummary[phase].medianMs;
    const candidateMs = candidate.evidence.phaseSummary[phase].medianMs;
    const differenceMs = Math.abs(candidateMs - factoryMs);
    return { name: `${phase} EEPROM WRITE acknowledgement median`,
      factoryMs, candidateMs, differenceMs, toleranceMs: 10,
      matched: differenceMs <= 10 };
  });
  return { matched: checks.every(check => check.matched), checks };
}

async function persistenceTraffic({ rig, id, role }) {
  const before = await rig.read(id, 0, 87);
  assert.equal(before[40], 0, 'persistence traffic requires torque off');
  assert.equal(before[55], 1, 'persistence traffic requires locked entry');
  const address = 21;
  const marker = before[address] ^ 1;
  let operationError;
  let evidence;
  try {
    await rig.write(id, 55, [0]);
    const packets = [PacketEncoder.frame(id, Instruction.WRITE, [address, marker])];
    for (let index = 0; index < 12; index++) {
      packets.push(index % 2 === 0
        ? PacketEncoder.frame(id, Instruction.PING)
        : PacketEncoder.frame(id, Instruction.READ, [56, 2]));
    }
    const capture = await rig.exchange(`persistence-traffic:${id}`,
      Buffer.concat(packets), { kind: 'capture', timeoutMs: 180 });
    await delay(80);
    const live = (await rig.read(id, address, 1))[0];
    assert.equal(live, marker, 'traffic-train persistent write was not applied');
    await rig.write(id, 55, [1]);
    await rig.reset(id);
    const persisted = await rig.read(id, 0, 87);
    assert.equal(persisted[address], marker, 'traffic-train write did not survive reset');
    await rig.ping(id);
    evidence = { role, requests: packets.length, responses: capture.frames.length,
      frames: capture.frames, live, persisted: persisted[address] };
  } catch (error) { operationError = error; }
  try {
    await rig.write(id, 40, [0]);
    await rig.write(id, 55, [0]);
    await rig.write(id, address, [before[address]]);
    await delay(80);
    await rig.write(id, 55, [1]);
    await rig.reset(id);
    const after = await rig.read(id, 0, 87);
    assert.deepEqual(persistentBytes(after), persistentBytes(before),
      'persistence traffic cleanup did not restore settings');
    assert.equal(after[40], 0);
    assert.equal(after[55], 1);
  } catch (cleanupError) {
    throw new CleanupError(`persistence traffic cleanup failed on ID ${id}`,
      operationError, cleanupError);
  }
  if (operationError) throw operationError;
  return { exact: { writePersisted: true, communicationRecovered: true,
    settingsRestored: true }, evidence };
}

module.exports = [
  { id: 'test_wire_response_latency_baseline', scope: 'pair', risk: 'safe',
    stages: ['timing'], covers: { commands: ['PING', 'READ', 'WRITE'],
      timing: ['first-rx', 'complete-response', 'write-drain'], registers: [41] },
    run: wireBaseline },
  { id: 'test_pid_gain_persistence_latency', scope: 'device', risk: 'safe',
    stages: ['eeprom-timing', 'persistence'], requiresPersistenceWrite: true,
    covers: { registers: [21, 22, 23, 55], persistence: ['primary-write', 'reset', 'restore'],
      timing: ['eeprom-write-ack'] },
    compare: comparePersistenceLatency, run: persistenceLatency },
  { id: 'test_persistence_commit_under_bus_traffic', scope: 'device', risk: 'safe',
    stages: ['eeprom-timing', 'persistence-traffic'], requiresPersistenceWrite: true,
    covers: { commands: ['WRITE', 'PING', 'READ', 'SYSTEM_RESET'], registers: [21, 55, 56],
      persistence: ['primary-write', 'traffic', 'reset', 'restore'],
      timing: ['flash-stall-traffic'] },
    compare: (factory, candidate) => {
      const difference = Math.abs(factory.evidence.responses - candidate.evidence.responses);
      return { matched: difference <= 2, checks: [{ name: 'responses retained during commit',
        factory: factory.evidence.responses, candidate: candidate.evidence.responses,
        tolerance: 2, matched: difference <= 2 }] };
    }, run: persistenceTraffic },
];
