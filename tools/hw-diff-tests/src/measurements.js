'use strict';

// Preserve the suite's order statistic: even-sized samples use the upper
// middle value, not the average of the two middle values. Empty input is undefined.
function upperMedian(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function withinTolerance(factory, candidate, tolerance) {
  return Number.isFinite(factory) && Number.isFinite(candidate) &&
    Math.abs(factory - candidate) <= tolerance;
}

function compareEvidence(fields) {
  return (factory, candidate) => {
    const checks = fields.map(([name, tolerance]) => ({
      name, factory: factory.evidence[name], candidate: candidate.evidence[name], tolerance,
    }));
    for (const check of checks) {
      check.matched = withinTolerance(check.factory, check.candidate, check.tolerance);
    }
    return { matched: checks.every(check => check.matched), checks };
  };
}

module.exports = { upperMedian, withinTolerance, compareEvidence };
