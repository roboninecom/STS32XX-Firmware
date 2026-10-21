'use strict';

const assert = require('node:assert/strict');
const { CleanupError } = require('../errors');
const { persistentBytes } = require('../register-image');

// These bytes can be changed briefly with torque off and persistence locked.
// Identity, baud, offset, protection thresholds, mode and motion goals need
// their own scenarios and are intentionally not part of this access sweep.
const persistentAddresses = [
  4, 7, 16, 17, 21, 22, 23, 24, 25, 26, 27, 30,
  34, 35, 36, 37, 38, 39, 78, 79, 80, 81, 82, 83, 84, 85, 86,
];
const ramAddresses = [41, 48, 49, 50, 51, 52, 53, 54];

function resetValue(before, address) {
  if (address === 41) return 0;
  if (address === 48 || address === 49) return before[address - 32];
  return 0;
}

async function probe({ rig, id }, address, persistent) {
  const before = await rig.read(id, 0, 87);
  assert.equal(before[40], 0, `torque must be off before writing register ${address}`);
  const original = before[address];
  // The position divisor normalizes zero to one during control updates. This
  // access probe uses a nonzero marker; zero substitution has its own case.
  const changed = address === 30 ? (original === 1 ? 2 : 1) : original ^ 1;
  let operationError;
  let observed;
  try {
    await rig.write(id, 55, [2]);
    assert.equal((await rig.read(id, 55, 1))[0], 2);
    await rig.write(id, address, [changed]);
    observed = (await rig.read(id, address, 1))[0];
    assert.equal(observed, changed, `register ${address} did not accept live write`);
  } catch (error) { operationError = error; }
  try {
    await rig.reset(id);
    const after = await rig.read(id, 0, 87);
    assert.deepEqual(persistentBytes(after), persistentBytes(before),
      `persistent settings changed after locked write to register ${address}`);
    assert.equal(after[40], 0, 'reset did not disable torque');
    assert.equal(after[55], 1, 'reset did not restore persistence lock');
    if (persistent) assert.equal(after[address], original,
      `locked write to register ${address} persisted`);
    else assert.equal(after[address], resetValue(before, address),
      `RAM register ${address} was not reset`);
  } catch (cleanupError) {
    throw new CleanupError(`register ${address} reset/cleanup failed`, operationError, cleanupError);
  }
  if (operationError) throw operationError;
  return { exact: { address, writable: true, resetRestored: true,
    persistentSettingsUnchanged: true },
  evidence: { original, written: changed, observed, persistenceLocked: true } };
}

module.exports = [
  ...persistentAddresses.map(address => ({
    id: `test_locked_eeprom_write_${String(address).padStart(2, '0')}`,
    scope: 'device', risk: 'safe', stages: ['register-writes'],
    covers: { registers: [address], commands: ['WRITE', 'SYSTEM_RESET'],
      permissions: ['live-write', 'locked-no-commit'] },
    run: context => probe(context, address, true),
  })),
  ...ramAddresses.map(address => ({
    id: `test_ram_write_${String(address).padStart(2, '0')}`,
    scope: 'device', risk: 'safe', stages: ['register-writes'],
    covers: { registers: [address], commands: ['WRITE', 'SYSTEM_RESET'],
      permissions: ['ram-write'] },
    run: context => probe(context, address, false),
  })),
];
