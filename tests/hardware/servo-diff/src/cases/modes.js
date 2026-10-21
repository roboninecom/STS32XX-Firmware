'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { Instruction } = require('../../../../../host/servo-driver');
const { CleanupError } = require('../errors');
const { persistentBytes } = require('../register-image');
const { sample, trace, pacedWrite } = require('../motion');
const { encodeSign15, nearbyLogicalPosition } = require('../position');

module.exports = [
  {
    id: 'test_work_mode_transitions_torque_off', scope: 'device', risk: 'safe',
    stages: ['modes'],
    covers: { registers: [33, 40, 41, 46, 47, 55, 56], modes: [0, 1, 2, 3] },
    async run({ rig, id }) {
      const before = await rig.read(id, 0, 87);
      assert.equal(before[33], 0, 'mode transition case expects position mode at entry');
      assert.equal(before[40], 0, 'torque must be off before mode transitions');
      assert.equal(before[55], 1, 'persistence must start locked');
      let operationError;
      const observations = [];
      try {
        await rig.write(id, 55, [2]);
        for (const mode of [1, 2, 3, 0]) {
          await rig.write(id, 41, [7]);
          assert.equal((await rig.read(id, 41, 1))[0], 7);
          await rig.write(id, 33, [mode]);
          const state = await rig.read(id, 33, 26);
          assert.equal(state[0], mode, `mode ${mode} not accepted`);
          assert.equal(state[7], 0, `mode ${mode} left torque enabled`);
          assert.equal(state[8], 0, `mode ${mode} did not clear acceleration`);
          assert.equal(state[13], 0, `mode ${mode} did not clear velocity low byte`);
          assert.equal(state[14], 0, `mode ${mode} did not clear velocity high byte`);
          observations.push({ mode, torque: state[7], acceleration: state[8],
            velocity: [state[13], state[14]], position: [state[23], state[24]] });
        }
      } catch (error) { operationError = error; }
      try {
        await rig.reset(id);
        const after = await rig.read(id, 0, 87);
        assert.deepEqual(persistentBytes(after), persistentBytes(before),
          'mode transitions changed persistent settings');
        assert.equal(after[33], 0);
        assert.equal(after[40], 0);
        assert.equal(after[55], 1);
      } catch (cleanupError) {
        throw new CleanupError('work-mode transition cleanup failed',
          operationError, cleanupError);
      }
      if (operationError) throw operationError;
      return { exact: { visitedAllModes: true, torqueOff: true,
        goalsCleared: true, resetRestored: true }, evidence: { observations } };
    },
  },
  {
    id: 'test_driven_work_mode_transition_matrix', scope: 'device', risk: 'motion',
    stages: ['mode-motion'],
    covers: { modes: [0, 1, 2, 3], registers: [33, 40, 41, 42, 44, 46, 48, 55, 60, 67] },
    async run({ rig, id }) {
      const before = await rig.read(id, 0, 87);
      assert.equal(before[33], 0);
      assert.equal(before[40], 0);
      assert.equal(before[55], 1);
      let operationError;
      const transitions = [];
      try {
        await rig.write(id, 55, [2]);
        await rig.command(id, Instruction.ENCODER_HOME);
        await delay(40);
        const enterMode = async mode => {
          await rig.write(id, 33, [mode]);
          await delay(20);
          const bytes = await rig.read(id, 33, 16);
          const live = await sample(rig, id);
          assert.equal(bytes[0], mode);
          assert.equal(bytes[7], 0, `transition to mode ${mode} left torque enabled`);
          assert.equal(bytes[8], 0, `transition to mode ${mode} left acceleration set`);
          assert.deepEqual([...bytes.subarray(13, 15)], [0, 0],
            `transition to mode ${mode} left velocity set`);
          assert.equal(live.pwm, 0, `transition to mode ${mode} left PWM active`);
          transitions.push({ mode, state: [...bytes], live });
        };

        await enterMode(1);
        await pacedWrite(rig, id, 41, [15]);
        await pacedWrite(rig, id, 48, [180, 0]);
        await rig.write(id, 46, encodeSign15(500));
        const velocity = await trace(rig, id, 300, 15);
        assert.ok(velocity.some(item => Math.abs(item.pwm) >= 30));

        await enterMode(2);
        await pacedWrite(rig, id, 48, [180, 0]);
        await rig.write(id, 44, [80, 0]);
        const pwm = await trace(rig, id, 260, 15);
        assert.ok(pwm.some(item => Math.abs(item.pwm) >= 60));

        await enterMode(3);
        await pacedWrite(rig, id, 41, [20]);
        await pacedWrite(rig, id, 46, encodeSign15(400));
        await pacedWrite(rig, id, 48, [180, 0]);
        await rig.write(id, 42, encodeSign15(128));
        const relative = await trace(rig, id, 450, 15);
        assert.ok(relative.some(item => Math.abs(item.activePosition) >= 30));

        await enterMode(0);
        await pacedWrite(rig, id, 41, [20]);
        await pacedWrite(rig, id, 46, encodeSign15(400));
        await pacedWrite(rig, id, 48, [180, 0]);
        const origin = (await sample(rig, id)).position;
        await rig.write(id, 42, encodeSign15(nearbyLogicalPosition(origin, true) + 128));
        const position = await trace(rig, id, 850, 15);
        assert.ok(position.some(item => Math.abs(item.position - origin) >= 60));
        return { exact: { transitionsDisarmed: true, goalsCleared: true,
          eachNewModeAcceptedCommand: true },
        evidence: { transitions, velocity, pwm, relative, position } };
      } catch (error) { operationError = error; }
      finally {
        try {
          await rig.reset(id);
          const after = await rig.read(id, 0, 87);
          assert.deepEqual(persistentBytes(after), persistentBytes(before));
          assert.equal(after[33], 0);
          assert.equal(after[40], 0);
          assert.equal(after[55], 1);
        } catch (cleanupError) {
          throw new CleanupError(`driven mode transition cleanup failed on ID ${id}`,
            operationError, cleanupError);
        }
      }
      if (operationError) throw operationError;
    },
  },
];
