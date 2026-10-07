'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  BROADCAST_ID,
  Instruction,
  PacketEncoder,
  Priority,
  RegisterCodec,
  RegisterLayout,
  RequestScheduler,
  Storage,
  StsBus,
  StsProtocol,
  StsSettings,
} = require('..');

class SimulatedStsTransport extends EventEmitter {
  constructor(ids) {
    super();
    this.isOpen = true;
    this.writes = [];
    this.memory = new Map(ids.map(id => [id, Buffer.alloc(0x47)]));
    this.staged = new Map();
    this.failWriteAddress = null;
    this.ignoreWriteAddress = null;
    this.beforeRead = null;
    for (const [id, memory] of this.memory) {
      memory[0x05] = id;
      memory[0x15] = 32;
      memory[0x37] = 1;
    }
  }

  async write(packet) {
    this.writes.push(Buffer.from(packet));
    const id = packet[2];
    const instruction = packet[4];
    const parameters = packet.subarray(5, -1);
    switch (instruction) {
      case Instruction.PING:
        if (id === BROADCAST_ID) {
          for (const servoId of [...this.memory.keys()].reverse()) this.#respond(servoId);
        } else this.#respond(id);
        break;
      case Instruction.READ:
        if (this.beforeRead) {
          await this.beforeRead({ id, address: parameters[0], length: parameters[1] });
        }
        this.#respond(id, this.#memory(id).subarray(parameters[0], parameters[0] + parameters[1]));
        break;
      case Instruction.SYNC_READ:
        for (const servoId of [...parameters.subarray(2)].reverse()) {
          this.#respond(
            servoId,
            this.#memory(servoId).subarray(parameters[0], parameters[0] + parameters[1])
          );
        }
        break;
      case Instruction.WRITE:
        this.#writeMemory(id, parameters[0], parameters.subarray(1));
        this.#respond(id);
        break;
      case Instruction.SYNC_WRITE: {
        const address = parameters[0];
        const length = parameters[1];
        for (let offset = 2; offset < parameters.length; offset += length + 1) {
          this.#writeMemory(parameters[offset], address, parameters.subarray(offset + 1, offset + 1 + length));
        }
        break;
      }
      case Instruction.REG_WRITE:
        this.staged.set(id, { address: parameters[0], data: Buffer.from(parameters.subarray(1)) });
        this.#respond(id);
        break;
      case Instruction.ACTION:
        for (const [servoId, change] of this.staged) {
          this.#writeMemory(servoId, change.address, change.data);
        }
        this.staged.clear();
        if (id !== BROADCAST_ID) this.#respond(id);
        break;
      default:
        throw new Error(`Simulator does not support instruction 0x${instruction.toString(16)}`);
    }
  }

  #memory(id) {
    const memory = this.memory.get(id);
    if (!memory) throw new Error(`Unknown simulated servo ${id}`);
    return memory;
  }

  #writeMemory(id, address, data) {
    if (this.failWriteAddress === address) {
      this.failWriteAddress = null;
      throw new Error(`Injected write failure at 0x${address.toString(16)}`);
    }
    if (this.ignoreWriteAddress === address) return;
    data.copy(this.#memory(id), address);
  }

  #respond(id, data = Buffer.alloc(0), error = 0) {
    this.emit('data', PacketEncoder.frame(id, error, data));
  }
}

async function createBus(ids = [1, 2]) {
  const transport = new SimulatedStsTransport(ids);
  const protocol = new StsProtocol(new RequestScheduler(transport), {
    discoverySilenceMs: 1,
    discoveryTimeoutMs: 20,
  });
  const bus = new StsBus(protocol);
  await bus.discover();
  return { bus, protocol, transport };
}

test('register codec implements factory signed fields', () => {
  assert.deepEqual(RegisterCodec.encode('targetPosition', -123), Buffer.from([0x7B, 0x80]));
  assert.equal(RegisterCodec.decode('presentPosition', Buffer.from([0x7B, 0x80])), -123);
  assert.equal(RegisterCodec.decode('presentPWM', Buffer.from([0x0A, 0x04])), -10);
  assert.deepEqual(RegisterCodec.encode('positionCorrection', -42), Buffer.from([0x2A, 0x08]));
  assert.deepEqual(RegisterCodec.encode('positionCorrection', -4095), Buffer.from([0xFF, 0x1F]));
  assert.equal(RegisterCodec.decode('positionCorrection', Buffer.from([0xFF, 0x1F])), -4095);
  assert.deepEqual(RegisterCodec.encode('goalPWM', -1000), Buffer.from([0xE8, 0x07]));
});

