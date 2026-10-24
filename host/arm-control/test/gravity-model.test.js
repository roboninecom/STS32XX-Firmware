'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GravityModel } = require('../GravityModel');
const document = require('../models/arm-upright-empty.json');
const reference = require('./fixtures/gravity-reference.json');
const profiles = Object.fromEntries([1, 2, 3, 4, 5, 6].map(id => [id, { effortLimit: 1000 }]));

test('extracted evaluator preserves historical coefficients across coupled poses', () => {
  const model = new GravityModel(document); model.validateIds([1, 2, 3, 4, 5, 6]);
  assert.equal(document.source.sha256, reference.sourceSha256);
  for (const row of reference.rows) assert.deepEqual(model.evaluate(row.positions, [1, 2, 3, 4, 5, 6], profiles),
    { 1: 0, ...row.efforts, 5: 0, 6: 0 });
});

test('requires all coupled measurements and an explicit model for each controlled motor', () => {
  const model = new GravityModel(document);
  assert.throws(() => model.validateIds([2]), /requires measured motor/);
  assert.throws(() => model.validateIds([7]), /missing explicit model/);
  assert.throws(() => model.evaluate({ 2: 1000, 3: 2000 }, [2], profiles), /measured motor 4/);
  assert.throws(() => model.evaluate({ 2: NaN, 3: 2000, 4: 1000 }, [2], profiles), /measured motor 2/);
});

test('respects both model and configured output caps without clipping', () => {
  const model = new GravityModel(document), row = reference.rows.find(row => Math.abs(row.efforts[2]) > 1);
  assert.throws(() => model.evaluate(row.positions, [2], { 2: { effortLimit: 1 } }), /exceeds cap/);
  const limited = structuredClone(document); limited.models[2].maxEffort = 1;
  assert.throws(() => new GravityModel(limited).evaluate(row.positions, [2], profiles), /exceeds cap/);
});

test('rejects invalid coefficients, units, metadata and dependencies', () => {
  for (const mutate of [d => { d.units = 'Nm'; }, d => { d.calibration = ''; },
    d => { d.models[2].terms[0].coefficient = Infinity; }, d => { d.models[2].terms[0].weights[0] = 1; },
    d => { d.models[2].terms[0].fn = 'eval'; }]) {
    const copy = structuredClone(document); mutate(copy); assert.throws(() => new GravityModel(copy), /Gravity model/);
  }
});

test('loader records the exact model identity', async () => {
  const model = await GravityModel.load(require('node:path').join(__dirname, '../models/arm-upright-empty.json'));
  assert.match(model.identity.sha256, /^[a-f0-9]{64}$/); assert.equal(model.identity.name, document.name);
});
