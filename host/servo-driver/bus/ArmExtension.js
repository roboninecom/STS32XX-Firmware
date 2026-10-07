'use strict';

const { Instruction, BROADCAST_ID } = require('../protocol/constants');
const { Priority } = require('../session/RequestScheduler');
const Codec = require('../registers/ArmCodec');

class ArmExtension {
  #capabilities = new Map();
  #generation = 0;

  constructor(bus) {
    this.bus = bus;
    bus.on?.('discovery', () => this.invalidate());
    bus.protocol.on?.('reset', id => this.invalidate(id === BROADCAST_ID ? undefined : id));
    const transport = bus.protocol.scheduler?.transport;
    for (const event of ['connect', 'disconnect', 'fault'])
      transport?.on(event, () => this.invalidate());
  }

  // Explicitly call after externally performed power cycles/image changes too.
  invalidate(id) {
    ++this.#generation;
    if (id === undefined) this.#capabilities.clear();
    else this.#capabilities.delete(id);
  }

  async #requireV4(id, options) {
    this.#id(id);
    const caps = this.#capabilities.get(id) ?? await this.capabilities(id, options);
    if (caps?.major !== 4) throw new Error(`Servo ${id}: arm v4 required`);
  }

  #id(id) {
    if (!this.bus.has(id)) throw new RangeError(`Servo ${id} is not discovered`);
    return id;
  }

  async capabilities(id, options = {}) {
    this.#capabilities.delete(id);
    const generation = this.#generation;
    const bytes = await this.#read(id, Codec.ADDRESS.capabilities, 16, options);
    if (generation !== this.#generation) throw new Error('Capability discovery invalidated; rediscover before use');
    if (bytes.length !== 16) throw new Error('Invalid arm capability length');
    if (bytes.toString('ascii', 0, 4) !== 'ARMC') return null;
    const caps = Object.freeze({ major: bytes[4], minor: bytes[5], tickMs: bytes[7] });
    this.#capabilities.set(id, caps);
    return caps;
  }

  async configuration(id, options = {}) {
    return Codec.decodeConfig(await this.#read(id, Codec.ADDRESS.config, 26, options));
  }

  async configure(id, config, options = {}) {
    const encoded = Codec.encodeConfig(config);
    await this.#write(id, Codec.ADDRESS.config, encoded, options);
    const readback = await this.#read(id, Codec.ADDRESS.config, 26, options);
    if (!encoded.equals(readback)) throw new Error('Arm config verification failed');
    return Codec.decodeConfig(readback);
  }

  select(id, enabled, options = {}) {
    return this.#write(id, Codec.ADDRESS.select, Buffer.from([enabled ? 1 : 0]), options);
  }

  arm(id, session, options = {}) {
    const bytes = Buffer.alloc(2);
    bytes.writeUInt16LE(session);
    return this.#write(id, Codec.ADDRESS.arm, bytes, options);
  }

  async setTargets(entries, session, options = {}) {
    // Encode every entry before any I/O. A successful broadcast means sent;
    // callers verify acceptance from each servo's subsequent C1/C2 sample.
    const payload = Codec.encodeTargets(entries, session);
    for (const { id } of entries) this.#id(id);
    for (const { id } of entries) await this.#requireV4(id, options);
    return this.bus.protocol.armCommand(BROADCAST_ID, Instruction.ARM_TARGETS,
      payload, { priority: Priority.MOTION, ...options });
  }

  async abort(id, session, options = {}) {
    await this.#requireV4(id, options);
    const bytes = Buffer.alloc(2);
    bytes.writeUInt16LE(session);
    return this.bus.protocol.armCommand(this.#id(id), Instruction.ARM_ABORT,
      bytes, { priority: Priority.CRITICAL, ...options });
  }

  async heartbeat(id, session, options = {}) {
    await this.#requireV4(id, options);
    const bytes = Buffer.alloc(2);
    bytes.writeUInt16LE(session);
    return this.bus.protocol.armCommand(this.#id(id), Instruction.ARM_HEARTBEAT,
      bytes, { priority: Priority.MOTION, ...options });
  }

  async stopPowered(id, session, options = {}) {
    await this.#requireV4(id, options);
    if (!Number.isInteger(session) || session < 1 || session > 65535)
      throw new RangeError('Invalid session');
    const bytes = Buffer.alloc(2);
    bytes.writeUInt16LE(session);
    return this.bus.protocol.armCommand(this.#id(id), Instruction.ARM_STOP,
      bytes, { priority: Priority.CRITICAL, ...options });
  }

  async profiles(id, options = {}) {
    await this.#requireV4(id, options);
    return this.#readProfiles(id, options);
  }

  async #readProfiles(id, options) {
    const b = await this.#read(id, 0xA1, 32, options);
    return [0, 1].map(slot => {
      const o = slot * 16;
      return { slot, generation: b.readUInt16LE(o), kpQ8: b.readUInt16LE(o+2),
        kdQ8: b.readUInt16LE(o+4), kiQ8: b.readUInt16LE(o+6),
        integralLimit: b.readUInt16LE(o+8), effortLimit: b.readUInt16LE(o+10),
        velocityFilterQ8: b[o+12], active: !!b[o+14], transitioning: !!b[o+15] };
    });
  }

  async stageProfile(id, session, generation, profile, options = {}) {
    await this.#requireV4(id, options);
    // Reuse validated configuration encodings; profile never changes the envelope.
    const config = Codec.encodeConfig({ ...profile, velocityLimit: 1,
      accelerationLimit: 1, rampTimeMs: 30, timeoutMs: 20, positionMinQ8: 0, positionMaxQ8: 256 });
    for (const v of [session, generation]) if (!Number.isInteger(v) || v<1 || v>65535)
      throw new RangeError('Invalid profile identity');
    const b = Buffer.alloc(17);
    b.writeUInt16LE(session); b[2]=1; b.writeUInt16LE(generation,3);
    config.copy(b,5,0,10); b[15]=config[16];
    await this.bus.protocol.armCommand(this.#id(id), Instruction.ARM_PROFILE_STAGE, b, options);
    const readback = (await this.#readProfiles(id,options))[1];
    if (readback.generation !== generation ||
        ['kpQ8','kdQ8','kiQ8','integralLimit','effortLimit','velocityFilterQ8']
          .some(k => readback[k] !== profile[k])) throw new Error('Profile verification failed');
    return readback;
  }

  async commitProfile(id, { session, sequence, slot, generation }, options = {}) {
    await this.#requireV4(id, options);
    for (const [v,min,max] of [[session,1,65535],[sequence,1,65535],
      [slot,0,1],[generation,1,65535]])
      if (!Number.isInteger(v) || v<min || v>max) throw new RangeError('Invalid profile identity');
    const b=Buffer.alloc(7);
    b.writeUInt16LE(session); b.writeUInt16LE(sequence,2);
    b[4]=slot; b.writeUInt16LE(generation,5);
    await this.bus.protocol.armCommand(this.#id(id),Instruction.ARM_PROFILE_COMMIT,
      b,{ priority: Priority.CRITICAL, ...options });
    const readback=(await this.#readProfiles(id,options))[slot];
    if (!readback.active || readback.generation!==generation)
      throw new Error('Profile commit verification failed');
    return readback;
  }

  async velocityFeedforward(id, options = {}) {
    return Codec.decodeVelocityFeedforward(await this.#read(id, Codec.ADDRESS.velocityFeedforward, 6, options));
  }

  async configureVelocityFeedforward(id, config, options = {}) {
    const encoded = Codec.encodeVelocityFeedforward(config);
    await this.#write(id, Codec.ADDRESS.velocityFeedforward, encoded, options);
    const readback = await this.#read(id, Codec.ADDRESS.velocityFeedforward, 6, options);
    if (!encoded.equals(readback)) throw new Error('Velocity FF verification failed');
    return Codec.decodeVelocityFeedforward(readback);
  }

  async updateGravity(id, command, options = {}) {
    const bytes = Codec.encodeGravity(command);
    await this.#requireV4(id, options);
    return this.bus.protocol.armCommand(this.#id(id), Instruction.ARM_GRAVITY,
      bytes, { priority: Priority.MOTION, ...options });
  }

  async feedback(id, options = {}) {
    return Codec.decodeFeedback(await this.#read(id, Codec.ADDRESS.feedback, 32, options));
  }

  async tuning(id, options = {}) {
    return Codec.decodeTuning(await this.#read(id, Codec.ADDRESS.tuning, 56, options));
  }

  async #read(id, address, length, options) {
    if (address !== Codec.ADDRESS.capabilities) await this.#requireV4(id, options);
    return this.bus.protocol.armCommand(this.#id(id), Instruction.ARM_READ,
      Buffer.from([address, length]), { ...options, expectedDataLength: length });
  }

  async #write(id, address, bytes, options) {
    await this.#requireV4(id, options);
    return this.bus.protocol.armCommand(this.#id(id), Instruction.ARM_WRITE,
      Buffer.concat([Buffer.from([address]), bytes]), options);
  }
}

module.exports = { ArmExtension };
