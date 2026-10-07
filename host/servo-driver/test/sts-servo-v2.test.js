'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  BROADCAST_ID,
  Instruction,
  MissingResponseError,
  PacketDecoder,
  PacketEncoder,
  Priority,
  RequestScheduler,
  SerialOperationTimeoutError,
  SerialTransport,
  ServoStatusError,
  StsServo,
  StsProtocol,
} = require('..');

class FakeTransport extends EventEmitter {
  constructor(onWrite = () => {}) {
    super();
    this.isOpen = true;
    this.writes = [];
    this.onWrite = onWrite;
  }

  async write(packet) {
    this.writes.push(Buffer.from(packet));
    await this.onWrite(packet, this);
  }

  receive(packet, splits = [packet.length]) {
    let offset = 0;
    for (const size of splits) {
      this.emit('data', packet.subarray(offset, offset + size));
      offset += size;
    }
    if (offset < packet.length) this.emit('data', packet.subarray(offset));
  }
}

class FakePort extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.isOpen = false;
    this.calls = [];
  }

  open(callback) {
    this.calls.push('open');
    this.isOpen = true;
    this.emit('open');
    callback();
  }

  write(data, callback) {
    this.calls.push(['write', Buffer.from(data)]);
    callback();
  }

  drain(callback) {
    this.calls.push('drain');
    callback();
  }

  close(callback) {
    this.calls.push('close');
    this.isOpen = false;
    this.emit('close');
    callback();
  }
}

function statusPacket(id, parameters = [], error = 0) {
  return PacketEncoder.frame(id, error, Buffer.from(parameters));
}

test('serial transport awaits open, write/drain, and close', async () => {
  let port;
  const transport = new SerialTransport({
    path: '/dev/fake',
    baudRate: 1_000_000,
    portFactory: options => (port = new FakePort(options)),
  });

  await transport.open();
  await transport.write(Buffer.from([1, 2]));
  await transport.close();

  assert.equal(transport.isOpen, false);
  assert.deepEqual(port.calls, [
    'open',
    ['write', Buffer.from([1, 2])],
    'drain',
    'close',
  ]);
});

test('serial transport rejects a stalled lifecycle operation', async () => {
  class HangingPort extends EventEmitter {
    isOpen = false;
    open() {}
  }

  const transport = new SerialTransport({
    path: '/dev/hanging',
    operationTimeoutMs: 2,
    portFactory: () => new HangingPort(),
  });

  await assert.rejects(
    transport.open(),
    error => error instanceof SerialOperationTimeoutError &&
      error.details.operation === 'open' &&
      error.details.timeoutMs === 2
  );
});

test('new decoder preserves an STS header split between chunks', () => {
  const decoder = new PacketDecoder();
  const packets = [];
  decoder.on('packet', packet => packets.push(packet));
  const encoded = statusPacket(7, [0x34, 0x12]);

  decoder.push(Buffer.from([0x00, 0x42, 0xFF]));
  decoder.push(encoded.subarray(1, 4));
  decoder.push(encoded.subarray(4));

  assert.equal(packets.length, 1);
  assert.equal(packets[0].id, 7);
  assert.deepEqual(packets[0].parameters, Buffer.from([0x34, 0x12]));
});

test('new decoder recovers after a corrupt packet', () => {
  const decoder = new PacketDecoder();
  const packets = [];
  const diagnostics = [];
  decoder.on('packet', packet => packets.push(packet));
  decoder.on('diagnostic', diagnostic => diagnostics.push(diagnostic));
  const corrupt = statusPacket(1);
  corrupt[corrupt.length - 1] ^= 0x01;

  decoder.push(Buffer.concat([corrupt, statusPacket(2, [9])]));

  assert.deepEqual(packets.map(packet => packet.id), [2]);
  assert.ok(diagnostics.some(({ type }) => type === 'checksum-mismatch'));
});

test('request scheduler clears partial decoder state on disconnect', () => {
  const transport = new FakeTransport();
  const scheduler = new RequestScheduler(transport);
  const packets = [];
  const diagnostics = [];
  scheduler.on('unsolicitedPacket', packet => packets.push(packet));
  scheduler.on('diagnostic', diagnostic => diagnostics.push(diagnostic));

  transport.receive(statusPacket(1, [7]).subarray(0, 4));
  transport.emit('disconnect');
  transport.receive(statusPacket(2, [9]));

  assert.deepEqual(packets.map(packet => packet.id), [2]);
  assert.deepEqual(diagnostics, []);
});

