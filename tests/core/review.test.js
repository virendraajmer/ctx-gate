'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { review, STALE_LEARNED_DAYS } = require('../../src/core/review');

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-gate-review-'));
}

test('review flags a learned pattern unused for 90+ days', () => {
  const dir = tmpRepo();
  try {
    const learned = {
      patterns: [
        { id: 'old-pattern', last_seen: '2000-01-01T00:00:00.000Z' },
        { id: 'fresh-pattern', last_seen: new Date().toISOString() },
      ],
    };
    const { stalePatterns } = review(dir, { learned, standing: { entries: [] }, now: new Date() });
    assert.deepEqual(stalePatterns.map((p) => p.id), ['old-pattern']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('review flags a riskPaths standing entry whose path no longer exists', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'src', 'payments'), { recursive: true });
  try {
    const standing = {
      entries: [{ id: 'high-risk-paths', slot: 'riskPaths', value: 'src/payments/, src/deleted-module/' }],
    };
    const { staleStandingEntries } = review(dir, { learned: { patterns: [] }, standing });
    assert.equal(staleStandingEntries.length, 1);
    assert.equal(staleStandingEntries[0].id, 'high-risk-paths');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('review returns empty lists when nothing is stale, never mutates files', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'src', 'payments'), { recursive: true });
  try {
    const learned = { patterns: [{ id: 'fresh', last_seen: new Date().toISOString() }] };
    const standing = { entries: [{ id: 'high-risk-paths', slot: 'riskPaths', value: 'src/payments/' }] };
    const result = review(dir, { learned, standing });
    assert.deepEqual(result, { stalePatterns: [], staleStandingEntries: [] });
    assert.deepEqual(fs.readdirSync(dir), ['src']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('STALE_LEARNED_DAYS is 90 per the doc', () => {
  assert.equal(STALE_LEARNED_DAYS, 90);
});
