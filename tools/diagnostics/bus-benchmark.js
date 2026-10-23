#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { BAUD_RATES } = require('../../host/servo-driver');
const { cases } = require('./cases');

function parse(args) {
  const options = { ids: [1, 2], baud: 1000000, repetitions: 1000, warmup: 20,
    timeoutMs: 100, gapMs: 0, cases: [], results: path.join(__dirname, 'results'), readOnly: true };
  const fields = { '--port': 'port', '--ids': 'ids', '--baud': 'baud', '--repetitions': 'repetitions',
    '--warmup': 'warmup', '--timeout-ms': 'timeoutMs', '--gap-ms': 'gapMs', '--cases': 'cases',
    '--results': 'results', '--label': 'label' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--include-writes') options.readOnly = false;
    else if (args[i] === '--list') options.list = true;
    else if (args[i] === '--help') options.help = true;
    else {
      const key = fields[args[i]];
      if (!key || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid argument ${args[i]}`);
      const value = args[++i];
      options[key] = key === 'ids' ? value.split(',').map(Number) : key === 'cases' ? value.split(',')
        : ['baud', 'repetitions', 'warmup', 'timeoutMs', 'gapMs'].includes(key) ? Number(value) : value;
    }
  }
  if (!options.help && !options.list && !options.port) throw new Error('--port is required');
  if (!options.ids.length || new Set(options.ids).size !== options.ids.length ||
      options.ids.some(id => !Number.isInteger(id) || id < 0 || id > 253)) throw new Error('Invalid/duplicate IDs');
  for (const key of ['baud', 'repetitions', 'warmup', 'timeoutMs', 'gapMs']) {
    if (!Number.isInteger(options[key]) || options[key] < (['warmup', 'gapMs'].includes(key) ? 0 : 1)) throw new Error(`Invalid ${key}`);
  }
  if (options.repetitions > 100000 || options.warmup > 10000 || options.timeoutMs > 10000 || options.gapMs > 10000)
    throw new Error('Limit repetitions to 100000; warmup/timeout/gap to 10000');
  if (!BAUD_RATES.includes(options.baud)) throw new Error('Unsupported baud rate');
  const available = cases(options.readOnly).map(item => item.name);
  if (options.cases.some(name => !available.includes(name))) throw new Error('Unknown or excluded case');
  return options;
}

async function main() {
  const options = parse(process.argv.slice(2));
  if (options.help) {
    console.log('node tools/diagnostics/bus-benchmark.js --port PORT [--ids 1,2] [--repetitions 1000] [--warmup 20]\n  [--timeout-ms 100] [--gap-ms 0] [--baud 1000000] [--include-writes]\n  [--cases ping,read-table-87] [--results DIR] [--label TEXT] [--list]');
    return;
  }
  if (options.list) { console.log(cases(options.readOnly).map(item => item.name).join('\n')); return; }
  let interrupted = false;
  const stop = () => { interrupted = true; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    const { directory, report } = await require('./benchmark').run(options, { stopped: () => interrupted });
    console.log(`Results: ${directory}`);
    if (report.error) console.error(report.error);
    if (report.cleanupErrors.length) console.error('Cleanup errors:', report.cleanupErrors);
    if (report.error || report.cleanupErrors.length || report.cases.some(c =>
      c.warmupFailures || c.counts.timeout || c.counts['status-error'] || c.counts['transport-error'] || c.diagnosticEvents || c.unexpectedFrames || c.duplicateFrames)) process.exitCode = 2;
    else if (interrupted) process.exitCode = 130;
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parse };
