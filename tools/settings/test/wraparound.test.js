'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RangeCapture } = require('../calibration');

const IDS = [1, 2, 3, 4, 5, 6];

const wrap = value => ((value % 4096) + 4096) % 4096;
const positions = value => Object.fromEntries(IDS.map(id => [id, value]));

// Feed a physical path with repeated endpoint samples, exactly as a manual sweep.
function sweep(start, endpoints, encode = wrap) {
  const capture = new RangeCapture(positions(encode(start)));
  let current = start;
  for (const end of endpoints) {
    while (current !== end) {
      current += Math.sign(end - current) * Math.min(100, Math.abs(end - current));
      capture.add(positions(encode(current)));
    }
    capture.add(positions(encode(end)));
    capture.add(positions(encode(end)));
  }
  return capture;
}

test('every encoder starting count unwraps forward and backward steps, including exact zero', () => {
  for (let start = 0; start < 4096; start++) {
    for (const step of [-2047, -1024, -257, -256, -1, 0, 1, 256, 257, 1024, 2047]) {
      const capture = new RangeCapture(positions(start));
      capture.add(positions(wrap(start + step)));
      assert.equal(capture.ranges[5].current, start + step, `start=${start}, step=${step}`);
    }
  }
});

test('ambiguous half-turn jumps flag a recoverable error at every encoder start', () => {
  for (let start = 0; start < 4096; start++) {
    for (const step of [-2048, 2048]) {
      const capture = new RangeCapture(positions(start));
      capture.add(positions(wrap(start + step)));
      assert.equal(capture.ranges[5].error, 'ambiguous reading');
      assert.equal(capture.ranges[5].current, start);
      capture.add(positions(wrap(start + 100)));
      assert.equal(capture.ranges[5].error, undefined);
      assert.equal(capture.ranges[5].current, start + 100);
    }
  }
});

test('the reported M5 sweep survives four zero crossings without losing or adding travel', () => {
  const capture = sweep(2048, [-746, 3076, -746, 3076, 1100]);
  const r = capture.ranges[5];
  assert.deepEqual({ min: r.min, max: r.max, current: r.current }, { min: -746, max: 3076, current: 1100 });
  assert.equal(r.max - r.min, 3822);
  assert.equal(Object.hasOwn(r, 'wrapCrossings'), false);
});

test('wrapped and continuous telemetry describe identical physical travel in both directions', () => {
  for (const endpoints of [[-746, 3076, -746, 1100], [4842, 1020, 4842, 3076]]) {
    const wrapped = sweep(2048, endpoints);
    const continuous = sweep(2048, endpoints, value => value);
    for (const key of ['min', 'max', 'current'])
      assert.equal(wrapped.ranges[5][key], continuous.ranges[5][key]);
  }
});

test('signed and multi-turn representations retain the same displacement across zero', () => {
  for (const start of [-8192, -4097, -4096, -1, 0, 1, 4095, 4096, 8192]) {
    for (const direction of [-1, 1]) {
      const capture = sweep(start, [start + direction * 700, start], value => value);
      assert.equal(capture.ranges[5].min, Math.min(start, start + direction * 700));
      assert.equal(capture.ranges[5].max, Math.max(start, start + direction * 700));
      assert.equal(capture.ranges[5].current, start);
    }
  }
});

test('repeated jitter across zero does not accumulate turns or invent a large range', () => {
  const capture = new RangeCapture(positions(4095));
  for (let i = 0; i < 100; i++)
    for (const value of [0, 1, 0, 4095, 4094, 4095]) capture.add(positions(value));
  assert.equal(capture.ranges[5].current, 4095);
  assert(capture.ranges[5].min >= 4094);
  assert(capture.ranges[5].max <= 4097);
  assert.throws(() => capture.plan(), /travel must/);
});

test('one outlier on either side of zero does not widen confirmed endpoints', () => {
  for (const start of [0, 4095]) {
    const capture = new RangeCapture(positions(start));
    for (const delta of [0, 0, 120, 0, 0, -120, 0, 0, 0, 0]) capture.add(positions(wrap(start + delta)));
    assert.equal(capture.ranges[5].min, start);
    assert.equal(capture.ranges[5].max, start);
  }
});

test('whole revolutions cannot masquerade as a bounded joint after wrapping back to the start', () => {
  for (const span of [4096, 8192]) {
    for (const direction of [-1, 1]) {
      const capture = sweep(2048, [2048 + direction * span, 2048]);
      assert.equal(capture.ranges[5].max - capture.ranges[5].min, span);
      assert.throws(() => capture.plan(), /travel must/);
    }
  }
});
