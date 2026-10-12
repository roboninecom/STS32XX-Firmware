'use strict';

const ADDRESS = Object.freeze({ capabilities: 0x90, config: 0xA0,
  select: 0xB8,
  feedback: 0xC1, tuning: 0xC2 });
const MAX_ACCELERATION_COUNTS_S2 = 30000;

function integer(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in ${min}..${max}`);
  }
  return value;
}

function encodeConfig(config) {
  for (const key of ['positionMinQ8', 'positionMaxQ8'])
    if (key in config) throw new RangeError(`${key} was removed; extension uses saved legacy position limits`);
  if ('timeoutMs' in config) throw new RangeError('Command timeout was removed; targets persist until replaced');
  const result = Buffer.alloc(24);
  const fields = [
    ['kpQ8', 0, 0, 65535], ['kdQ8', 2, 0, 65535],
    ['kiQ8', 4, 0, 65535], ['integralLimit', 6, 0, 1000],
    ['effortLimit', 8, 1, 1000], ['velocityLimit', 10, 1, 65535],
    ['accelerationLimit', 12, 1, MAX_ACCELERATION_COUNTS_S2],
    ['gravitySlewEffortPerS', 22, 1, 10000],
  ];
  for (const [name, offset, min, max] of fields) {
    result.writeUInt16LE(integer(config[name], name, min, max), offset);
  }
  if (config.integralLimit > config.effortLimit) {
    throw new RangeError('integralLimit exceeds effortLimit');
  }
  result[15] = integer(config.rampTimeMs, 'rampTimeMs', 1, 255);
  result[14] = integer(config.velocityFilterQ8, 'velocityFilterQ8', 1, 255);
  const ff = config.velocityFeedforward;
  if (!ff || typeof ff !== 'object') throw new RangeError('Explicit velocityFeedforward settings required');
  for (const [key, offset, max] of [['positiveGainQ8', 16, 65535],
    ['negativeGainQ8', 18, 65535], ['effortLimit', 20, config.effortLimit]])
    result.writeUInt16LE(integer(ff[key], key, 0, max), offset);
  if (!ff.effortLimit && (ff.positiveGainQ8 || ff.negativeGainQ8))
    throw new RangeError('Zero velocity FF cap requires zero gains');
  return result;
}

function decodeConfig(data) {
  exact(data, 24);
  return {
    kpQ8: data.readUInt16LE(0), kdQ8: data.readUInt16LE(2),
    kiQ8: data.readUInt16LE(4), integralLimit: data.readUInt16LE(6),
    effortLimit: data.readUInt16LE(8), velocityLimit: data.readUInt16LE(10),
    accelerationLimit: data.readUInt16LE(12),
    velocityFilterQ8: data[14], rampTimeMs: data[15],
    velocityFeedforward: {positiveGainQ8: data.readUInt16LE(16),
      negativeGainQ8: data.readUInt16LE(18), effortLimit: data.readUInt16LE(20)},
    gravitySlewEffortPerS: data.readUInt16LE(22),
  };
}

// The session is shared; each servo tracks its own accepted target sequence.
function encodeTargets(entries, session) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 6 ||
      new Set(entries.map(entry => entry.id)).size !== entries.length)
    throw new RangeError('One to six unique arm target entries are required');
  const out = Buffer.alloc(2 + entries.length * 9);
  out.writeUInt16LE(integer(session, 'session', 1, 65535));
  entries.forEach(({ id, target }, index) => {
    rejectObsolete(target);
    if ('acceleration' in target) throw new RangeError('Target acceleration was removed; use configuration accelerationLimit');
    if ('session' in target) throw new RangeError('Session belongs to the group, not each target');
    const offset = 2 + index * 9;
    out[offset] = integer(id, 'id', 1, 253);
    out.writeUInt16LE(integer(target.sequence, 'sequence', 0, 65535), offset + 1);
    out.writeInt32LE(integer(target.positionQ8, 'positionQ8', -32767*256, 32767*256), offset + 3);
    out.writeUInt16LE(integer(target.speedLimit, 'speedLimit', 1, 65535), offset + 7);
  });
  return out;
}

// Reject obsolete inputs, including zero, instead of silently dropping a caller's FF.
function rejectObsolete(command) {
  for (const key of ['feedforward', 'dynamicEffort', 'braking']) {
    if (key in command) throw new RangeError(`${key} was removed; arm v9 uses symmetric acceleration, gravity and local velocity gains`);
  }
}

function encodeGravity(command) {
  rejectObsolete(command);
  if ('ttlMs' in command) throw new RangeError('Gravity TTL was removed; gravity persists until replaced');
  if ('slewEffortPerS' in command) throw new RangeError('Gravity slew moved to configuration gravitySlewEffortPerS');
  const out = Buffer.alloc(6);
  for (const [key, offset, min, max] of [['session', 0, 1, 65535],
    ['sequence', 2, 0, 65535]])
    out.writeUInt16LE(integer(command[key], key, min, max), offset);
  out.writeInt16LE(integer(command.gravityEffort, 'gravityEffort', -1000, 1000), 4);
  return out;
}

// Both reads are frozen firmware samples. A clear fresh flag means historical
// control data; sensor-only samples still carry age and temperature validity.
function decodeFeedback(data) {
  exact(data, 32);
  if (data[29] !== 0) throw new RangeError('Reserved arm feedback byte must be zero');
  const flags = data.readUInt16LE(12);
  if (flags & 0xAA44) throw new RangeError('Unknown arm feedback flags');
  return {
    sampleMs: data.readUInt32LE(0), sampleSequence: data.readUInt16LE(4),
    session: data.readUInt16LE(6), acceptedSequence: data.readUInt16LE(8),
    gravitySequence: data.readUInt16LE(10),
    fresh: !!(flags & 1), active: !!(flags & 2),
    saturated: !!(flags & 8), driveEnabled: !!(flags & 16), armed: !!(flags & 32),
    outputReady: !!(flags & 128),
    gravityReceived: !!(flags & 256),
    temperatureValid: !!(flags & 1024),
    running: !!(flags & 4096), selected: !!(flags & 16384),
    measuredPositionQ8: data.readInt32LE(14), measuredVelocityQ8PerS: data.readInt32LE(18),
    appliedEffort: data.readInt16LE(22), currentAdcDelta: data.readInt16LE(24),
    voltageRaw: data[26], temperatureValidated: data[27], faults: data[28],
    ageMs: data.readUInt16LE(30),
  };
}

function decodeTuning(data) {
  exact(data, 54);
  return { ...decodeFeedback(data.subarray(0, 32)),
    referencePositionQ8: data.readInt32LE(32), referenceVelocityQ8PerS: data.readInt32LE(36),
    requestedEffort: data.readInt16LE(40), pTerm: data.readInt16LE(42),
    dTerm: data.readInt16LE(44), iTerm: data.readInt16LE(46),
    gravityEffort: data.readInt16LE(48), velocityFeedforward: data.readInt16LE(50),
    overrunCount: data.readUInt16LE(52) };
}

function exact(data, length) {
  if (!Buffer.isBuffer(data) || data.length !== length) {
    throw new RangeError(`Expected ${length} arm data bytes`);
  }
}

module.exports = { ADDRESS, encodeConfig, decodeConfig, encodeTargets,
  encodeGravity, decodeFeedback, decodeTuning };
