'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

// Each profile may be inline or a JSON file relative to the controller file.
// Resolve once before validation/logging, so logs contain the applied values.
async function loadConfiguration(filename) {
  const config = JSON.parse(await fs.readFile(filename, 'utf8'));
  if (config.profiles) for (const [id, profile] of Object.entries(config.profiles)) {
    if (typeof profile === 'string') config.profiles[id] = JSON.parse(await fs.readFile(
      path.resolve(path.dirname(filename), profile), 'utf8'));
  }
  return config;
}
module.exports = { loadConfiguration };
