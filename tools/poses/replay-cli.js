#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { run } = require('../../host/arm-control/session');
const { GravityModel } = require('../../host/arm-control/GravityModel');
const { loadConfiguration } = require('../../host/arm-control/configuration');
const { Replay } = require('./Replay');

const USAGE = 'npm run replay -- CONFIG.json RECORDING [--run] [--compact]\nWithout --run: read-only preflight and preview.\n--compact: smaller feedback packets; no intermediate planner positions or PID terms.';
function parse(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const flags = args.slice(2);
  if (args.length < 2 || args.slice(0, 2).some(arg => !arg || arg.startsWith('--')) ||
      new Set(flags).size !== flags.length || flags.some(flag => !['--run', '--compact'].includes(flag))) throw new Error(USAGE);
  return { filename: args[0], replayFile: args[1], move: flags.includes('--run'),
    ...(flags.includes('--compact') ? { compact: true } : {}) };
}

async function main(args) {
  const options = parse(args);
  if (options.help) { console.log(USAGE); return; }
  const config = await loadConfiguration(options.filename);
  const gravity = config.gravityModel ? await GravityModel.load(path.resolve(path.dirname(options.filename), config.gravityModel)) : undefined;
  const source = await Replay.load(options.replayFile, config);
  if (options.compact) source.detailedAll = false;
  const abort = new AbortController(), stop = () => abort.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try { await run(config, { move: options.move, source, gravity, signal: abort.signal }); }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parse, main };
