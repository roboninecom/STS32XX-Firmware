'use strict';

const assert = require('node:assert/strict');

module.exports = [
  {
    id: 'test_ping', scope: 'device', risk: 'safe', stages: ['safe'],
    covers: { commands: ['PING'] },
    async run({ rig, id }) {
      const reply = await rig.ping(id);
      assert.equal(reply.id, id);
      return { exact: { idMatched: true, parameterCount: reply.parameters.length } };
    },
  },
  {
    id: 'test_register_read_map', scope: 'device', risk: 'safe', stages: ['safe'],
    covers: { registers: '0..86', commands: ['READ'] },
    async run({ rig, id }) {
      const data = await rig.read(id, 0, 87);
      assert.equal(data.length, 87);
      return { exact: { length: data.length }, evidence: { registerBytes: data.toString('hex') } };
    },
  },
  {
    id: 'test_read_only_permission', scope: 'device', risk: 'safe', stages: ['safe'],
    covers: { registers: ['modelMinor'], commands: ['WRITE'] },
    async run({ rig, id }) {
      const before = await rig.read(id, 2, 1);
      await rig.write(id, 2, [before[0] ^ 0xff]);
      const after = await rig.read(id, 2, 1);
      assert.deepEqual(after, before, 'read-only model byte changed');
      return { exact: { unchanged: true } };
    },
  },
];