test('connect closes a port it opened when discovery fails', async () => {
  class LifecycleTransport extends FakeTransport {
    constructor() {
      super();
      this.isOpen = false;
    }

    async open() {
      this.isOpen = true;
      this.emit('connect');
    }

    async close() {
      this.isOpen = false;
      this.emit('disconnect');
    }

    async write() {
      throw new Error('injected discovery write failure');
    }
  }

  const transport = new LifecycleTransport();
  const servo = new StsServo({
    transport,
    protocol: { discoveryTimeoutMs: 2, discoverySilenceMs: 1 },
  });

  await assert.rejects(servo.connect());
  assert.equal(transport.isOpen, false);
});

test('request scheduler ignores unrelated packets', async () => {
  const transport = new FakeTransport((_packet, fake) => {
    fake.receive(statusPacket(4));
    fake.receive(statusPacket(2, [0xAA]));
  });
  const scheduler = new RequestScheduler(transport);
  const unsolicited = [];
  scheduler.on('unsolicitedPacket', packet => unsolicited.push(packet.id));

  const response = await scheduler.request(Buffer.from([1]), {
    match: packet => packet.id === 2 && packet.parameters.length === 1,
    timeoutMs: 20,
  });

  assert.equal(response.id, 2);
  assert.deepEqual(unsolicited, [4]);
});

test('response timeout starts after the transport write completes', async () => {
  const transport = new FakeTransport(async (_packet, fake) => {
    await new Promise(resolve => setTimeout(resolve, 8));
    setTimeout(() => fake.receive(statusPacket(2, [0xAA])), 1);
  });
  const scheduler = new RequestScheduler(transport);

  const response = await scheduler.request(Buffer.from([1]), {
    match: packet => packet.id === 2 && packet.parameters.length === 1,
    timeoutMs: 3,
  });

  assert.deepEqual(response.parameters, Buffer.from([0xAA]));
});

test('priority scheduler runs motion before already queued background work', async () => {
  let releaseFirst;
  const firstBlocked = new Promise(resolve => { releaseFirst = resolve; });
  const order = [];
  const transport = new FakeTransport(async packet => {
    order.push(packet[0]);
    if (packet[0] === 1) await firstBlocked;
  });
  const scheduler = new RequestScheduler(transport);

  const first = scheduler.send(Buffer.from([1]));
  const background = scheduler.send(Buffer.from([2]), { priority: Priority.BACKGROUND });
  const motion = scheduler.send(Buffer.from([3]), { priority: Priority.MOTION });
  releaseFirst();
  await Promise.all([first, background, motion]);

  assert.deepEqual(order, [1, 3, 2]);
});

test('exclusive transaction cannot be interleaved by another command', async () => {
  const order = [];
  const transport = new FakeTransport(async packet => {
    order.push(packet[0]);
    await Promise.resolve();
  });
  const scheduler = new RequestScheduler(transport);

  const transaction = scheduler.transaction(async wire => {
    await wire.send(Buffer.from([1]));
    await wire.send(Buffer.from([2]));
    await wire.send(Buffer.from([3]));
  });
  const other = scheduler.send(Buffer.from([4]), { priority: Priority.CRITICAL });
  await Promise.all([transaction, other]);

  assert.deepEqual(order, [1, 2, 3, 4]);
});

test('protocol sync read collects out-of-order servo responses', async () => {
  const transport = new FakeTransport((packet, fake) => {
    assert.equal(packet[2], BROADCAST_ID);
    assert.equal(packet[4], Instruction.SYNC_READ);
    fake.receive(statusPacket(2, [0x22, 0x02]));
    fake.receive(statusPacket(1, [0x11, 0x01]), [1, 1, 2]);
  });
  const protocol = new StsProtocol(new RequestScheduler(transport));

  const result = await protocol.syncRead([1, 2], 0x38, 2);

  assert.deepEqual(result.missingIds, []);
  assert.deepEqual(result.responses.get(1), Buffer.from([0x11, 0x01]));
  assert.deepEqual(result.responses.get(2), Buffer.from([0x22, 0x02]));
});

test('protocol can reject a factory alarm when requested', async () => {
  const transport = new FakeTransport((_packet, fake) => {
    fake.receive(statusPacket(1, [0x34, 0x12], 0x20));
  });
  const protocol = new StsProtocol(new RequestScheduler(transport));

  await assert.rejects(
    protocol.read(1, 0x38, 2, { rejectOnAlarm: true }),
    error => error instanceof ServoStatusError && error.details.flags.includes('OVERLOAD')
  );
});

