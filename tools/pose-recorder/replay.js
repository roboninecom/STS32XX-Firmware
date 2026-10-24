#!/usr/bin/env node
'use strict';
const { main } = require('../teleoperation/cli');
const USAGE = 'npm run replay-poses -- CONFIG.json POSES.json [--run]\nWithout --run: read-only preflight and preview.';
function argumentsForReplay(args) {
  if (args.includes('--help')) return null;
  const [config, recording, flag, extra] = args;
  if (!config || !recording || config.startsWith('--') || recording.startsWith('--') ||
      (flag && flag !== '--run') || extra) throw new Error(USAGE);
  return [config, '--replay', recording, ...(flag ? [flag] : [])];
}
async function replayMain() {
  const args = argumentsForReplay(process.argv.slice(2));
  if (args) await main(args);
  else console.log(USAGE);
}
if (require.main === module) replayMain().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { argumentsForReplay };
