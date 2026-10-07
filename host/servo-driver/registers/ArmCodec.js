'use strict';

const ADDRESS = Object.freeze({ capabilities: 0x90, config: 0xA0,
  select: 0xB8, arm: 0xBA, velocityFeedforward: 0xA3,
  feedback: 0xC1, tuning: 0xC2 });
const MAX_ACCELERATION_COUNTS_S2 = 30000;

function integer(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in ${min}..${max}`);
  }
  return value;
}

function encodeConfig(config) {
  const result = Buffer.alloc(26);
  const fields = [
    ['kpQ8', 0, 0, 65535], ['kdQ8', 2, 0, 65535],
    ['kiQ8', 4, 0, 65535], ['integralLimit', 6, 0, 1000],
    ['effortLimit', 8, 1, 1000], ['velocityLimit', 10, 1, 65535],
    ['accelerationLimit', 12, 1, MAX_ACCELERATION_COUNTS_S2], ['timeoutMs', 14, 20, 2000],
  ];
  for (const [name, offset, min, max] of fields) {
    result.writeUInt16LE(integer(config[name], name, min, max), offset);
  }
  if (config.integralLimit > config.effortLimit) {
    throw new RangeError('integralLimit exceeds effortLimit');
  }
  result[17] = integer(config.rampTimeMs, 'rampTimeMs', 1, 255);
  result[16] = integer(config.velocityFilterQ8, 'velocityFilterQ8', 1, 255);
  result.writeInt32LE(integer(config.positionMinQ8, 'positionMinQ8',
    -32767*256, 32767*256), 18);
  result.writeInt32LE(integer(config.positionMaxQ8, 'positionMaxQ8',
    -32767*256, 32767*256), 22);
  if (config.positionMinQ8 >= config.positionMaxQ8) {
    throw new RangeError('positionMinQ8 must be smaller than positionMaxQ8');
  }
  return result;
}

function decodeConfig(data) {
  exact(data, 26);
  return {
    kpQ8: data.readUInt16LE(0), kdQ8: data.readUInt16LE(2),
    kiQ8: data.readUInt16LE(4), integralLimit: data.readUInt16LE(6),
    effortLimit: data.readUInt16LE(8), velocityLimit: data.readUInt16LE(10),
    accelerationLimit: data.readUInt16LE(12), timeoutMs: data.readUInt16LE(14),
    velocityFilterQ8: data[16], rampTimeMs: data[17],
    positionMinQ8: data.readInt32LE(18), positionMaxQ8: data.readInt32LE(22),
  };
}

// The session is shared; profile commits can give each axis a different sequence.
function encodeTargets(entries, session) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 6 ||
      new Set(entries.map(entry => entry.id)).size !== entries.length)
    throw new RangeError('One to six unique arm target entries are required');
  const out = Buffer.alloc(2 + entries.length * 11);
  out.writeUInt16LE(integer(session, 'session', 1, 65535));
  entries.forEach(({ id, target }, index) => {
    rejectObsolete(target);
    if ('session' in target) throw new RangeError('Session belongs to the group, not each target');
    const offset = 2 + index * 11;
    out[offset] = integer(id, 'id', 1, 253);
    out.writeUInt16LE(integer(target.sequence, 'sequence', 1, 65535), offset + 1);
    out.writeInt32LE(integer(target.positionQ8, 'positionQ8', -32767*256, 32767*256), offset + 3);
    out.writeUInt16LE(integer(target.speedLimit, 'speedLimit', 1, 65535), offset + 7);
    out.writeUInt16LE(integer(target.acceleration, 'acceleration', 1, MAX_ACCELERATION_COUNTS_S2), offset + 9);
  });
  return out;
}

// Reject obsolete inputs, including zero, instead of silently dropping a caller's FF.
function rejectObsolete(command) {
  for (const key of ['feedforward', 'dynamicEffort', 'braking']) {
    if (key in command) throw new RangeError(`${key} was removed; arm v4 uses symmetric acceleration, gravity and local velocity gains`);
  }
}

function encodeVelocityFeedforward(config) {
  const out = Buffer.alloc(6);
  for (const [key, offset, max] of [['positiveGainQ8', 0, 65535],
    ['negativeGainQ8', 2, 65535], ['effortLimit', 4, 1000]])
    out.writeUInt16LE(integer(config[key], key, 0, max), offset);
  if (!config.effortLimit && (config.positiveGainQ8 || config.negativeGainQ8))
    throw new RangeError('Zero velocity FF cap requires zero gains');
  return out;
}

function decodeVelocityFeedforward(data) {
  exact(data, 6);
  return { positiveGainQ8: data.readUInt16LE(0), negativeGainQ8: data.readUInt16LE(2),
    effortLimit: data.readUInt16LE(4) };
}

function encodeGravity(command) {
  rejectObsolete(command);
  const out = Buffer.alloc(10);
  for (const [key, offset, min, max] of [['session', 0, 1, 65535],
    ['sequence', 2, 1, 65535], ['slewEffortPerS', 6, 1, 10000], ['ttlMs', 8, 20, 500]])
    out.writeUInt16LE(integer(command[key], key, min, max), offset);
  out.writeInt16LE(integer(command.gravityEffort, 'gravityEffort', -1000, 1000), 4);
  return out;
}

// Both reads are frozen firmware samples. A clear fresh flag means historical
// control data; sensor-only samples still carry age and temperature validity.
function decodeFeedback(data) {
  exact(data, 32);
  const flags = data.readUInt16LE(12);
  if (flags & 0xA000) throw new RangeError('Unknown arm feedback flags');
  return {
    sampleMs: data.readUInt32LE(0), sampleSequence: data.readUInt16LE(4),
    session: data.readUInt16LE(6), acceptedSequence: data.readUInt16LE(8),
    gravitySequence: data.readUInt16LE(10),
    fresh: !!(flags & 1), active: !!(flags & 2), holding: !!(flags & 4),
    saturated: !!(flags & 8), driveEnabled: !!(flags & 16), armed: !!(flags & 32),
    expired: !!(flags & 64), outputReady: !!(flags & 128),
    gravityReceived: !!(flags & 256), gravityStale: !!(flags & 512),
    temperatureValid: !!(flags & 1024), temperatureCandidatePending: !!(flags & 2048),
    running: !!(flags & 4096), selected: !!(flags & 16384),
    measuredPositionQ8: data.readInt32LE(14), measuredVelocityQ8PerS: data.readInt32LE(18),
    appliedEffort: data.readInt16LE(22), currentAdcDelta: data.readInt16LE(24),
    voltageRaw: data[26], temperatureValidated: data[27], faults: data[28],
    activeProfile: data[29], ageMs: data.readUInt16LE(30),
  };
}

function decodeTuning(data) {
  exact(data, 56);
  return { ...decodeFeedback(data.subarray(0, 32)),
    referencePositionQ8: data.readInt32LE(32), referenceVelocityQ8PerS: data.readInt32LE(36),
    requestedEffort: data.readInt16LE(40), pTerm: data.readInt16LE(42),
    dTerm: data.readInt16LE(44), iTerm: data.readInt16LE(46),
    gravityEffort: data.readInt16LE(48), velocityFeedforward: data.readInt16LE(50),
    transitionBias: data.readInt16LE(52), overrunCount: data.readUInt16LE(54) };
}

function exact(data, length) {
  if (!Buffer.isBuffer(data) || data.length !== length) {
    throw new RangeError(`Expected ${length} arm data bytes`);
  }
}

module.exports = { ADDRESS, encodeConfig, decodeConfig, encodeTargets,
  encodeVelocityFeedforward, decodeVelocityFeedforward, encodeGravity, decodeFeedback, decodeTuning };
