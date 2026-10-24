'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

function check(ok, message) { if (!ok) throw new Error(`Gravity model: ${message}`); }
function finite(value, min, max) { return Number.isFinite(value) && value >= min && value <= max; }
function idKey(id) { return /^[1-9]\d*$/.test(id) && Number(id) <= 253; }

// Pure evaluator: measured encoder counts -> signed PWM effort. The angle
// calibration is already encoded in each term's weights and offsetRad.
class GravityModel {
  static async load(filename) {
    const raw = await fs.readFile(filename, 'utf8');
    return new GravityModel(JSON.parse(raw), { path: path.resolve(filename),
      sha256: createHash('sha256').update(raw).digest('hex') });
  }

  constructor(document, identity = {}) {
    check(document?.format === 'sts-gravity' && document.version === 1 && document.units === 'pwm-effort', 'expected sts-gravity version 1 in pwm-effort');
    for (const key of ['name', 'calibration', 'mounting', 'payload'])
      check(typeof document[key] === 'string' && document[key].trim(), `${key} description required`);
    check(document.models && !Array.isArray(document.models) && Object.keys(document.models).length > 0, 'motor models required');
    for (const [id, model] of Object.entries(document.models)) {
      check(idKey(id), `invalid motor ID ${id}`);
      check(model && Number.isInteger(model.maxEffort) && finite(model.maxEffort, 0, 1000), `invalid effort cap for ${id}`);
      check(Array.isArray(model.terms) && model.terms.length <= 16, `invalid terms for ${id}`);
      check(typeof model.note === 'string' && model.note.trim(), `explain model or zero compensation for ${id}`);
      for (const term of model.terms) {
        check(term && ['constant', 'sin', 'cos'].includes(term.fn), `invalid basis for ${id}`);
        check(finite(term.coefficient, -1000, 1000) && finite(term.offsetRad, -100, 100), `invalid coefficient/offset for ${id}`);
        check(term.weights && typeof term.weights === 'object' && !Array.isArray(term.weights), `invalid weights for ${id}`);
        for (const [input, weight] of Object.entries(term.weights))
          check(idKey(input) && finite(weight, -1, 1), `invalid encoder weight for ${id}`);
        check(term.fn !== 'constant' || Object.keys(term.weights).length === 0, 'constant terms cannot depend on encoder inputs');
      }
    }
    const calibration = document.encoderCalibration ?? {};
    check(calibration && typeof calibration === 'object' && !Array.isArray(calibration), 'invalid encoderCalibration');
    for (const [id, settings] of Object.entries(calibration)) {
      check(idKey(id) && settings && Number.isInteger(settings.positionCorrection) &&
        finite(settings.positionCorrection, -4095, 4095) && settings.resolution === 1 &&
        typeof settings.reverse === 'boolean', `invalid encoder calibration for ${id}`);
    }
    for (const model of Object.values(document.models)) for (const term of model.terms)
      for (const input of Object.keys(term.weights))
        check(calibration[input], `encoderCalibration required for measured motor ${input}`);
    this.document = structuredClone(document);
    this.identity = { ...identity, name: document.name, calibration: document.calibration,
      mounting: document.mounting, payload: document.payload };
  }

  validateIds(ids) {
    for (const id of ids) {
      const model = this.document.models[id];
      check(model, `missing explicit model for motor ${id}`);
      for (const term of model.terms) for (const input of Object.keys(term.weights))
        check(ids.includes(Number(input)), `motor ${id} requires measured motor ${input}`);
    }
  }

  validateCalibration(ids, settings) {
    for (const id of ids) {
      const expected = this.document.encoderCalibration?.[id];
      if (!expected) continue; // Constant/zero-only models need no encoder angle.
      for (const key of ['positionCorrection', 'resolution', 'reverse'])
        check(settings[id]?.encoderCalibration?.[key] === expected[key],
          `motor ${id} calibration mismatch: ${key} expected ${expected[key]}, got ${settings[id]?.encoderCalibration?.[key]}`);
    }
  }

  evaluate(positions, ids, profiles) {
    const efforts = {};
    for (const id of ids) {
      const model = this.document.models[id];
      check(model, `missing explicit model for motor ${id}`);
      const effort = model.terms.reduce((sum, term) => {
        let basis = 1;
        if (term.fn !== 'constant') {
          let angle = 0;
          for (const [input, weight] of Object.entries(term.weights)) {
            check(finite(positions[input], -32767, 32767), `missing/invalid measured motor ${input}`);
            angle += positions[input] * weight;
          }
          basis = Math[term.fn](term.offsetRad + angle);
        }
        return sum + term.coefficient * basis;
      }, 0);
      const limit = Math.min(model.maxEffort, profiles[id].effortLimit);
      check(Number.isFinite(effort) && Math.abs(effort) <= limit, `motor ${id} effort ${effort} exceeds cap ${limit}`);
      efforts[id] = Math.round(effort);
    }
    return efforts;
  }
}
module.exports = { GravityModel };