test('factory alarms do not discard otherwise valid read data by default', async () => {
  const transport = new FakeTransport((_packet, fake) => {
    fake.receive(statusPacket(1, [0x34, 0x12], 0x08));
  });
  const protocol = new StsProtocol(new RequestScheduler(transport));
  let observed;

  const data = await protocol.read(1, 0x38, 2, { onStatus: status => { observed = status; } });

  assert.deepEqual(data, Buffer.from([0x34, 0x12]));
  assert.deepEqual(observed.alarms, ['CURRENT']);
});

test('strict sync read reports missing servo IDs', async () => {
  const transport = new FakeTransport((_packet, fake) => {
    fake.receive(statusPacket(1, [0x11]));
  });
  const protocol = new StsProtocol(new RequestScheduler(transport), {
    timing: { minimumMs: 2, responseMarginMs: 0 },
  });

  await assert.rejects(
    protocol.syncRead([1, 2], 0x38, 1),
    error => error instanceof MissingResponseError && error.details.missingIds[0] === 2
  );
});

test('a timed-out response is quarantined before the next request starts', async () => {
  const writes = [];
  const transport = new FakeTransport(async (_packet, fake) => {
    writes.push(process.hrtime.bigint());
    if (writes.length === 1) {
      setTimeout(() => fake.receive(statusPacket(1, [0x10])), 3);
    } else {
      fake.receive(statusPacket(1, [0x20]));
    }
  });
  const scheduler = new RequestScheduler(transport, { timeoutRecoveryMs: 8 });

  const timedOut = scheduler.request(Buffer.from([1]), {
    match: packet => packet.id === 1 && packet.parameters.length === 1,
    timeoutMs: 1,
  });
  const next = scheduler.request(Buffer.from([2]), {
    match: packet => packet.id === 1 && packet.parameters.length === 1,
    timeoutMs: 10,
  });

  await assert.rejects(timedOut);
  assert.deepEqual((await next).parameters, Buffer.from([0x20]));
});

test('a timeout caught inside a transaction is quarantined before its next request', async () => {
  let writeCount = 0;
  const transport = new FakeTransport((_packet, fake) => {
    writeCount += 1;
    if (writeCount === 1) setTimeout(() => fake.receive(statusPacket(1, [0x10])), 3);
    else setTimeout(() => fake.receive(statusPacket(1, [0x20])), 5);
  });
  const scheduler = new RequestScheduler(transport, { timeoutRecoveryMs: 8 });

  const response = await scheduler.transaction(async wire => {
    await assert.rejects(wire.request(Buffer.from([1]), {
      match: packet => packet.id === 1 && packet.parameters.length === 1,
      timeoutMs: 1,
    }));
    return wire.request(Buffer.from([2]), {
      match: packet => packet.id === 1 && packet.parameters.length === 1,
      timeoutMs: 20,
    });
  });

  assert.deepEqual(response.parameters, Buffer.from([0x20]));
});

test('protocol sync write emits one compact packet and expects no response', async () => {
  const transport = new FakeTransport();
  const protocol = new StsProtocol(new RequestScheduler(transport));

  await protocol.syncWrite(0x2A, [
    { id: 1, data: Buffer.from([1, 2]) },
    { id: 2, data: Buffer.from([3, 4]) },
  ]);

  const packet = transport.writes[0];
  assert.equal(packet[2], BROADCAST_ID);
  assert.equal(packet[4], Instruction.SYNC_WRITE);
  assert.deepEqual(packet.subarray(5, -1), Buffer.from([0x2A, 2, 1, 1, 2, 2, 3, 4]));
});

test('broadcast discovery collects responses through the configured window', async () => {
  const transport = new FakeTransport((_packet, fake) => {
    fake.receive(statusPacket(3));
    fake.receive(statusPacket(1));
  });
  const protocol = new StsProtocol(new RequestScheduler(transport), {
    discoveryTimeoutMs: 20,
    discoverySilenceMs: 1,
  });

  const result = await protocol.ping();

  assert.deepEqual(result.ids, [3, 1]);
});

test('broadcast discovery accepts delayed first responses', async () => {
  const transport = new FakeTransport((_packet, fake) => {
    setTimeout(() => {
      fake.receive(statusPacket(2));
      fake.receive(statusPacket(1));
    }, 8);
  });
  const protocol = new StsProtocol(new RequestScheduler(transport), {
    discoveryTimeoutMs: 30,
    discoverySilenceMs: 1,
  });

  const result = await protocol.ping();

  assert.deepEqual(result.ids, [2, 1]);
  assert.ok(result.durationMs >= 8);
});
