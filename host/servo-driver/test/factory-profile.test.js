'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  BROADCAST_ID,
  Instruction,
  PacketEncoder,
  RegisterCodec,
  RequestScheduler,
  StsProtocol,
  decodeDeviceAlarms,
} = require('..');

class FactoryTransport extends EventEmitter {
  constructor(handler) {
    super();
    this.handler = handler;
    this.writes = [];
    this.isOpen = true;
  }

  async write(packet) {
    this.writes.push(Buffer.from(packet));
    await this.handler?.(packet, this);
  }

  respond(id, parameters = [], status = 0) {
    this.emit('data', PacketEncoder.frame(id, status, Buffer.from(parameters)));
  }
}

function respondingProtocol() {
  const transport = new FactoryTransport((packet, wire) => {
    if (packet[4] !== Instruction.SYSTEM_RESET) wire.respond(packet[2]);
  });
  return { transport, protocol: new StsProtocol(new RequestScheduler(transport)) };
}

test('factory alarm byte uses device-health meanings', () => {
  assert.deepEqual(decodeDeviceAlarms(0x3F), [
    'VOLTAGE',
    'SENSOR',
    'TEMPERATURE',
    'CURRENT',
    'ANGLE',
    'OVERLOAD',
  ]);
});

test('position correction codec matches all factory encoding regions', () => {
  for (const value of [-4095, -2048, -2047, -1, 0, 1, 2047, 2048, 4095]) {
    const encoded = RegisterCodec.encode('positionCorrection', value);
    assert.equal(RegisterCodec.decode('positionCorrection', encoded), value);
  }
});

test('goal PWM uses factory bit-10 sign encoding', () => {
  assert.deepEqual(RegisterCodec.encode('goalPWM', -1000), Buffer.from([0xE8, 0x07]));
  assert.equal(RegisterCodec.decode('goalPWM', Buffer.from([0xE8, 0x07])), -1000);
});

test('factory-only commands use their recovered instruction values', async () => {
  const { transport, protocol } = respondingProtocol();

  await protocol.saveResetTemplate(1);
  await protocol.encoderHome(1);
  await protocol.calibratePosition(1, -123);
  await protocol.systemReset(1);

  assert.deepEqual(transport.writes.map(packet => packet[4]), [0x09, 0x0A, 0x0B, 0x08]);
  assert.deepEqual(transport.writes[2].subarray(5, 7), Buffer.from([0x85, 0xFF]));
});

test('protocol rejects register ranges the factory would clip or ignore', async () => {
  const { protocol } = respondingProtocol();

  await assert.rejects(protocol.read(1, 0x56, 2), /0x00\.\.0x56/);
  await assert.rejects(protocol.write(1, 0x57, Buffer.from([1])), /0x00\.\.0x56/);
  assert.throws(
    () => protocol.syncWrite(0, [{ id: 1, data: Buffer.alloc(126) }]),
    /125 bytes/
  );
});

test('broadcast discovery waits across sparse factory response slots', async () => {
  const transport = new FactoryTransport((packet, wire) => {
    assert.equal(packet[2], BROADCAST_ID);
    setTimeout(() => wire.respond(1), 1);
    setTimeout(() => wire.respond(100), 8);
  });
  const protocol = new StsProtocol(new RequestScheduler(transport), {
    discoveryTimeoutMs: 15,
    discoverySilenceMs: 2,
  });

  const result = await protocol.ping();

  assert.deepEqual(result.ids, [1, 100]);
});
