'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { Instruction } = require('../../../../host/servo-driver');
const { CleanupError } = require('../errors');
const { persistentBytes } = require('../register-image');

module.exports = [
  {
    id: 'test_template_save_and_restore', scope: 'device', risk: 'safe',
    stages: ['template'], requiresTemplateWrite: true,
    covers: { commands: ['SAVE_RESET_TEMPLATE', 'FACTORY_RESET', 'SYSTEM_RESET'],
      registers: [21, 55], persistence: ['template-save', 'primary-restore'] },
    async run({ rig, id, config }) {
      const before = await rig.read(id, 0, 87);
      rig.events.push({ label: `template-pretest-snapshot:${id}`, kind: 'evidence',
        registerBytes: before.toString('hex') });
      assert.equal(before[5], id, 'ID register differs from bus ID');
      assert.equal(before[6], 0, 'template scenario requires baud index zero');
      assert.equal(config.baudRate, 1_000_000, 'template scenario requires 1 Mbaud');
      assert.equal(before[40], 0, 'torque must be off');
      assert.equal(before[55], 1, 'persistence must start locked');
      const original = before[21];
      const marker = original ^ 1;
      let operationError;
      let observedAfterRestore;
      try {
        await rig.write(id, 21, [marker]); // Live only while lock is nonzero.
        assert.equal((await rig.read(id, 21, 1))[0], marker);
        await rig.command(id, Instruction.SAVE_RESET_TEMPLATE);
        await delay(60);
        await rig.command(id, Instruction.FACTORY_RESET);
        await delay(60);
        const restored = await rig.read(id, 0, 87);
        observedAfterRestore = restored[21];
        assert.equal(restored[21], marker,
          'factory restore did not load newly saved template marker');
        const expected = Buffer.from(before);
        expected[21] = marker;
        assert.deepEqual(persistentBytes(restored), persistentBytes(expected),
          'template restore changed another persistent setting');
        assert.equal(restored[5], id);
        assert.equal(restored[40], 0);
        assert.equal(restored[55], 1);
      } catch (error) { operationError = error; }
      try {
        // Restore the primary byte durably, then save the original active
        // image as the new reset template. An older unknown template cannot
        // be recovered by this protocol and is intentionally not claimed.
        await rig.write(id, 55, [0]);
        await rig.write(id, 21, [original]);
        await rig.write(id, 55, [1]);
        await rig.command(id, Instruction.SAVE_RESET_TEMPLATE);
        await delay(60);
        await rig.reset(id);
        const after = await rig.read(id, 0, 87);
        assert.deepEqual(persistentBytes(after), persistentBytes(before),
          'pre-test primary settings not restored');
        assert.equal(after[40], 0);
        assert.equal(after[55], 1);
      } catch (cleanupError) {
        throw new CleanupError('template primary/settings cleanup failed',
          operationError, cleanupError);
      }
      if (operationError) throw operationError;
      return { exact: { markerSaved: true, templateRestored: true,
        activeSettingsRestored: true, lockRestored: true },
      evidence: { original, marker, observedAfterRestore,
        preTestRegisterBytes: before.toString('hex'),
        templateAfterTest: 'pre-test active settings; prior template contents unknown' } };
    },
  },
];
