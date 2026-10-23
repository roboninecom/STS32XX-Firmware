'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { Rig } = require('./rig');
const { loadCases } = require('./load-cases');
const { CleanupError } = require('./errors');
const { SuiteFixture } = require('./suite-fixture');

function selectCases(all, { stage = 'safe', caseId } = {}) {
  const selected = all.filter(entry => caseId ? entry.id === caseId :
    stage === 'all' || entry.stages.includes(stage));
  if (!selected.length) throw new Error(`No cases selected for ${caseId ?? stage}`);
  return selected.sort((left, right) =>
    Number(right.restoresDefaults === true) - Number(left.restoresDefaults === true) ||
    Number(right.prerequisite === true) - Number(left.prerequisite === true) ||
    Number(left.risk === 'motion') - Number(right.risk === 'motion') ||
    Number(left.requiresCurrentProtection === true) -
      Number(right.requiresCurrentProtection === true));
}

function errorSummary(error) {
  return { name: error.name, message: error.message,
    ...(error instanceof CleanupError ? {
      operationError: error.operationError && errorSummary(error.operationError),
      cleanupError: errorSummary(error.cleanupError),
    } : {}) };
}

function addCase(report, result, onCase, total) {
  report.cases.push(result);
  onCase?.(result, { index: report.cases.length, total });
}

function skipRemaining(report, cases, start, reason, onCase) {
  for (const entry of cases.slice(start)) {
    addCase(report, { id: entry.id, module: entry.module, risk: entry.risk,
      scope: entry.scope, covers: entry.covers, status: 'skipped', reason },
    onCase, cases.length);
  }
}

function validatePermissions(cases, config, options, prepareSuite) {
  if (prepareSuite && (!options.allowPersistenceWrite || config.baudRate !== 1_000_000)) {
    throw new Error('Full-suite setup requires --allow-persistence-write and 1 Mbaud');
  }
  if (cases.some(entry => entry.risk === 'motion') && !options.allowMotion) {
    throw new Error('Motion cases require --allow-motion');
  }
  if (cases.some(entry => entry.requiresCurrentProtection) && !options.allowCurrentProtection) {
    throw new Error('Driven current-protection cases require --allow-current-protection');
  }
  if (cases.some(entry => entry.requiresTemplateWrite) && !options.allowTemplateWrite) {
    throw new Error('Template-write cases require --allow-template-write');
  }
  if (cases.some(entry => entry.requiresPersistenceWrite) && !options.allowPersistenceWrite) {
    throw new Error('Persistent-register cases require --allow-persistence-write');
  }
}

async function loadReference(config, options, cases) {
  if (!options.reference) return;
  if (options.mode !== 'candidate') throw new Error('--reference requires --mode candidate');
  const reference = JSON.parse(await fs.readFile(options.reference, 'utf8'));
  if (reference.config?.factoryId !== config.factoryId ||
      reference.config?.baudRate !== config.baudRate) {
    throw new Error('reference factory ID or baud rate does not match this run');
  }
  const referenceCases = new Map();
  for (const entry of cases.filter(item => item.scope === 'device')) {
    const baseline = reference.cases?.find(item => item.id === entry.id);
    const observation = baseline?.observations?.find(item => item.role === 'factory');
    if (observation?.status !== 'passed' || !observation.result?.exact) {
      throw new Error(`reference lacks a passing factory observation for ${entry.id}`);
    }
    referenceCases.set(entry.id, observation);
  }
  return {
    cases: referenceCases,
    summary: { runId: reference.runId, source: path.resolve(options.reference) },
  };
}

async function observeTargets(entry, targets, rig, ids, config) {
  const observations = [];
  let hardStop;
  for (const target of targets) {
    const firstEvent = rig.events.length;
    const started = process.hrtime.bigint();
    try {
      const result = await entry.run({ rig, ...target, ids, config });
      observations.push({ role: target.role, status: 'passed', result,
        elapsedMs: Number(process.hrtime.bigint() - started) / 1e6,
        eventRange: [firstEvent, rig.events.length] });
    } catch (error) {
      observations.push({ role: target.role, status: 'failed',
        error: errorSummary(error),
        elapsedMs: Number(process.hrtime.bigint() - started) / 1e6,
        eventRange: [firstEvent, rig.events.length] });
      if (error instanceof CleanupError) hardStop = `cleanup failed in ${entry.id} on ${target.role}`;
      else if (entry.prerequisite) hardStop = `prerequisite ${entry.id} failed on ${target.role}`;
      else if (entry.stopOnFailure) hardStop = `safety case ${entry.id} failed on ${target.role}`;
    }
    if (!hardStop) {
      try { await rig.health(target.ids ?? [target.id]); }
      catch (error) {
        const observation = observations.at(-1);
        observation.status = 'failed';
        observation.healthError = errorSummary(error);
        hardStop = `communication health failed after ${entry.id} on ${target.role}`;
      }
    }
    if (hardStop) break;
  }
  return { observations, hardStop };
}

