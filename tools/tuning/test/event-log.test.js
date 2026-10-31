'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventLog } = require('../EventLog');

test('slow disk writes do not block appends; final flush preserves order and durability', async () => {
  let release, synced = false;
  const gate = new Promise(resolve => { release = resolve; }), lines = [];
  const log = new EventLog({ writeFile: async line => { await gate; lines.push(line); },
    sync: async () => { synced = true; }, close: async () => {} });
  log.write({ n: 1 }); log.write({ n: 2 });
  assert(log.pendingBytes > 0); assert.equal(lines.length, 0);
  let complete = false; const flushed = log.flush().then(() => { complete = true; });
  await Promise.resolve(); assert.equal(complete, false);
  release(); await flushed;
  assert.deepEqual(lines.map(JSON.parse), [{ n: 1 }, { n: 2 }]);
  assert(synced); assert.equal(log.pendingBytes, 0); await log.close();
});
test('disk failure and bounded backlog surface instead of silently dropping evidence', async () => {
  const log = new EventLog({ writeFile: async () => { throw Error('disk failed'); },
    sync: async () => {}, close: async () => {} });
  log.write({ n: 1 }); await assert.rejects(log.flush(), /disk failed/);
  assert.throws(() => log.write({ n: 2 }), /disk failed/); await log.close();
  const bounded = new EventLog({ writeFile: async () => {}, sync: async () => {}, close: async () => {} }, 5);
  assert.throws(() => bounded.write({ n: 1 }), /byte limit/); await bounded.close();
});
