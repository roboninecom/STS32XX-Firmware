'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../src/runner');
const { CleanupError } = require('../src/errors');

function fakeRig() {
  return { events: [], async open() {}, async close() {}, async health() {} };
}

function caseDef(id, fn) {
  return { id, risk: 'safe', scope: 'device', stages: ['safe'],
    module: 'offline', covers: {}, run: fn };
}

async function withResults(callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sts-servo-diff-test-'));
  try { return await callback(directory); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

const config = { factoryId: 1, candidateId: 2, port: '/dev/fake', baudRate: 1_000_000 };

test('direct offset prerequisite requires persistence opt-in before constructing a rig', async () => {
  await assert.rejects(run(config, {
    caseId: 'test_prerequisite_set_offset',
    rigFactory() { assert.fail('must reject before any serial setup'); },
  }), /Persistent-register cases require --allow-persistence-write/);
});

test('an exact case overrides all-stage fixture setup without replacing settings', async () => {
  await withResults(async resultsDirectory => {
    const rig = fakeRig();
    rig.ping = async id => ({ id, parameters: Buffer.alloc(0) });
    // No write, reset or command methods: any fixture mutation fails this test.
    const { report } = await run(config, {
      stage: 'all', caseId: 'test_ping', resultsDirectory, rigFactory: () => rig,
    });
    assert.equal(report.selection.prepareSuite, false);
    assert.equal(report.fatal, undefined);
    assert.deepEqual(report.cases.map(item => [item.id, item.status]), [['test_ping', 'passed']]);
  });
});

test('records mismatch and ordinary failure, then runs independent later case', async () => {
  await withResults(async resultsDirectory => {
    const calls = [];
    const cases = [
      caseDef('test_mismatch', async ({ id }) => ({ exact: { value: id } })),
      caseDef('test_failure', async ({ id }) => {
        calls.push(id);
        if (id === 1) throw new Error('factory assertion');
        return { exact: { value: 2 } };
      }),
      caseDef('test_later', async ({ id }) => {
        calls.push(`later:${id}`);
        return { exact: { okay: true } };
      }),
    ];
    const { report } = await run(config, { cases, mode: 'pair', resultsDirectory,
      rigFactory: fakeRig });
    assert.deepEqual(report.cases.map(item => item.status), ['mismatch', 'failed', 'passed']);
    assert.deepEqual(calls, [1, 2, 'later:1', 'later:2']);
  });
});

test('reports each case live before starting the next case', async () => {
  await withResults(async resultsDirectory => {
    const updates = [];
    const cases = [
      caseDef('test_first', async () => {
        updates.push('body:first');
        throw new Error('expected case failure');
      }),
      caseDef('test_second', async () => {
        updates.push('body:second');
        return { exact: { okay: true } };
      }),
    ];
    const { report } = await run(config, { cases, mode: 'factory', resultsDirectory,
      rigFactory: fakeRig,
      onCaseStart: (entry, progress) =>
        updates.push(`running:${progress.index}/${progress.total}:${entry.id}`),
      onCase: (item, progress) =>
        updates.push(`${item.status}:${progress.index}/${progress.total}:${item.id}`) });
    assert.deepEqual(updates, [
      'running:1/2:test_first', 'body:first', 'failed:1/2:test_first',
      'running:2/2:test_second', 'body:second', 'passed:2/2:test_second',
    ]);
    assert.deepEqual(report.cases.map(item => item.status), ['failed', 'passed']);
  });
});

test('reports skipped cases live after a hard stop', async () => {
  await withResults(async resultsDirectory => {
    const updates = [];
    const prerequisite = caseDef('test_prerequisite', async () => {
      throw new Error('missing prerequisite');
    });
    prerequisite.prerequisite = true;
    const { report } = await run(config, { cases: [prerequisite,
      caseDef('test_later', async () => ({ exact: { okay: true } }))],
    mode: 'factory', resultsDirectory, rigFactory: fakeRig,
    onCase: (item, progress) =>
      updates.push(`${item.status}:${progress.index}/${progress.total}:${item.id}`) });
    assert.deepEqual(updates, ['failed:1/2:test_prerequisite', 'skipped:2/2:test_later']);
    assert.deepEqual(report.cases.map(item => item.status), ['failed', 'skipped']);
  });
});

test('cleanup failure is a hard stop with explicit skipped result', async () => {
  await withResults(async resultsDirectory => {
    const cases = [
      caseDef('test_cleanup_failure', async () => {
        throw new CleanupError('restore failed', new Error('assertion'), new Error('write timeout'));
      }),
      caseDef('test_not_run', async () => ({ exact: { okay: true } })),
    ];
    const { report } = await run(config, { cases, mode: 'pair', resultsDirectory,
      rigFactory: fakeRig });
    assert.deepEqual(report.cases.map(item => item.status), ['failed', 'skipped']);
    assert.match(report.cases[1].reason, /cleanup failed/);
    assert.equal(report.cases[0].observations.length, 1);
  });
});

test('optional --fail-fast stops after first mismatch', async () => {
  await withResults(async resultsDirectory => {
    const cases = [
      caseDef('test_mismatch', async ({ id }) => ({ exact: { value: id } })),
      caseDef('test_not_run', async () => ({ exact: { okay: true } })),
    ];
    const { report } = await run(config, { cases, mode: 'pair', resultsDirectory,
      failFast: true, rigFactory: fakeRig });
    assert.deepEqual(report.cases.map(item => item.status), ['mismatch', 'skipped']);
  });
});

test('unexcited factory motion is inconclusive and does not stop later cases', async () => {
  await withResults(async resultsDirectory => {
    const stimulated = caseDef('test_unexcited', async () => ({
      exact: { profileStarted: false, shaftMoved: false },
    }));
    stimulated.requiresFactoryEffect = true;
    const cases = [stimulated, caseDef('test_later', async () => ({ exact: { okay: true } }))];
    const { report } = await run(config, { cases, mode: 'pair', resultsDirectory,
      rigFactory: fakeRig });
    assert.deepEqual(report.cases.map(item => item.status), ['inconclusive', 'passed']);
  });
});

test('case-specific factory stimulus validation explains an inconclusive result', async () => {
  await withResults(async resultsDirectory => {
    const stimulated = caseDef('test_custom_stimulus', async ({ id }) => ({
      exact: { acknowledged: true }, evidence: { transitions: id === 1 ? 0 : 3 },
    }));
    stimulated.requiresFactoryEffect = true;
    stimulated.validateFactoryStimulus = result => ({
      valid: result.evidence.transitions >= 2,
      reason: 'factory produced fewer than two transitions',
    });
    const { report } = await run(config, { cases: [stimulated], mode: 'pair', resultsDirectory,
      rigFactory: fakeRig });
    assert.equal(report.cases[0].status, 'inconclusive');
    assert.equal(report.cases[0].reason, 'factory produced fewer than two transitions');
  });
});

test('case-specific differential metric mismatch is recorded and later cases continue', async () => {
  await withResults(async resultsDirectory => {
    const compared = caseDef('test_metric', async ({ id }) => ({
      exact: { moved: true }, evidence: { distance: id === 1 ? 200 : 260 },
    }));
    compared.compare = (factory, candidate) => ({
      matched: Math.abs(factory.evidence.distance - candidate.evidence.distance) <= 20,
      factoryDistance: factory.evidence.distance,
      candidateDistance: candidate.evidence.distance,
    });
    const { report } = await run(config, { cases: [compared,
      caseDef('test_later', async () => ({ exact: { okay: true } }))],
    mode: 'pair', resultsDirectory, rigFactory: fakeRig });
    assert.deepEqual(report.cases.map(item => item.status), ['mismatch', 'passed']);
    assert.equal(report.cases[0].comparison.matched, false);
  });
});

test('case-specific comparator can accept an intentional behavior improvement', async () => {
  await withResults(async resultsDirectory => {
    const compared = caseDef('test_improved', async ({ id }) => ({
      exact: { moved: id === 2 },
    }));
    compared.compare = (factory, candidate) => ({
      matched: !factory.exact.moved || candidate.exact.moved,
    });
    const { report } = await run(config, { cases: [compared], mode: 'pair',
      resultsDirectory, rigFactory: fakeRig });
    assert.equal(report.cases[0].status, 'passed');
    assert.equal(report.cases[0].comparison.matched, true);
  });
});

test('candidate-only run compares with a saved factory report', async () => {
  await withResults(async resultsDirectory => {
    const exact = caseDef('test_exact_reference', async ({ id }) => ({ exact: { value: id } }));
    const metric = caseDef('test_metric_reference', async ({ id }) => ({
      exact: { measured: true }, evidence: { value: id * 10 },
    }));
    metric.compare = (factory, candidate) => ({
      matched: Math.abs(factory.evidence.value - candidate.evidence.value) <= 15,
    });
    const reference = await run(config, { cases: [exact, metric], mode: 'factory',
      resultsDirectory, rigFactory: fakeRig });
    const replay = await run(config, { cases: [exact, metric], mode: 'candidate',
      reference: path.join(reference.directory, 'report.json'), resultsDirectory,
      rigFactory: fakeRig });
    assert.deepEqual(replay.report.cases.map(item => item.status), ['mismatch', 'passed']);
    assert.equal(replay.report.cases[0].comparison.method, 'exact');
    assert.equal(replay.report.cases[1].comparison.matched, true);
    assert.equal(replay.report.reference.runId, reference.report.runId);
  });
});

test('incomplete factory reference stops before opening hardware', async () => {
  await withResults(async resultsDirectory => {
    const reference = await run(config, { cases: [caseDef('test_other', async () =>
      ({ exact: { okay: true } }))], mode: 'factory', resultsDirectory,
    rigFactory: fakeRig });
    let opened = false;
    const { report } = await run(config, { cases: [caseDef('test_required', async () =>
      ({ exact: { okay: true } }))], mode: 'candidate',
    reference: path.join(reference.directory, 'report.json'), resultsDirectory,
    rigFactory: () => ({ ...fakeRig(), async open() { opened = true; } }) });
    assert.equal(opened, false);
    assert.match(report.fatal.message, /reference lacks a passing factory observation/);
    assert.equal(report.cases[0].status, 'skipped');
  });
});

test('prerequisites run first and stop later cases on failure', async () => {
  await withResults(async resultsDirectory => {
    const calls = [];
    const later = caseDef('test_later', async () => {
      calls.push('later');
      return { exact: { okay: true } };
    });
    const prerequisite = caseDef('test_prerequisite', async ({ id }) => {
      calls.push(id);
      if (id === 1) throw new Error('write did not stick');
      return { exact: { okay: true } };
    });
    prerequisite.prerequisite = true;
    const { report } = await run(config, { cases: [later, prerequisite], mode: 'pair',
      stage: 'all', resultsDirectory, rigFactory: fakeRig });
    assert.deepEqual(calls, [1]);
    assert.deepEqual(report.cases.map(item => item.status), ['failed', 'skipped']);
    assert.match(report.cases[0].hardStop, /prerequisite/);
  });
});

test('template-writing cases require explicit opt-in before opening the rig', async () => {
  await withResults(async resultsDirectory => {
    const template = caseDef('test_template', async () => ({ exact: { okay: true } }));
    template.requiresTemplateWrite = true;
    await assert.rejects(run(config, { cases: [template], mode: 'pair', resultsDirectory,
      rigFactory: fakeRig }), /--allow-template-write/);
  });
});

test('persistent-register cases require separate opt-in before opening the rig', async () => {
  await withResults(async resultsDirectory => {
    const persistent = caseDef('test_persistent', async () => ({ exact: { okay: true } }));
    persistent.requiresPersistenceWrite = true;
    await assert.rejects(run(config, { cases: [persistent], mode: 'pair', resultsDirectory,
      rigFactory: fakeRig }), /--allow-persistence-write/);
  });
});

test('driven current protection requires opt-in and stops on unsafe failure', async () => {
  await withResults(async resultsDirectory => {
    const guarded = caseDef('test_current', async () => { throw new Error('alarm not observed'); });
    guarded.risk = 'motion';
    guarded.requiresCurrentProtection = true;
    guarded.stopOnFailure = true;
    const later = caseDef('test_later', async () => ({ exact: { okay: true } }));
    await assert.rejects(run(config, { cases: [guarded], mode: 'pair', resultsDirectory,
      allowMotion: true, rigFactory: fakeRig }), /--allow-current-protection/);
    const { report } = await run(config, { cases: [later, guarded], mode: 'pair',
      stage: 'all', resultsDirectory, allowMotion: true, allowCurrentProtection: true,
      rigFactory: fakeRig });
    assert.deepEqual(report.cases.map(item => item.status), ['passed', 'failed']);
    assert.equal(report.cases[1].observations.length, 1);
    assert.match(report.cases[1].hardStop, /safety case/);
  });
});

test('default mode executes pair-only cases rather than silently skipping them', async () => {
  await withResults(async resultsDirectory => {
    const pair = caseDef('test_pair_default', async ({ ids }) => ({ exact: { ids } }));
    pair.scope = 'pair';
    const { report } = await run(config, { cases: [pair], resultsDirectory, rigFactory: fakeRig });
    assert.equal(report.cases[0].status, 'passed');
    assert.deepEqual(report.cases[0].observations[0].result.exact.ids, [1,2]);
  });
});

test('health failure stops before the candidate and retains the completed observation range', async () => {
  await withResults(async resultsDirectory => {
    const rig = fakeRig();
    let healthChecks = 0;
    rig.health = async () => {
      rig.events.push({ label: 'health' });
      if (++healthChecks > 1) throw new Error('lost connection');
    };
    const entry = caseDef('test_health_loss', async ({ id }) => {
      assert.equal(id, 1, 'candidate must not run after losing factory communication');
      rig.events.push({ label: 'operation' });
      return { exact: { okay: true } };
    });
    const { report } = await run(config, { cases: [entry, caseDef('test_later',
      () => assert.fail('later case must not run'))], resultsDirectory, rigFactory: () => rig });
    assert.deepEqual(report.cases.map(item => item.status), ['failed', 'skipped']);
    const [observation] = report.cases[0].observations;
    assert.deepEqual(observation.eventRange, [1, 2]);
    assert.equal(observation.result.exact.okay, true);
    assert.equal(observation.healthError.message, 'lost connection');
  });
});

test('failed candidate takes priority over an inconclusive factory stimulus', async () => {
  await withResults(async resultsDirectory => {
    const entry = caseDef('test_verdict_precedence', async ({ id }) => {
      if (id === 2) throw new Error('candidate failed');
      return { exact: { profileStarted: false, shaftMoved: false } };
    });
    entry.requiresFactoryEffect = true;
    const { report } = await run(config, { cases: [entry], resultsDirectory, rigFactory: fakeRig });
    assert.equal(report.cases[0].status, 'failed');
    assert.match(report.cases[0].reason, /factory stimulus/);
  });
});

test('comparator errors are recorded as mismatches and the connection is closed', async () => {
  await withResults(async resultsDirectory => {
    const rig = fakeRig();
    let closed = false;
    rig.close = async () => { closed = true; };
    const entry = caseDef('test_bad_comparison', async () => ({ exact: { okay: true } }));
    entry.compare = () => { throw new Error('missing comparison data'); };
    const { report } = await run(config, { cases: [entry], resultsDirectory, rigFactory: () => rig });
    assert.equal(report.cases[0].status, 'mismatch');
    assert.equal(report.cases[0].comparison.error.message, 'missing comparison data');
    assert.equal(closed, true);
  });
});
