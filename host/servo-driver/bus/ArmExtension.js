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

  async #requireV9(id, options) {
    this.#id(id);
    const caps = this.#capabilities.get(id) ?? await this.capabilities(id, options);
    if (caps?.major !== 9) throw new Error(`Servo ${id}: arm v9 required`);
  }

  #id(id) {
    if (!this.bus.has(id)) throw new RangeError(`Servo ${id} is not discovered`);
    return id;
  }

  async capabilities(id, options = {}) {
    this.#capabilities.delete(id);
    const generation = this.#generation;
    const bytes = await this.#read(id, Codec.ADDRESS.capabilities, 8, options);
    if (generation !== this.#generation) throw new Error('Capability discovery invalidated; rediscover before use');
    if (bytes.length !== 8) throw new Error('Invalid arm v9 capability length');
    if (bytes.toString('ascii', 0, 4) !== 'ARMC') return null;
    const caps = Object.freeze({ major: bytes[4], minor: bytes[5], tickMs: bytes[7] });
    this.#capabilities.set(id, caps);
    return caps;
  }

  async configuration(id, options = {}) {
    return Codec.decodeConfig(await this.#read(id, Codec.ADDRESS.config, 24, options));
  }

  async configure(id, config, options = {}) {
    const encoded = Codec.encodeConfig(config);
    await this.#write(id, Codec.ADDRESS.config, encoded, options);
    const readback = await this.#read(id, Codec.ADDRESS.config, 24, options);
    if (!encoded.equals(readback)) throw new Error('Arm config verification failed');
    return Codec.decodeConfig(readback);
  }

  select(id, enabled, session, options = {}) {
    if (typeof enabled !== 'boolean' || !Number.isInteger(session) ||
        (enabled ? session < 1 || session > 65535 : session !== 0))
      throw new RangeError('Selection requires a nonzero session for extension mode, or zero for legacy');
    const bytes = Buffer.alloc(3);
    bytes[0] = enabled ? 1 : 0;
    bytes.writeUInt16LE(session, 1);
    return this.#write(id, Codec.ADDRESS.select, bytes, options);
  }

  async setTargets(entries, session, options = {}) {
    // Encode every entry before any I/O. A successful broadcast means sent;
    // callers verify acceptance from each servo's subsequent C1/C2 sample.
    const payload = Codec.encodeTargets(entries, session);
    for (const { id } of entries) this.#id(id);
    for (const { id } of entries) await this.#requireV9(id, options);
    return this.bus.protocol.armCommand(BROADCAST_ID, Instruction.ARM_TARGETS,
      payload, { priority: Priority.MOTION, ...options });
  }

  async updateGravity(id, command, options = {}) {
    const bytes = Codec.encodeGravity(command);
    await this.#requireV9(id, options);
    return this.bus.protocol.armCommand(this.#id(id), Instruction.ARM_GRAVITY,
      bytes, { priority: Priority.MOTION, ...options });
  }

  async feedback(id, options = {}) {
    return Codec.decodeFeedback(await this.#read(id, Codec.ADDRESS.feedback, 32, options));
  }

  async tuning(id, options = {}) {
    return Codec.decodeTuning(await this.#read(id, Codec.ADDRESS.tuning, 54, options));
  }

  async #read(id, address, length, options) {
    if (address !== Codec.ADDRESS.capabilities) await this.#requireV9(id, options);
    return this.bus.protocol.armCommand(this.#id(id), Instruction.ARM_READ,
      Buffer.from([address, length]), { ...options, expectedDataLength: length });
  }

  async #write(id, address, bytes, options) {
    await this.#requireV9(id, options);
    return this.bus.protocol.armCommand(this.#id(id), Instruction.ARM_WRITE,
      Buffer.concat([Buffer.from([address]), bytes]), options);
  }
}

module.exports = { ArmExtension };
