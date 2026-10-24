#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('../teleoperation/cli');
const { GravityModel } = require('../../host/arm-control/GravityModel');
const { validate, estimate, hash } = require('./plan');
const { BatchSource } = require('./BatchSource');
const { score, fit } = require('./analysis');
const { extract } = require('./identification');
const USAGE = 'npm run tune -- inspect|preflight|run PLAN.json\n  run requires --execute\nnpm run tune -- analyse EVENTS.ndjson\nnpm run tune -- extract EVENTS.ndjson [MORE.ndjson ...]\nnpm run tune -- fit DATASET.json';

function analyse(file) {
  const events = fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const start = events[0], end = events.at(-1), pending = new Map(), trials = [], seen = new Set();
  if (start?.type !== 'run-start' || hash(start.plan) !== start.planHash || hash(start.config) !== start.configHash)
    throw new Error('Missing or changed plan/config identity');
  validate(start.plan, start.config);
  for (const event of events) {
    if (event.type === 'trial-start') {
      if (seen.has(event.trial.id)) throw new Error('Duplicate trial');
      seen.add(event.trial.id); pending.set(event.trial.id, { trial: event.trial, samples: [] });
    }
    if (event.type === 'sample') {
      if (!pending.has(event.trialId)) throw new Error('Orphan sample');
      pending.get(event.trialId).samples.push(event.sample);
    }
    if (event.type === 'trial-end') {
      const active = pending.get(event.trial.id);
      if (!active) throw new Error('Orphan trial end');
      for (const key of Object.keys(active.trial))
        if (JSON.stringify(active.trial[key]) !== JSON.stringify(event.trial[key])) throw new Error('Trial identity changed');
      trials.push({ ...event.trial, result: score(active.samples, event.trial, start.plan) });
      pending.delete(event.trial.id);
    }
  }
  return { complete: end?.type === 'run-end' && end.summary.status === 'complete' && end.summary.trials === trials.length && !pending.size && trials.length > 0 && trials.every(t => t.result.valid),
    trials, incompleteTrialIds: [...pending.keys()] };
}
function implementationIdentity() {
  const files = {};
  for (const root of ['tools/tuning', 'host/arm-control', 'host/servo-driver', 'tools/teleoperation']) {
    const directory = path.resolve(__dirname, '../..', root);
    function visit(folder) {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        if (['node_modules', 'logs', 'test'].includes(entry.name)) continue;
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (entry.name.endsWith('.js')) files[path.relative(path.resolve(__dirname, '../..'), file)] = hash(fs.readFileSync(file, 'utf8'));
      }
    }
    visit(directory);
  }
  return { sha256: hash(files), files };
}
async function load(file) {
  const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  const configFile = path.resolve(path.dirname(file), plan.config);
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  validate(plan, config);
  const gravity = config.gravityModel ? await GravityModel.load(path.resolve(path.dirname(configFile), config.gravityModel)) : undefined;
  if (estimate(plan, config).wireUtilization >= 0.5) throw new Error('Tuning telemetry exceeds 50% nominal wire budget');
  return { plan, config, gravity };
}
async function execute({ plan, config, gravity }, { move = false, directory, signal, output = console.log, ...dependencies } = {}) {
  validate(plan, config);
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'events.ndjson'), fd = fs.openSync(file, 'wx');
  const record = event => {
    fs.writeSync(fd, JSON.stringify({ wallTime: new Date().toISOString(), ...event }) + '\n');
    if (['trial-end', 'comparison', 'run-end'].includes(event.type)) fs.fsyncSync(fd);
    if (event.type === 'comparison') output(JSON.stringify(event));
  };
  const source = new BatchSource(plan, config, { record });
  let error, terminalWritten = false;
  const saveSummary = () => fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(source.summary, null, 2) + '\n');
  const logEvent = event => {
    record(event);
    if (event.type === 'stopped') {
      // Final evidence must be durable while the shared lifecycle can still
      // remove torque if a write fails. Do not defer this until the port closes.
      saveSummary();
      record({ type: 'run-end', summary: source.summary });
      terminalWritten = true;
    }
  };
  try {
    record({ type: 'run-start', backend: 'hardware', plan, config, planHash: hash(plan), configHash: hash(config),
      implementation: implementationIdentity(), gravityModel: gravity?.document, gravityIdentity: gravity?.identity });
    await run(config, { ...dependencies, replay: source, gravity, move, signal,
      output: message => { if (!message.startsWith('{')) output(message); },
      createLog: async () => ({ filename: file, write: logEvent, close: async () => {} }) });
    if (!move) source.summary.status = 'preflight';
    else if (source.summary.status !== 'complete') throw new Error('Tuning interrupted before completion');
  } catch (cause) {
    error = cause; source.summary.status = 'failed'; source.summary.error = cause.message;
    source.summary.recommendation = null;
  } finally {
    try {
      if (!terminalWritten || error) {
        record({ type: 'run-end', summary: source.summary });
        saveSummary();
      }
    } finally { fs.closeSync(fd); }
  }
  output(JSON.stringify({ directory, ...source.summary }));
  if (error) throw error;
  return source.summary;
}
async function main(args = process.argv.slice(2)) {
  const [command, input, ...options] = args;
  if (!command || command === '--help') { console.log(USAGE); return; }
  if (!input) throw new Error(USAGE);
  if (['analyse', 'fit', 'extract'].includes(command)) {
    if (command !== 'extract' && options.length) throw new Error(USAGE);
    const result = command === 'analyse' ? analyse(input) : command === 'fit'
      ? fit(JSON.parse(fs.readFileSync(input, 'utf8'))) : extract([input, ...options]);
    console.log(JSON.stringify(result, null, 2)); return result;
  }
  if (!['inspect', 'preflight', 'run'].includes(command) ||
      (command === 'run' ? options.length !== 1 || options[0] !== '--execute' : options.length)) throw new Error(USAGE);
  const inputs = await load(path.resolve(input));
  if (command === 'inspect') { console.log(JSON.stringify({ planHash: hash(inputs.plan), estimate: estimate(inputs.plan, inputs.config) }, null, 2)); return; }
  const root = path.join(__dirname, 'logs'); fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, `${new Date().toISOString().replaceAll(':', '-')}-`));
  const abort = new AbortController(), stop = () => abort.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try { return await execute(inputs, { move: command === 'run', directory, signal: abort.signal }); }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main, load, execute, analyse, implementationIdentity };
