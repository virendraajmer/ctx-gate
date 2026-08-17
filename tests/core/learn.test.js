'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { recordAndPromote } = require('../../src/core/learn');

const manifest = {
  stacks: {
    react: {
      screens: [{ name: 'Orders', route: '/orders', path: 'src/pages/OrdersPage.tsx', confidence: 'high' }],
    },
  },
};

function sessionCacheFor(prompt, matches = []) {
  return { s1: { checked: true, prompt, matches } };
}

test('recordAndPromote appends an entry with no trigger when there is no session-cache signal', () => {
  const request = { sessionId: 'unknown-session', toolName: 'editFiles', filesTouched: ['src/pages/OrdersPage.tsx'], timestamp: '2026-01-01T00:00:00.000Z' };
  const { answerEntry, learnedPatch } = recordAndPromote(request, { answersLog: [], sessionCache: {}, manifest });

  assert.equal(answerEntry.trigger, null);
  assert.equal(answerEntry.suggestion, null);
  assert.equal(learnedPatch, null);
});

test('recordAndPromote derives a screen suggestion from a touched file matching manifest.stacks.react.screens', () => {
  const request = {
    sessionId: 's1',
    toolName: 'editFiles',
    filesTouched: ['src/pages/OrdersPage.tsx'],
    timestamp: '2026-01-01T00:00:00.000Z',
  };
  const sessionCache = sessionCacheFor('change sorting order');
  const { answerEntry } = recordAndPromote(request, { answersLog: [], sessionCache, manifest });

  assert.deepEqual(answerEntry.suggestion, { screen: 'Orders' });
  assert.deepEqual(answerEntry.trigger.keywords, ['change', 'order', 'sorting']);
  assert.equal(answerEntry.trigger.noScreenNamed, true);
});

test('recordAndPromote does not promote below the occurrence threshold', () => {
  const request = { sessionId: 's1', toolName: 'editFiles', filesTouched: ['src/pages/OrdersPage.tsx'], timestamp: '2026-01-03T00:00:00.000Z' };
  const sessionCache = sessionCacheFor('change sorting order');

  const priorEntry = recordAndPromote(
    { sessionId: 's1', toolName: 'editFiles', filesTouched: ['src/pages/OrdersPage.tsx'], timestamp: '2026-01-02T00:00:00.000Z' },
    { answersLog: [], sessionCache, manifest }
  ).answerEntry;

  const { learnedPatch } = recordAndPromote(request, { answersLog: [priorEntry], sessionCache, manifest });
  assert.equal(learnedPatch, null);
});

test('recordAndPromote promotes to learned.yml at exactly 3 occurrences', () => {
  const sessionCache = sessionCacheFor('change sorting order');
  const makeRequest = (day) => ({
    sessionId: 's1',
    toolName: 'editFiles',
    filesTouched: ['src/pages/OrdersPage.tsx'],
    timestamp: `2026-01-0${day}T00:00:00.000Z`,
  });

  const first = recordAndPromote(makeRequest(1), { answersLog: [], sessionCache, manifest });
  const second = recordAndPromote(makeRequest(2), { answersLog: [first.answerEntry], sessionCache, manifest });
  assert.equal(second.learnedPatch, null);

  const third = recordAndPromote(makeRequest(3), {
    answersLog: [first.answerEntry, second.answerEntry],
    sessionCache,
    manifest,
  });

  assert.ok(third.learnedPatch);
  assert.equal(third.learnedPatch.occurrences, 3);
  assert.deepEqual(third.learnedPatch.suggestion, { screen: 'Orders' });
  assert.equal(third.learnedPatch.confidence, 'learned');
});

test('recordAndPromote falls back to a bare file suggestion when the touched file matches no screen', () => {
  const request = { sessionId: 's1', toolName: 'editFiles', filesTouched: ['src/legacy/report.js'], timestamp: '2026-01-01T00:00:00.000Z' };
  const sessionCache = sessionCacheFor('improve the report generator');
  const { answerEntry } = recordAndPromote(request, { answersLog: [], sessionCache, manifest });

  assert.deepEqual(answerEntry.suggestion, { file: 'src/legacy/report.js' });
});
