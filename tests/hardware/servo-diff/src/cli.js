#!/usr/bin/env node
'use strict';

const readline = require('node:readline');
const { loadCases } = require('./load-cases');
const { run } = require('./runner');

const HELP = `Usage: npm run diff -- --port PORT [options]

Compare factory and candidate STS servos on a dedicated bench.
  --help                       Show help; no serial access
  --list                       List scenarios; no serial access
  --port PORT                  Serial device (required for hardware runs)
  --baud RATE                  Host baud rate (default: 1000000)
  --factory-id ID               Factory servo ID (default: 1)
  --candidate-id ID             Candidate servo ID (default: 2)
  --mode pair|factory|candidate Default: pair
  --stage NAME                 Scenario group (default: safe); see --list
  --case NAME                  Run one case instead of the stage selection
  --reference FILE             Saved factory report; candidate mode only
  --results DIRECTORY          Parent directory for timestamped reports
  --fail-fast                   Stop after the first non-passing case
  --allow-motion                Permit cases that enable motor drive
  --allow-persistence-write     Permit durable writes and calibration
  --allow-template-write        Permit replacing the saved reset template
  --allow-current-protection    Permit driven current-protection experiments

The safe stage includes an attempted read-only-register WRITE, not just reads.
Full-suite setup (--stage all) replaces settings; cleanup loads saved defaults.
Read tests/hardware/servo-diff/README.md before hardware execution.
Offline checks: npm run test:diff`;

function formatCase(item, progress) {
  const mark = item.status === 'passed' ? 'V' : item.status === 'skipped' ? '-' : 'X';
  return `${mark} [${progress.index}/${progress.total}] ${item.id} (${item.status})`;
}

function progressReporter(stream = process.stdout) {
  let running = false;
  return {
    start(entry, progress) {
      if (!stream.isTTY) return;
      stream.write(`... [${progress.index}/${progress.total}] ${entry.id}`);
      running = true;
    },
    complete(item, progress) {
      if (running) {
        readline.clearLine(stream, 0);
        readline.cursorTo(stream, 0);
        running = false;
      }
      stream.write(`${formatCase(item, progress)}\n`);
    },
  };
}

function parse(argv) {
  const options = { baudRate: 1_000_000, factoryId: 1, candidateId: 2, mode: 'pair', stage: 'safe' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--list') options.list = true;
    else if (arg === '--allow-motion') options.allowMotion = true;
    else if (arg === '--allow-current-protection') options.allowCurrentProtection = true;
    else if (arg === '--allow-template-write') options.allowTemplateWrite = true;
    else if (arg === '--allow-persistence-write') options.allowPersistenceWrite = true;
    else if (arg === '--fail-fast') options.failFast = true;
    else if (['--port', '--baud', '--factory-id', '--candidate-id', '--mode', '--stage', '--case', '--results', '--reference'].includes(arg)) {
      const value = argv[++index];
      if (!value) throw new Error(`Missing value for ${arg}`);
      const key = ({ '--port': 'port', '--baud': 'baudRate', '--factory-id': 'factoryId',
        '--candidate-id': 'candidateId', '--mode': 'mode', '--stage': 'stage',
        '--case': 'caseId', '--results': 'resultsDirectory', '--reference': 'reference' })[arg];
      options[key] = ['baudRate', 'factoryId', 'candidateId'].includes(key) ? Number(value) : value;
    } else throw new Error(`Unknown argument ${arg}`);
  }
  if (!options.list && !options.port) throw new Error('--port is required');
  if (!['pair', 'factory', 'candidate'].includes(options.mode)) throw new Error('Invalid --mode');
  if (options.reference && options.mode !== 'candidate') {
    throw new Error('--reference requires --mode candidate');
  }
  const stages = new Set(['all', ...loadCases().flatMap(entry => entry.stages)]);
  if (!stages.has(options.stage)) throw new Error('Invalid --stage');
  if (!Number.isInteger(options.baudRate) || options.baudRate <= 0) throw new Error('Invalid --baud');
  for (const key of ['factoryId', 'candidateId']) {
    if (!Number.isInteger(options[key]) || options[key] < 0 || options[key] > 253) throw new Error(`Invalid ${key}`);
  }
  if (options.factoryId === options.candidateId) throw new Error('Servo IDs must differ');
  return options;
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    console.log(HELP);
    return;
  }
  const options = parse(argv);
  if (options.list) {
    for (const entry of loadCases()) console.log(`${entry.stages.join(',')}\t${entry.risk}\t${entry.id}`);
    return;
  }
  const progress = progressReporter();
  const { directory, report } = await run(options, {
    ...options,
    onCaseStart: progress.start,
    onCase: progress.complete,
  });
  console.log(`Report: ${directory}/report.json`);
  if (report.fatal) console.error(`Fatal: ${report.fatal.message}`);
  if (report.cleanupError) console.error(`Cleanup: ${report.cleanupError.message}`);
  if (report.fatal || report.closeError || report.cleanupError ||
      report.cases.some(item => ['failed', 'mismatch', 'inconclusive'].includes(item.status))) process.exitCode = 2;
}

if (require.main === module) main().catch(error => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});

module.exports = { main, parse, formatCase, progressReporter };
