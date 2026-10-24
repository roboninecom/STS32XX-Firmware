'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { BusTimeouts, StsProtocol, StsBus, ArmExtension, Instruction } = require('..');

test('discovery covers ID 253 at every supported baud and follows baud changes', async () => {
  const deadlines = [];
  const scheduler = {
    request() {},
    collect: async (_packet, options) => {
      deadlines.push(options.timeoutMs);
      return { responses: new Map(), missingIds: [] };
    },
  };
  const protocol = new StsProtocol(scheduler);
  await protocol.ping();
  protocol.setBaudRate(38400);
  await protocol.ping();
  await protocol.ping(undefined, { timeoutMs: 12 });
  const explicit = new StsProtocol(scheduler, { discoveryTimeoutMs: 9 });
  await explicit.ping();
  assert.deepEqual(deadlines, [123, 697, 12, 9]);
  for (const baudRate of [1000000, 500000, 250000, 128000, 115200, 76800, 57600, 38400])
    assert(new BusTimeouts({ baudRate }).discovery() > 254 * 9 * 10000 / baudRate);
});

test('reassigning an ID invalidates extension capabilities before the ID can be reused', async () => {
  const protocol = new EventEmitter();
  protocol.transaction = () => {};
  protocol.ping = async () => ({ ids: [2] });
  let probes = 0;
  protocol.armCommand = async (_id, instruction, params) => {
    assert.equal(instruction, Instruction.ARM_READ);
    if (params[0] === 0x90) {
      ++probes;
      return Buffer.from([65, 82, 77, 67, 9, 0, 0, 1]);
    }
    return Buffer.alloc(32);
  };
  const bus = new StsBus(protocol), arm = new ArmExtension(bus);
  await bus.discover();
  await arm.feedback(2);
  await arm.feedback(2);
  assert.equal(probes, 1);
  bus.rebindId(2, 3);
  await arm.feedback(3);
  bus.rebindId(3, 2);
  await arm.feedback(2);
  assert.equal(probes, 3);
});
