#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { TeleoperationInput } = require('./Teleoperation');
const { run } = require('../../host/arm-control/session');
const { GravityModel } = require('../../host/arm-control/GravityModel');
const { loadConfiguration } = require('../../host/arm-control/configuration');

const USAGE = 'npm run teleoperate -- CONFIG.json [--run]\nWithout --run: read-only preflight and preview.';
function parse(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  if (!args[0] || args[0].startsWith('--') || args.length > 2 ||
      (args.length === 2 && args[1] !== '--run')) throw new Error(USAGE);
  return { filename: args[0], move: args[1] === '--run' };
}

async function main(args) {
  const options = parse(args);
  if (options.help) { console.log(USAGE); return; }
  const config = await loadConfiguration(options.filename);
  const gravity = config.gravityModel ? await GravityModel.load(path.resolve(path.dirname(options.filename), config.gravityModel)) : undefined;
  const abort = new AbortController(), stop = () => abort.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try { await run(config, { move: options.move, createSource: options => new TeleoperationInput(options), gravity, signal: abort.signal }); }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parse, main };
