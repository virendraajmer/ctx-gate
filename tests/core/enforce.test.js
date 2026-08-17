'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { computeEffectiveLevel, assertNoDowngrade, decide, setLocalOverride } = require('../../src/core/enforce');
const store = require('../../src/memory/store');

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-gate-enforce-'));
}

// --- computeEffectiveLevel: all 9 (team, local) combinations --------------

const LEVELS = ['off', 'warn', 'block'];
const EXPECTED = {
  'off,off': 'off',
  'off,warn': 'warn',
  'off,block': 'block',
  'warn,off': 'warn',
  'warn,warn': 'warn',
  'warn,block': 'block',
  'block,off': 'block',
  'block,warn': 'block',
  'block,block': 'block',
};

for (const team of LEVELS) {
  for (const local of LEVELS) {
    test(`computeEffectiveLevel(${team}, ${local}) === ${EXPECTED[`${team},${local}`]}`, () => {
      assert.equal(computeEffectiveLevel(team, local), EXPECTED[`${team},${local}`]);
    });
  }
}

test('computeEffectiveLevel treats an absent local level as off', () => {
  assert.equal(computeEffectiveLevel('warn', null), 'warn');
  assert.equal(computeEffectiveLevel('warn', undefined), 'warn');
});

// --- assertNoDowngrade -------------------------------------------------

test('assertNoDowngrade allows a local level at or above team level', () => {
  assert.doesNotThrow(() => assertNoDowngrade('warn', 'block'));
  assert.doesNotThrow(() => assertNoDowngrade('warn', 'warn'));
  assert.doesNotThrow(() => assertNoDowngrade('off', null));
});

test('assertNoDowngrade rejects a local level below team level', () => {
  assert.throws(() => assertNoDowngrade('block', 'off'), /may only raise the effective level/);
  assert.throws(() => assertNoDowngrade('warn', 'off'), /may only raise the effective level/);
});

// --- decide -------------------------------------------------

function checkRequest(sessionId, changeType) {
  return { check: { prompt: 'add validation', sessionId, cwd: '/repo' }, toolName: 'editFiles', changeType };
}

test('decide always allows read-only tools regardless of level', () => {
  const result = decide(checkRequest('s1', 'read'), { effectiveLevel: 'block', sessionCache: {}, answersLog: [] });
  assert.deepEqual(result, { decision: 'allow' });
});

test('decide allows everything when effective level is off', () => {
  const result = decide(checkRequest('s1', 'write'), { effectiveLevel: 'off', sessionCache: {}, answersLog: [] });
  assert.deepEqual(result, { decision: 'allow' });
});

test('decide warns (never denies) when effective level is warn', () => {
  const sessionCache = { s1: { unknownSlots: ['scope', 'acceptance'], timestamp: '2026-01-01T00:00:00.000Z' } };
  const result = decide(checkRequest('s1', 'write'), { effectiveLevel: 'warn', sessionCache, answersLog: [] });
  assert.equal(result.decision, 'warn');
});

test('decide denies a write when block level + both scope and acceptance unknown + no answer since', () => {
  const sessionCache = { s1: { unknownSlots: ['scope', 'acceptance'], timestamp: '2026-01-01T00:00:00.000Z' } };
  const result = decide(checkRequest('s1', 'write'), { effectiveLevel: 'block', sessionCache, answersLog: [] });
  assert.equal(result.decision, 'deny');
});

test('decide stays conservative: only scope unknown (not acceptance) never denies', () => {
  const sessionCache = { s1: { unknownSlots: ['scope'], timestamp: '2026-01-01T00:00:00.000Z' } };
  const result = decide(checkRequest('s1', 'write'), { effectiveLevel: 'block', sessionCache, answersLog: [] });
  assert.equal(result.decision, 'allow');
});

test('decide allows once an answer has been recorded since the flagged check', () => {
  const sessionCache = { s1: { unknownSlots: ['scope', 'acceptance'], timestamp: '2026-01-01T00:00:00.000Z' } };
  const answersLog = [{ sessionId: 's1', timestamp: '2026-01-02T00:00:00.000Z' }];
  const result = decide(checkRequest('s1', 'write'), { effectiveLevel: 'block', sessionCache, answersLog });
  assert.equal(result.decision, 'allow');
});

test('decide allows when there is no session record at all', () => {
  const result = decide(checkRequest('unknown-session', 'write'), { effectiveLevel: 'block', sessionCache: {}, answersLog: [] });
  assert.deepEqual(result, { decision: 'allow' });
});

// --- setLocalOverride -------------------------------------------------

test('setLocalOverride writes only config.local.yml, never config.yml', () => {
  const dir = tmpRepo();
  try {
    setLocalOverride(dir, 'block');
    const { team, local } = store.readConfig(dir);
    assert.equal(team, null);
    assert.deepEqual(local, { version: 1, enforcement: 'block' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('setLocalOverride rejects an invalid level', () => {
  const dir = tmpRepo();
  try {
    assert.throws(() => setLocalOverride(dir, 'nonsense'), /Invalid enforcement level/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
