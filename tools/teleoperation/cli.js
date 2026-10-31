#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { TeleoperationInput } = require('./Teleoperation');
const { run } = require('../../host/arm-control/session');
const { GravityModel } = require('../../host/arm-control/GravityModel');
const { loadConfiguration } = require('../../host/arm-control/configuration');
const { Replay } = require('./Replay');

const USAGE = 'npm run teleoperate -- CONFIG.json [--run]\nnpm run replay -- CONFIG.json RECORDING [--run] [--compact]\nWithout --run: read-only preflight and preview.\n--compact: smaller replay feedback packets; no intermediate planner positions or PID terms.';
function parse(args, mode = 'live') {
  if (!['live', 'replay'].includes(mode)) throw new Error(USAGE);
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const required = mode === 'replay' ? 2 : 1;
  const flags = args.slice(required);
  const allowed = mode === 'replay' ? ['--run', '--compact'] : ['--run'];
  if (args.length < required || args.slice(0, required).some(arg => !arg || arg.startsWith('--')) ||
      new Set(flags).size !== flags.length || flags.some(flag => !allowed.includes(flag))) throw new Error(USAGE);
  return { filename: args[0], move: flags.includes('--run'),
    ...(flags.includes('--compact') ? { compact: true } : {}),
    ...(mode === 'replay' ? { replayFile: args[1] } : {}) };
}

async function main(args, mode = 'live') {
  const options = parse(args, mode);
  if (options.help) { console.log(USAGE); return; }
  const config = await loadConfiguration(options.filename);
  const gravity = config.gravityModel ? await GravityModel.load(path.resolve(path.dirname(options.filename), config.gravityModel)) : undefined;
  const replay = options.replayFile ? await Replay.load(options.replayFile, config) : undefined;
  if (options.compact) replay.detailedAll = false;
  const abort = new AbortController(), stop = () => abort.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try { await run(config, { move: options.move, source: replay, createSource: options => new TeleoperationInput(options), gravity, signal: abort.signal }); }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
if (require.main === module) main(process.argv.slice(3), process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parse, main };
