'use strict';

function distribution(values) {
  if (!values.length) return { count: 0, min: null, mean: null, p50: null, p95: null, p99: null, p999: null, max: null, stddev: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const percentile = fraction => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  return { count: sorted.length, min: sorted[0], mean, p50: percentile(.5),
    p95: percentile(.95), p99: percentile(.99), p999: percentile(.999), max: sorted.at(-1),
    stddev: Math.sqrt(sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length) };
}

function summarize(records) {
  const counts = {};
  for (const record of records) counts[record.outcome] = (counts[record.outcome] ?? 0) + 1;
  const timings = name => distribution(records.map(record => record[name]).filter(Number.isFinite));
  return { attempts: records.length, counts, latencyMs: timings('latencyMs'),
    firstRxMs: timings('firstRxMs'), writeDrainMs: timings('writeDrainMs'),
    transactionMs: timings('transactionMs'),
    timeoutRate: records.length ? (counts.timeout ?? 0) / records.length : null,
    unexpectedFrames: records.reduce((sum, r) => sum + r.unexpectedFrames, 0),
    duplicateFrames: records.reduce((sum, r) => sum + (r.duplicateFrames ?? 0), 0),
    diagnosticEvents: records.reduce((sum, r) => sum + r.diagnostics.length, 0) };
}
module.exports = { distribution, summarize };