function compareObservations(entry, observations, referenceFactory) {
  const factory = observations.find(item => item.role === 'factory') ?? referenceFactory;
  let factoryStimulus;
  if (entry.requiresFactoryEffect && factory?.status === 'passed') {
    factoryStimulus = typeof entry.validateFactoryStimulus === 'function'
      ? entry.validateFactoryStimulus(factory.result)
      : { valid: Boolean(factory.result.exact.profileStarted && factory.result.exact.shaftMoved),
        reason: 'factory stimulus did not produce measurable motion' };
  }
  const factoryEffectMissing = factoryStimulus && !factoryStimulus.valid;
  const candidate = observations.find(item => item.role === 'candidate');
  let comparison;
  if (entry.compare && factory?.status === 'passed' && candidate?.status === 'passed') {
    try { comparison = entry.compare(factory.result, candidate.result); }
    catch (error) { comparison = { matched: false, error: errorSummary(error) }; }
  } else if (referenceFactory && factory?.status === 'passed' &&
             candidate?.status === 'passed') {
    comparison = { matched: JSON.stringify(factory.result.exact) ===
      JSON.stringify(candidate.result.exact), method: 'exact' };
  }
  // A failed operation takes priority over a missing stimulus or comparison.
  let status = 'passed';
  if (observations.some(item => item.status === 'failed')) status = 'failed';
  else if (factoryEffectMissing) status = 'inconclusive';
  else if (comparison) status = comparison.matched ? 'passed' : 'mismatch';
  else if (observations.length === 2 &&
      JSON.stringify(observations[0].result.exact) !== JSON.stringify(observations[1].result.exact)) {
    status = 'mismatch';
  }
  return { status, comparison, factoryEffectMissing, factoryStimulus };
}

async function run(config, options = {}) {
  options = { ...options, mode: options.mode ?? config.mode ?? 'pair' };
  const prepareSuite = options.prepareSuite ??
    (options.stage === 'all' && !options.caseId && !options.cases);
  const cases = selectCases(options.cases ?? loadCases(), options);
  validatePermissions(cases, config, options, prepareSuite);
  const rig = options.rigFactory ? options.rigFactory(config) : new Rig(config);
  const runId = new Date().toISOString().replaceAll(':', '-');
  const directory = path.resolve(options.resultsDirectory ?? path.join(__dirname, '..', 'results'), runId);
  await fs.mkdir(directory, { recursive: true });
  const report = {
    runId, startedAt: new Date().toISOString(), config,
    selection: { stage: options.stage ?? 'safe', caseId: options.caseId ?? null,
      failFast: options.failFast === true, prepareSuite,
      reference: options.reference ? path.resolve(options.reference) : null },
    cases: [], events: [],
  };
  let opened = false;
  let fixture;
  try {
    const reference = await loadReference(config, options, cases);
    const referenceCases = reference?.cases;
    if (reference) report.reference = reference.summary;
    await rig.open();
    opened = true;
    const ids = [config.factoryId, config.candidateId];
    const activeIds = options.mode === 'factory' ? [ids[0]] :
      options.mode === 'candidate' ? [ids[1]] : ids;
    await rig.health(activeIds);
    if (prepareSuite) {
      fixture = new SuiteFixture(rig, activeIds, async () => {
        await fs.writeFile(path.join(directory, 'report.json'),
          JSON.stringify({ ...report, events: rig.events }, null, 2) + '\n');
      });
      if (!cases.some(entry => entry.restoresDefaults)) await fixture.prepare();
    }
    for (let caseIndex = 0; caseIndex < cases.length; caseIndex++) {
      const entry = cases[caseIndex];
      options.onCaseStart?.(entry, { index: caseIndex + 1, total: cases.length });
      const targets = entry.scope === 'pair' ? [{ role: 'pair', ids }] :
        options.mode === 'factory' ? [{ role: 'factory', id: ids[0] }] :
          options.mode === 'candidate' ? [{ role: 'candidate', id: ids[1] }] :
            [{ role: 'factory', id: ids[0] }, { role: 'candidate', id: ids[1] }];
      if (entry.scope === 'pair' && options.mode !== 'pair') {
        addCase(report, { id: entry.id, module: entry.module, risk: entry.risk,
          scope: entry.scope, covers: entry.covers, status: 'skipped',
          reason: 'requires pair mode' }, options.onCase, cases.length);
        continue;
      }
      const { observations, hardStop: observationStop } =
        await observeTargets(entry, targets, rig, ids, config);
      let hardStop = observationStop;
      const { status, comparison, factoryEffectMissing, factoryStimulus } =
        compareObservations(entry, observations, referenceCases?.get(entry.id));
      if (entry.prerequisite && status !== 'passed' && !hardStop) {
        hardStop = `prerequisite ${entry.id} ${status}`;
      }
      addCase(report, { id: entry.id, module: entry.module, risk: entry.risk,
        scope: entry.scope, covers: entry.covers, status, observations,
        ...(referenceCases?.has(entry.id) ? { referenceRunId: report.reference.runId } : {}),
        ...(comparison ? { comparison } : {}),
        ...(factoryEffectMissing ? { reason: factoryStimulus.reason ??
          'factory stimulus did not produce the required effect' } : {}),
        ...(hardStop ? { hardStop } : {}) }, options.onCase, cases.length);
      if (entry.restoresDefaults && status === 'passed' && fixture) await fixture.prepare();
      if (hardStop || (options.failFast && status !== 'passed')) {
        skipRemaining(report, cases, caseIndex + 1,
          hardStop ?? `--fail-fast after ${entry.id}: ${status}`, options.onCase);
        break;
      }
    }
  } catch (error) {
    report.fatal = errorSummary(error);
    skipRemaining(report, cases, report.cases.length,
      `run setup failed: ${error.message}`, options.onCase);
  } finally {
    if (opened) {
      if (fixture) {
        try { await fixture.restore(); }
        catch (error) { report.cleanupError = errorSummary(error); }
      }
      try { await rig.close(); }
      catch (error) { report.closeError = { name: error.name, message: error.message }; }
    }
    report.finishedAt = new Date().toISOString();
    report.events = rig.events;
    await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  return { directory, report };
}

module.exports = { run, selectCases };
