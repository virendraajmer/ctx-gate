'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { median, computeSessionStats, STATS_WINDOW_DAYS } = require('../../src/core/stats');

// --- median -------------------------------------------------

test('median returns null for an empty array', () => {
  assert.equal(median([]), null);
});

test('median returns the middle value for an odd-length array', () => {
  assert.equal(median([1, 5, 3]), 3);
});

test('median averages the two middle values for an even-length array', () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

// --- computeSessionStats -------------------------------------------------

const NOW = new Date('2026-01-10T00:00:00.000Z');

function state(overrides = {}) {
  return { turnCount: 1, warningsEmitted: 0, fileReadCounts: {}, lastSeenAt: NOW.toISOString(), ...overrides };
}

test('computeSessionStats only counts sessions within the last 7 days', () => {
  const states = [
    state({ turnCount: 10, lastSeenAt: '2026-01-09T00:00:00.000Z' }), // 1 day old
    state({ turnCount: 999, lastSeenAt: '2025-12-01T00:00:00.000Z' }), // stale, excluded
  ];
  const report = computeSessionStats(states, NOW);
  assert.equal(report.sessionsThisWeek, 1);
  assert.equal(report.medianTurns, 10);
  assert.equal(report.maxTurns, 10);
});

test('computeSessionStats reports not-measured-friendly nulls when there are no recent sessions', () => {
  const report = computeSessionStats([], NOW);
  assert.equal(report.sessionsThisWeek, 0);
  assert.equal(report.medianTurns, null);
  assert.equal(report.maxTurns, null);
});

test('computeSessionStats counts sessions that crossed the soft/hard warning thresholds', () => {
  const states = [
    state({ warningsEmitted: 0 }),
    state({ warningsEmitted: 1 }),
    state({ warningsEmitted: 2 }),
  ];
  const report = computeSessionStats(states, NOW);
  assert.equal(report.sessionsCrossedSoft, 2);
  assert.equal(report.sessionsCrossedHard, 1);
});

test('computeSessionStats aggregates the most re-read files across all sessions, not just the last 7 days', () => {
  const states = [
    state({ fileReadCounts: { 'src/a.js': 3, 'src/b.js': 1 }, lastSeenAt: '2025-01-01T00:00:00.000Z' }), // stale session, still counted for re-reads
    state({ fileReadCounts: { 'src/a.js': 2 } }),
  ];
  const report = computeSessionStats(states, NOW);
  assert.deepEqual(report.mostReread[0], { file: 'src/a.js', totalReads: 5 });
  // src/b.js read only once total (never re-read) is excluded
  assert.equal(report.mostReread.some((e) => e.file === 'src/b.js'), false);
});

test('computeSessionStats caps mostReread at the top N, sorted descending', () => {
  const states = [
    state({
      fileReadCounts: {
        a: 6,
        b: 5,
        c: 4,
        d: 3,
        e: 2,
        f: 10,
      },
    }),
  ];
  const report = computeSessionStats(states, NOW);
  assert.equal(report.mostReread.length, 5);
  assert.deepEqual(
    report.mostReread.map((e) => e.file),
    ['f', 'a', 'b', 'c', 'd']
  );
});

test('STATS_WINDOW_DAYS is 7', () => {
  assert.equal(STATS_WINDOW_DAYS, 7);
});
