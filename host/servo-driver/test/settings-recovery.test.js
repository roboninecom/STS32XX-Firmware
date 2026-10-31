'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { StsSettings, RequestTimeoutError, InvalidPacketError, ServoStatusError, SerialDisconnectedError } = require('..');

function rig({ writeFault, readFault } = {}) {
  const state = { lock: 1, responseStatusLevel: 1, positionCorrection: -500 };
  const writes = [], reads = [];
  let busyUntil = 0;
  const transaction = {
    read: async (id, keys, options) => {
      assert(performance.now() >= busyUntil, 'read arrived during EEPROM save');
      reads.push({ id, keys, options });
      readFault?.({ state, keys, reads, writes });
      return Object.fromEntries(keys.map(key => [key, state[key]]));
    },
    write: async (id, values, options) => {
      assert(performance.now() >= busyUntil, 'write arrived during EEPROM save');
      writes.push({ id, values, options });
      const apply = () => {
        Object.assign(state, values);
        if (Object.hasOwn(values, 'positionCorrection')) busyUntil = performance.now() + 40;
      };
      if (!writeFault?.({ state, values, writes, apply })) apply();
    },
  };
  const bus = { read: transaction.read, transaction: callback => callback(transaction) };
  return { settings: new StsSettings(bus), state, writes, reads };
}

for (const target of ['unlock', 'offset', 'relock']) {
  for (const applied of [false, true]) {
    test(`${target}: lost acknowledgement ${applied ? 'after apply is read back without rewriting' : 'before apply retries automatically'}`, async () => {
      let injected = false;
      const matches = values => target === 'offset' ? Object.hasOwn(values, 'positionCorrection')
        : values.lock === (target === 'unlock' ? 0 : 1);
      const r = rig({ writeFault: ({ values, apply }) => {
        if (!injected && matches(values)) {
          injected = true;
          if (applied) apply();
          throw new RequestTimeoutError('ACK lost');
        }
      } });
      const result = await r.settings.save(3, { positionCorrection: 200 });
      assert.equal(result.verified, true);
      assert.equal(r.state.positionCorrection, 200);
      assert.equal(r.state.lock, 1);
      assert.equal(r.writes.filter(w => matches(w.values)).length, applied ? 1 : 2);
    });
  }
}

test('temporary read failures during timeout recovery do not cause another EEPROM write', async () => {
  let missing = 0;
  const r = rig({
    writeFault: ({ values, apply }) => {
      if (Object.hasOwn(values, 'positionCorrection')) { apply(); throw new RequestTimeoutError('ACK lost'); }
    },
    readFault: ({ state, keys }) => {
      if (state.positionCorrection === 200 && keys.includes('positionCorrection') && missing++ < 2)
        throw new InvalidPacketError('bad reply');
    },
  });
  await r.settings.save(3, { positionCorrection: 200 });
  assert.equal(r.writes.filter(w => Object.hasOwn(w.values, 'positionCorrection')).length, 1);
  assert.equal(r.state.lock, 1);
});

test('failed writes have a bounded retry count and still relock', async () => {
  const r = rig({ writeFault: ({ values }) => {
    if (Object.hasOwn(values, 'positionCorrection')) throw new RequestTimeoutError('no write');
  } });
  await assert.rejects(r.settings.save(3, { positionCorrection: 200 }), /no write/);
  assert.equal(r.writes.filter(w => Object.hasOwn(w.values, 'positionCorrection')).length, 3);
  assert.equal(r.state.positionCorrection, -500);
  assert.equal(r.state.lock, 1);
});

test('unavailable readback stops recovery rather than blindly repeating an EEPROM write', async () => {
  const r = rig({
    writeFault: ({ values, apply }) => {
      if (Object.hasOwn(values, 'positionCorrection')) { apply(); throw new RequestTimeoutError('ACK lost'); }
    },
    readFault: ({ state, keys }) => {
      if (state.positionCorrection === 200 && keys.includes('positionCorrection')) throw new RequestTimeoutError('read unavailable');
    },
  });
  await assert.rejects(r.settings.save(3, { positionCorrection: 200 }), /read unavailable/);
  assert.equal(r.writes.filter(w => Object.hasOwn(w.values, 'positionCorrection')).length, 1);
  assert.equal(r.state.lock, 1);
});

test('alarms and disconnection are not treated as missing acknowledgements', async () => {
  for (const error of [new ServoStatusError(3, 1, ['voltage']), new SerialDisconnectedError('disconnected')]) {
    const r = rig({ writeFault: ({ values }) => {
      if (Object.hasOwn(values, 'positionCorrection')) throw error;
    } });
    await assert.rejects(r.settings.save(3, { positionCorrection: 200 }), e => e === error);
    assert.equal(r.writes.filter(w => Object.hasOwn(w.values, 'positionCorrection')).length, 1);
    assert.equal(r.state.lock, 1);
  }
});

test('caller timeout override is preserved throughout recovery', async () => {
  let first = true;
  const r = rig({ readFault: () => { if (first) { first = false; throw new RequestTimeoutError('retry'); } } });
  await r.settings.save(3, { positionCorrection: 200 }, { timeoutMs: 400 });
  assert(r.reads.concat(r.writes).every(call => call.options.timeoutMs === 400));
});
