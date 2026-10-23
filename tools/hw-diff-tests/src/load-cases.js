'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadCases(directory = path.join(__dirname, 'cases')) {
  const cases = [];
  const seen = new Set();
  for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.js')).sort()) {
    const moduleCases = require(path.join(directory, file));
    if (!Array.isArray(moduleCases)) throw new Error(`${file} must export an array of cases`);
    for (const entry of moduleCases) {
      if (!entry || !/^test_[a-z0-9_]+$/.test(entry.id) || typeof entry.run !== 'function') {
        throw new Error(`${file} has an invalid test case`);
      }
      if (seen.has(entry.id)) throw new Error(`Duplicate case ${entry.id}`);
      if (!['safe', 'motion'].includes(entry.risk)) throw new Error(`${entry.id} has invalid risk`);
      if (!['device', 'pair'].includes(entry.scope)) throw new Error(`${entry.id} has invalid scope`);
      seen.add(entry.id);
      cases.push(Object.freeze({ ...entry, module: file.slice(0, -3) }));
    }
  }
  return cases;
}

module.exports = { loadCases };
