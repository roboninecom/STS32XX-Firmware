#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { TeleoperationInput } = require('./Teleoperation');
const { run } = require('../../host/arm-control/session');
const { GravityModel } = require('../../host/arm-control/GravityModel');
const { Replay } = require('./Replay');

const USAGE = 'npm run teleoperate -- CONFIG.json [--run]\nnpm run replay -- CONFIG.json RECORDING [--run]\nWithout --run: read-only preflight and preview.';
function parse(args, mode = 'live') {
  if (!['live', 'replay'].includes(mode)) throw new Error(USAGE);
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const required = mode === 'replay' ? 2 : 1;
  if (args.length < required || args.slice(0, required).some(arg => !arg || arg.startsWith('--')) ||
      args.length > required + 1 || (args.length > required && args[required] !== '--run')) throw new Error(USAGE);
  return { filename: args[0], move: args.length > required,
    ...(mode === 'replay' ? { replayFile: args[1] } : {}) };
}

async function main(args, mode = 'live') {
  const options = parse(args, mode);
  if (options.help) { console.log(USAGE); return; }
  const config = JSON.parse(await fs.readFile(options.filename, 'utf8'));
  const gravity = config.gravityModel ? await GravityModel.load(path.resolve(path.dirname(options.filename), config.gravityModel)) : undefined;
  const replay = options.replayFile ? await Replay.load(options.replayFile, config) : undefined;
  const abort = new AbortController(), stop = () => abort.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try { await run(config, { move: options.move, source: replay, createSource: options => new TeleoperationInput(options), gravity, signal: abort.signal }); }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
if (require.main === module) main(process.argv.slice(3), process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parse, main };