test('compiled layouts merge only safe write ranges and configurable read gaps', () => {
  const motion = RegisterLayout.compileWrite([
    'acceleration',
    'targetPosition',
    'goalPWM',
    'goalVelocity',
  ]);
  assert.equal(motion.ranges.length, 1);
  assert.deepEqual(
    { address: motion.ranges[0].address, length: motion.ranges[0].length },
    { address: 0x29, length: 7 }
  );

  assert.equal(RegisterLayout.compileRead(['presentPosition', 'presentVoltage']).ranges.length, 2);
  const compact = RegisterLayout.compileRead(['presentPosition', 'presentVoltage'], { maxGap: 4 });
  assert.deepEqual(
    { address: compact.ranges[0].address, length: compact.ranges[0].length },
    { address: 0x38, length: 7 }
  );

  const storageBoundary = RegisterLayout.compileWrite(['speedIGain', 'torqueEnable']);
  assert.equal(storageBoundary.ranges.length, 2);
  assert.deepEqual(storageBoundary.ranges.map(range => range.storage), [Storage.EEPROM, Storage.RAM]);
});

test('multi-range background reads yield to queued motion commands', async () => {
  const { bus, transport } = await createBus([1]);
  const writesBefore = transport.writes.length;
  let startRead;
  let releaseRead;
  let intercepted = false;
  const readStarted = new Promise(resolve => { startRead = resolve; });
  const readBlocked = new Promise(resolve => { releaseRead = resolve; });
  transport.beforeRead = async () => {
    if (intercepted) return;
    intercepted = true;
    startRead();
    await readBlocked;
  };

  const background = bus.read(1, ['firmwareMajor', 'presentPosition'], {
    priority: Priority.BACKGROUND,
  });
  await readStarted;
  const motion = bus.write(1, { acceleration: 12 }, { priority: Priority.MOTION });
  releaseRead();
  await Promise.all([background, motion]);

  assert.deepEqual(
    transport.writes.slice(writesBefore).map(packet => [packet[4], packet[5]]),
    [
      [Instruction.READ, 0x00],
      [Instruction.WRITE, 0x29],
      [Instruction.READ, 0x38],
    ]
  );
});

test('bus discovers devices and decodes direct and sync register reads', async () => {
  const { bus, transport } = await createBus();
  RegisterCodec.encode('targetPosition', -100).copy(transport.memory.get(1), 0x38);
  RegisterCodec.encode('targetPosition', 200).copy(transport.memory.get(2), 0x38);

  assert.deepEqual(bus.ids, [2, 1]);
  assert.deepEqual(await bus.device(1).read(['presentPosition']), { presentPosition: -100 });

  const result = await bus.readMany([1, 2], ['presentPosition']);
  assert.deepEqual(result.missingIds, []);
  assert.deepEqual(result.values.get(1), { presentPosition: -100 });
  assert.deepEqual(result.values.get(2), { presentPosition: 200 });
});

test('bus scan observes IDs without replacing discovered devices', async () => {
  const observations = [[1, 2], []];
  const protocol = {
    ping: async () => {
      const ids = observations.shift();
      return {
        ids,
        responses: new Map(ids.map(id => [id, { id }])),
        statusErrors: new Map(),
        durationMs: 6,
      };
    },
    transaction: async () => {},
  };
  const bus = new StsBus(protocol);
  await bus.discover();

  const observation = await bus.scan();

  assert.deepEqual(observation.ids, []);
  assert.deepEqual(bus.ids, [1, 2]);
});

test('bus verify unicast-pings known IDs without changing registry state', async () => {
  const protocol = {
    ping: async id => {
      if (id == null) {
        const ids = [1, 2];
        return {
          ids,
          responses: new Map(ids.map(servoId => [servoId, { id: servoId }])),
          statusErrors: new Map(),
          durationMs: 6,
        };
      }
      if (id === 2) throw new Error('simulated timeout');
      return { id };
    },
    transaction: async () => {},
  };
  const bus = new StsBus(protocol);
  await bus.discover();

  const verification = await bus.verify();

  assert.deepEqual(verification.ids, [1]);
  assert.deepEqual(verification.missingIds, [2]);
  assert.match(verification.errors.get(2).message, /simulated timeout/);
  assert.deepEqual(bus.ids, [1, 2]);
});

test('direct read errors identify the exact servo and register range', async () => {
  const timeout = Object.assign(new Error('simulated timeout'), {
    details: { timeoutMs: 15 },
  });
  const protocol = {
    ping: async id => id == null
      ? { ids: [6], responses: new Map(), statusErrors: new Map(), durationMs: 1 }
      : { id },
    transaction: operation => operation({
      read: async () => { throw timeout; },
    }),
    read: async () => { throw timeout; },
  };
  const bus = new StsBus(protocol);
  await bus.discover();

  await assert.rejects(
    bus.read(6, ['presentPosition']),
    error => {
      assert.deepEqual(error.details, {
        timeoutMs: 15,
        operation: 'read',
        id: 6,
        address: 0x38,
        length: 2,
        registers: ['presentPosition'],
      });
      return true;
    }
  );
});

