'use strict';
const { EventEmitter } = require('node:events');
const { Replay } = require('../Replay');
const { ArmController } = require('../../../host/arm-control/ArmController');
const { Instruction } = require('../../../host/servo-driver');

const profile = { kpQ8: 256, kdQ8: 32, kiQ8: 0, integralLimit: 0, effortLimit: 100,
  velocityLimit: 500, velocityFilterQ8: 64, gravitySlewEffortPerS: 1000,
  velocityFeedforward: { positiveGainQ8: 0, negativeGainQ8: 0, effortLimit: 0 } };
const configuration = () => ({ followerPort: 'COM4', acceleration: 1000, rampTimeMs: 50,
  joints: [{ leaderId: 1, followerId: 1, mapping: 'angle' }], profiles: { 1: profile },
  replay: { speed: 300, holdMs: 0, moveTimeoutMs: 100, toleranceCounts: 2 } });
function poses(positions = [1500, 2000], ids = [1]) {
  return JSON.stringify({ format: 'sts-poses', version: 1, units: 'encoder-counts', ids,
    poses: positions.map((value, index) => ({ name: `pose-${index + 1}`, positions: Object.fromEntries(ids.map(id => [id, value])),
      capturedAt: '2026-10-24T12:00:00Z', durationMs: 5 })) });
}
function session(config, frames = [{ timestamp: 10, positions: { 1: 1500 } }, { timestamp: 110, positions: { 1: 2000 } }]) {
  return [{ type: 'preflight', config, limits: { leader: { 1: { min: 100, max: 4000, position: 1500 } } } },
    ...frames.map(frame => ({ type: 'command', ...frame }))].map(event => JSON.stringify(event)).join('\n');
}
function rig(raw = poses(), config = configuration(), gravity) {
  const replay = new Replay(raw, config), calls = [], motors = new Map();
  for (const joint of replay.joints) motors.set(joint.followerId, { position: 1000, torque: 0, selected: false, session: 0, sequence: 0 });
  let now = 0, sample = 0;
  const follower = new EventEmitter();
  follower.open = async () => { calls.push({ type: 'open' }); };
  follower.close = async () => { calls.push({ type: 'close' }); follower.emit('disconnect'); };
  follower.bus = { discover: async () => ({ ids: [...motors.keys()], alarms: new Map() }) };
  follower.protocol = {
    read: async (id, address, length) => {
      const motor = motors.get(id), bytes = Buffer.alloc(length);
      if (address === 0) { bytes[8] = 1; bytes[55] = 1; bytes.writeUInt16LE(100, 9); bytes.writeUInt16LE(4000, 11); bytes.writeUInt16LE(motor.position, 56); }
      if (address === 40) bytes[0] = motor.torque;
      if (address === 56) bytes.writeUInt16LE(motor.position);
      return bytes;
    },
    syncRead: async ids => ({ responses: new Map(ids.map(id => { const bytes = Buffer.alloc(2); bytes.writeUInt16LE(motors.get(id).position); return [id, bytes]; })) }),
    write: async (id, address, bytes) => {
      calls.push({ type: 'write', id, address, value: bytes[0] });
      if (address === 40) motors.get(id).torque = bytes[0];
    },
    transaction: async operation => operation(follower.protocol),
    armCommand: async (id, instruction, bytes) => {
      if (instruction === Instruction.ARM_GRAVITY) {
        const motor = motors.get(id);
        motor.gravitySequence = bytes.readUInt16LE(2);
        motor.gravityReceived = true;
        calls.push({ type: 'gravity', id, sequence: motor.gravitySequence, effort: bytes.readInt16LE(4), at: now });
        return;
      }
      for (let offset = 2; offset < bytes.length; offset += 9) {
        const motorId = bytes[offset], motor = motors.get(motorId);
        motor.sequence = bytes.readUInt16LE(offset + 1);
        motor.position = bytes.readInt32LE(offset + 3) / 256;
        calls.push({ type: 'target', id: motorId, position: motor.position,
          sequence: motor.sequence, speed: bytes.readUInt16LE(offset + 7), at: now, session: bytes.readUInt16LE(0) });
      }
    },
    syncWrite: async (address, entries) => {
      if (address === 40) {
        calls.push({ type: 'enable-group', ids: entries.map(e => e.id), at: now });
        for (const { id, data } of entries) { motors.get(id).torque = data[0]; calls.push({ type: 'write', id, address, value: data[0] }); }
        return;
      }
      for (const entry of entries) {
        motors.get(entry.id).position = entry.data.readUInt16LE();
        calls.push({ type: 'target', id: entry.id, position: entry.data.readUInt16LE(), speed: entry.data.readUInt16LE(4), at: now });
      }
    },
  };
  follower.arm = {
    capabilities: async () => ({ major: 9 }),
    configure: async (id, config) => { calls.push({ type: 'configure', id, config }); },
    select: async (id, selected, session) => {
      Object.assign(motors.get(id), { selected, session }); calls.push({ type: 'select', id, selected, session });
    },
    feedback: async id => {
      const motor = motors.get(id);
      return { sampleMs: ++sample, sampleSequence: sample, temperatureValid: true, temperatureValidated: 30,
        ageMs: 0, faults: 0, fresh: true, outputReady: true, driveEnabled: true, selected: motor.selected,
        armed: !!motor.torque, session: motor.session, acceptedSequence: motor.sequence,
        gravityReceived: motor.gravityReceived ?? false, gravitySequence: motor.gravitySequence ?? 0,
        measuredVelocityQ8PerS: 0, measuredPositionQ8: motor.position * 256, running: false };
    },
  };
  const controller = new ArmController({ follower, config, gravity, source: replay, clock: () => now, sleep: async ms => { now += ms; } });
  return { replay, controller, follower, calls, config, motors, advance: ms => { now += ms; } };
}
const targets = r => r.calls.filter(call => call.type === 'target');
const torqueOff = r => r.calls.filter(call => call.type === 'write' && call.address === 40 && call.value === 0);

module.exports = { profile, configuration, poses, session, rig, targets, torqueOff };
