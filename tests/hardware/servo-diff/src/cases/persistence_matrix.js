'use strict';

const assert = require('node:assert/strict');
const { withPersistedSettings } = require('../persistence');

// Avoid ID, baud, protection thresholds, offset and boot-topology fields.
// Each byte is committed and restored in its own guarded case.
const addresses = [20, 24, 26, 30, 78, 79, 85, 86];

async function runByte(context, address) {
  const { rig, id } = context;
  const before = await rig.read(id, 0, 87);
  const original = before[address];
  const marker = address === 30 ? (original === 2 ? 3 : 2) : (original + 1) & 0xff;
  const result = await withPersistedSettings(context, address, [marker], async () => {
    const value = (await rig.read(id, address, 1))[0];
    assert.equal(value, marker, `register ${address} did not survive reset`);
    return { value };
  });
  return { exact: { markerSurvivedReset: true, originalRestored: true },
    evidence: { address, original, marker, observedAfterReset: result.result.value,
      preTestRegisterBytes: result.before } };
}

module.exports = addresses.map(address => ({
  id: `test_persistence_matrix_byte_${address}`, scope: 'device', risk: 'safe',
  stages: ['persistence-matrix'], requiresPersistenceWrite: true,
  covers: { registers: [address, 55], persistence: ['primary-write', 'reset', 'restore'] },
  run: context => runByte(context, address),
}));
