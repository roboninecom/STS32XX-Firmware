'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RangeCapture, recordRanges } = require('../calibration');
const IDS = [1, 2, 3, 4, 5, 6];

const positions = value => Object.fromEntries(IDS.map(id => [id, value]));

async function recording({ answers, sample }) {
  const ranges = new RangeCapture(positions(2048)), messages = [], delays = [];
  let frame = 0, prompts = 0, clock = 0, answer;
  const plan = await recordRanges({ read: async options => {
    assert.equal(options.tolerateReadErrors, true);
    frame++;
    assert(frame <= 40, 'recording should finish without spinning');
    const data = sample(frame);
    if (Object.hasOwn(answers, frame)) answer(answers[frame]);
    return data;
  } }, ranges, {
    question: async (_, signal) => {
      prompts++;
      return new Promise((resolve, reject) => {
        answer = resolve;
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      });
    },
    output: message => messages.push(message), expectedRanges: {}, now: () => clock,
    sleep: async ms => { delays.push(ms); clock += 600; },
  });
  return { ranges, plan, messages, prompts, delays };
}

test('read failures and early Enter keep recording; healthy joints retain their travel', async () => {
  const result = await recording({ answers: { 12: '', 22: '' }, sample: frame => ({
    positions: { ...positions(2048 + Math.min(frame, 10) * 50), ...(frame <= 12 ? { 5: undefined } : {}) },
    errors: frame <= 12 ? { 5: 'read error' } : {},
  }) });
  assert.equal(result.prompts, 2);
  assert(result.delays.every(ms => ms === 20));
  assert(result.messages.some(message => message.includes('read error')));
  assert(result.messages.some(message => message.includes('recording continues')));
  for (const id of IDS) assert.deepEqual(result.plan[id].measuredRange, { min: 2048, max: 2548 });
});

test('resetting a single joint preserves the five other measurements', async () => {
  const result = await recording({ answers: { 12: 'reset 5', 24: '' }, sample: frame => ({
    positions: { ...positions(2048 + Math.min(frame, 10) * 50), 5: frame <= 12 ? 2048 + Math.min(frame, 10) * 50
      : 2548 - Math.min(frame - 12, 10) * 20 }, errors: {},
  }) });
  assert.equal(result.prompts, 2);
  assert.deepEqual(result.plan[5].measuredRange, { min: 2348, max: 2548 });
  for (const id of [1, 2, 3, 4, 6])
    assert.deepEqual(result.plan[id].measuredRange, { min: 2048, max: 2548 });
});

test('fast but unambiguous movement continues without an error or restart', () => {
  const ranges = new RangeCapture(positions(2048));
  for (const value of [2048, 2600, 3200, 3200, 3200, 2000, 1200, 800, 800, 800, 1800, 2000])
    ranges.add(positions(value));
  assert.deepEqual(ranges.plan()[5].measuredRange, { min: 800, max: 3200 });
  assert.equal(ranges.issue(5), null);
});

test('a missing joint sample does not prevent other joints from being recorded', () => {
  const ranges = new RangeCapture(positions(2048));
  for (let i = 0; i < 12; i++) ranges.add({ ...positions(2048 + i * 20), 3: NaN });
  assert.equal(ranges.issue(3), 'invalid reading');
  assert(ranges.ranges[6].max > 2048);
  assert.equal(ranges.ranges[3].max, 2048);
  for (let i = 0; i < 3; i++) ranges.add(positions(2200));
  assert.equal(ranges.issue(3), null);
  assert.equal(ranges.ranges[3].max, 2200);
});

test('a capture-wide failure uses the same error rows and resumes without another prompt', async () => {
  const result = await recording({ answers: { 22: '' }, sample: frame => {
    if (frame === 5) throw new Error('adapter unavailable');
    return { positions: positions(2048 + Math.min(frame, 10) * 50), errors: {} };
  } });
  assert.equal(result.prompts, 1);
  assert(result.messages.some(message => message.includes('adapter unavailable')));
  assert(result.delays.includes(500));
  for (const id of IDS) assert.deepEqual(result.plan[id].measuredRange, { min: 2048, max: 2548 });
});