test('direct write errors identify the exact servo and register range', async () => {
  const timeout = Object.assign(new Error('simulated timeout'), {
    details: { timeoutMs: 8 },
  });
  const protocol = {
    ping: async id => id == null
      ? { ids: [6], responses: new Map(), statusErrors: new Map(), durationMs: 1 }
      : { id },
    transaction: operation => operation({
      write: async () => { throw timeout; },
    }),
  };
  const bus = new StsBus(protocol);
  await bus.discover();

  await assert.rejects(
    bus.write(6, { acceleration: 10 }),
    error => {
      assert.deepEqual(error.details, {
        timeoutMs: 8,
        operation: 'write',
        id: 6,
        address: 0x29,
        length: 1,
        registers: ['acceleration'],
      });
      return true;
    }
  );
});

test('bus sync write sends one motion frame and updates every servo', async () => {
  const { bus, transport } = await createBus();
  const layout = RegisterLayout.compileWrite([
    'acceleration',
    'targetPosition',
    'goalPWM',
    'goalVelocity',
  ]);
  const writesBefore = transport.writes.length;

  await bus.syncWrite(layout, [
    { id: 1, values: { acceleration: 10, targetPosition: -500, goalPWM: 0, goalVelocity: 1200 } },
    { id: 2, values: { acceleration: 20, targetPosition: 600, goalPWM: 0, goalVelocity: 1300 } },
  ]);

  assert.equal(transport.writes.length, writesBefore + 1);
  assert.equal(transport.writes.at(-1)[4], Instruction.SYNC_WRITE);
  assert.equal(RegisterCodec.decode('targetPosition', transport.memory.get(1), 0x2A), -500);
  assert.equal(RegisterCodec.decode('targetPosition', transport.memory.get(2), 0x2A), 600);
});

test('bus registered writes are applied together by broadcast ACTION', async () => {
  const { bus, transport } = await createBus();

  await bus.regWrite([
    { id: 1, values: { acceleration: 11 } },
    { id: 2, values: { acceleration: 22 } },
  ]);

  assert.equal(transport.memory.get(1)[0x29], 11);
  assert.equal(transport.memory.get(2)[0x29], 22);
  assert.equal(transport.writes.at(-1)[4], Instruction.ACTION);
});

test('bus rejects separated registered-write ranges before transmission', async () => {
  const { bus, transport } = await createBus([1]);
  const writesBefore = transport.writes.length;

  assert.throws(
    () => bus.regWrite([{ id: 1, values: { acceleration: 11, torqueLimit: 900 } }]),
    /one contiguous register range/
  );

  assert.equal(transport.writes.length, writesBefore);
});

test('settings save verifies EEPROM and relocks the servo', async () => {
  const { bus, transport } = await createBus([1]);
  const settings = new StsSettings(bus);

  const result = await settings.save(1, { positionPGain: 40, positionDGain: 35 });

  assert.deepEqual(result.before, { positionPGain: 32, positionDGain: 0 });
  assert.deepEqual(result.after, { positionPGain: 40, positionDGain: 35 });
  assert.equal(transport.memory.get(1)[0x37], 1);
});

test('settings operations use the EEPROM request timeout', async () => {
  const calls = [];
  let value = 32;
  const bus = {
    read: async () => ({}),
    transaction: operation => operation({
      read: async (_id, _keys, options) => {
        calls.push({ operation: 'read', options });
        return { positionPGain: value, responseStatusLevel: 1 };
      },
      write: async (_id, values, options) => {
        calls.push({ operation: 'write', options });
        if (values.positionPGain !== undefined) value = values.positionPGain;
      },
    }),
  };

  await new StsSettings(bus).save(1, { positionPGain: 40 });

  assert.equal(calls.length, 6);
  assert.ok(calls.every(call => call.options.timeoutMs === 50));
});

test('settings do not wait for write acknowledgements when status replies are disabled', async () => {
  const writeOptions = [];
  let gain = 32;
  const bus = {
    read: async () => ({}),
    transaction: operation => operation({
      read: async (_id, keys) => keys.includes('responseStatusLevel')
        ? { responseStatusLevel: 0 }
        : { positionPGain: gain },
      write: async (_id, values, options) => {
        writeOptions.push(options);
        if (values.positionPGain !== undefined) gain = values.positionPGain;
      },
    }),
  };

  await new StsSettings(bus).save(1, { positionPGain: 40 });

  assert.equal(writeOptions.length, 3);
  assert.ok(writeOptions.every(options => options.expectResponse === false));
});

test('settings always relock after an EEPROM write failure', async () => {
  const { bus, transport } = await createBus([1]);
  const settings = new StsSettings(bus);
  transport.failWriteAddress = 0x15;

  await assert.rejects(settings.save(1, { positionPGain: 50 }), /Injected write failure/);

  assert.equal(transport.memory.get(1)[0x37], 1);
});

test('settings relock after verification detects an ignored write', async () => {
  const { bus, transport } = await createBus([1]);
  const settings = new StsSettings(bus);
  transport.ignoreWriteAddress = 0x15;

  await assert.rejects(settings.save(1, { positionPGain: 60 }), error =>
    error.name === 'SettingsVerificationError' &&
    error.details.mismatches.positionPGain.actual === 32
  );

  assert.equal(transport.memory.get(1)[0x37], 1);
});
