'use strict';
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { Instruction } = require('../../../../host/servo-driver');
const { persistentBytes } = require('../register-image');
const { CleanupError } = require('../errors');

module.exports = [{
  id: 'test_prerequisite_restore_defaults', prerequisite: true, restoresDefaults: true,
  scope: 'device', risk: 'safe', stages: ['prerequisites', 'commands', 'restore-defaults'],
  requiresPersistenceWrite: true,
  covers: { commands: ['FACTORY_RESET', 'WRITE', 'READ', 'SYSTEM_RESET'],
    registers: [5, 6, 21, 40, 55], persistence: ['restore-defaults-command'] },
  async run({ rig, id }) {
    assert.equal((await rig.read(id, 40, 1))[0], 0, 'restore-defaults test requires torque off');
    await rig.command(id, Instruction.FACTORY_RESET);
    await delay(100);
    await rig.reset(id);
    const defaults = await rig.read(id, 0, 87);
    assert.equal(defaults[5], id, 'restore defaults changed servo ID');
    assert.equal(defaults[6], 0, 'restore defaults changed baud');
    assert.equal(defaults[40], 0);
    assert.equal(defaults[55], 1);
    let operationError;
    try {
      await rig.write(id, 55, [2]);
      await rig.write(id, 21, [defaults[21] ^ 1]);
      assert.equal((await rig.read(id, 21, 1))[0], defaults[21] ^ 1);
      await rig.command(id, Instruction.FACTORY_RESET);
      await delay(100);
      const restored = await rig.read(id, 0, 87);
      assert.deepEqual(persistentBytes(restored), persistentBytes(defaults),
        'restore-defaults command did not replace the changed live gain');
      assert.equal(restored[40], 0);
    } catch (error) { operationError = error; }
    try {
      await rig.command(id, Instruction.FACTORY_RESET);
      await delay(100);
      await rig.reset(id);
      const final = await rig.read(id, 0, 87);
      assert.deepEqual(persistentBytes(final), persistentBytes(defaults));
      assert.equal(final[40], 0);
      assert.equal(final[55], 1);
    } catch (cleanupError) {
      throw new CleanupError('restore-defaults cleanup failed', operationError, cleanupError);
    }
    if (operationError) throw operationError;
    return { exact: { defaultsCommandApplied: true, changedGainReplaced: true,
      retainedAfterReboot: true, torqueOff: true, locked: true },
      evidence: { restoredDefaultBytes: defaults.toString('hex'),
        source: 'device saved reset template (instruction 0x06)' } };
  },
}];
