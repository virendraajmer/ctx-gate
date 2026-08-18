'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { recordAndPromote, updateSessionState, findStaleSessionStates, parseMcpServerName, recordMcpUsage } = require('../../src/core/learn');

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

  assert.ok(third.glossaryPatch);
  assert.equal(third.glossaryPatch.term, 'change order sorting');
  assert.equal(third.glossaryPatch.status, 'candidate');
  assert.deepEqual(third.glossaryPatch.paths, ['src/pages/OrdersPage.tsx']);
  assert.equal(third.glossaryPatch.definition, '');
});

test('recordAndPromote produces no glossaryPatch below the occurrence threshold', () => {
  const request = { sessionId: 's1', toolName: 'editFiles', filesTouched: ['src/pages/OrdersPage.tsx'], timestamp: '2026-01-01T00:00:00.000Z' };
  const sessionCache = sessionCacheFor('change sorting order');
  const { glossaryPatch } = recordAndPromote(request, { answersLog: [], sessionCache, manifest });
  assert.equal(glossaryPatch, null);
});

// --- updateSessionState -------------------------------------------------

test('updateSessionState initializes fresh state on the first turn', () => {
  const state = updateSessionState(null, {
    sessionId: 's1',
    timestamp: '2026-01-01T00:00:00.000Z',
    filesTouched: ['src/a.js', 'src/b.js'],
    bytesRead: 1000,
  });
  assert.equal(state.sessionId, 's1');
  assert.equal(state.turnCount, 1);
  assert.equal(state.estimatedBytesRead, 1000);
  assert.deepEqual(state.filesRead, ['src/a.js', 'src/b.js']);
  assert.deepEqual(state.fileReadCounts, { 'src/a.js': 1, 'src/b.js': 1 });
  assert.equal(state.warningsEmitted, 0);
  assert.equal(state.startedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(state.lastSeenAt, '2026-01-01T00:00:00.000Z');
});

test('updateSessionState accumulates turns/bytes and dedupes filesRead across turns', () => {
  const first = updateSessionState(null, {
    sessionId: 's1',
    timestamp: '2026-01-01T00:00:00.000Z',
    filesTouched: ['src/a.js'],
    bytesRead: 500,
  });
  const second = updateSessionState(first, {
    sessionId: 's1',
    timestamp: '2026-01-01T00:05:00.000Z',
    filesTouched: ['src/a.js', 'src/c.js'],
    bytesRead: 500,
  });

  assert.equal(second.turnCount, 2);
  assert.equal(second.estimatedBytesRead, 1000);
  assert.deepEqual(second.filesRead, ['src/a.js', 'src/c.js']);
  assert.deepEqual(second.fileReadCounts, { 'src/a.js': 2, 'src/c.js': 1 });
  assert.equal(second.lastSeenAt, '2026-01-01T00:05:00.000Z');
});

test('updateSessionState does not mutate the existing state object it was given', () => {
  const original = updateSessionState(null, {
    sessionId: 's1',
    timestamp: '2026-01-01T00:00:00.000Z',
    filesTouched: ['src/a.js'],
    bytesRead: 500,
  });
  const snapshot = JSON.parse(JSON.stringify(original));

  updateSessionState(original, {
    sessionId: 's1',
    timestamp: '2026-01-01T00:05:00.000Z',
    filesTouched: ['src/a.js', 'src/b.js'],
    bytesRead: 500,
  });

  assert.deepEqual(original, snapshot);
});

test('updateSessionState counts a written session-handoff file', () => {
  const state = updateSessionState(null, {
    sessionId: 's1',
    timestamp: '2026-01-01T00:00:00.000Z',
    filesTouched: ['.agentflow/handoffs/2026-01-01T00-00-00.md'],
    bytesRead: 200,
  });
  assert.equal(state.handoffsWritten, 1);
});

test('updateSessionState does not double-count the same handoff file across turns', () => {
  const first = updateSessionState(null, {
    sessionId: 's1',
    timestamp: '2026-01-01T00:00:00.000Z',
    filesTouched: ['.agentflow/handoffs/2026-01-01T00-00-00.md'],
    bytesRead: 200,
  });
  const second = updateSessionState(first, {
    sessionId: 's1',
    timestamp: '2026-01-01T00:05:00.000Z',
    filesTouched: ['.agentflow/handoffs/2026-01-01T00-00-00.md'],
    bytesRead: 200,
  });
  assert.equal(second.handoffsWritten, 1);
});

test('updateSessionState does not count an unrelated .agentflow file as a handoff', () => {
  const state = updateSessionState(null, {
    sessionId: 's1',
    timestamp: '2026-01-01T00:00:00.000Z',
    filesTouched: ['.agentflow/add-retry-queue/plan.md'],
    bytesRead: 200,
  });
  assert.equal(state.handoffsWritten, 0);
});

// --- findStaleSessionStates -------------------------------------------------

test('findStaleSessionStates flags sessions unseen for 7+ days and keeps recent ones', () => {
  const now = new Date('2026-01-10T00:00:00.000Z');
  const sessionStates = [
    { sessionId: 'old', state: { lastSeenAt: '2026-01-01T00:00:00.000Z' } }, // 9 days old
    { sessionId: 'boundary', state: { lastSeenAt: '2026-01-03T00:00:00.000Z' } }, // exactly 7 days old
    { sessionId: 'recent', state: { lastSeenAt: '2026-01-09T00:00:00.000Z' } }, // 1 day old
  ];
  const stale = findStaleSessionStates(sessionStates, now);
  assert.deepEqual(stale.sort(), ['boundary', 'old']);
});

test('findStaleSessionStates treats a missing lastSeenAt as stale', () => {
  const now = new Date('2026-01-10T00:00:00.000Z');
  const stale = findStaleSessionStates([{ sessionId: 'broken', state: {} }], now);
  assert.deepEqual(stale, ['broken']);
});

test('findStaleSessionStates respects a custom ttlDays', () => {
  const now = new Date('2026-01-10T00:00:00.000Z');
  const sessionStates = [{ sessionId: 's1', state: { lastSeenAt: '2026-01-09T00:00:00.000Z' } }]; // 1 day old
  assert.deepEqual(findStaleSessionStates(sessionStates, now, 1), ['s1']);
  assert.deepEqual(findStaleSessionStates(sessionStates, now, 2), []);
});

// --- parseMcpServerName / recordMcpUsage ------------------------------------

test('parseMcpServerName extracts the server from an mcp__<server>__<tool> tool name', () => {
  assert.equal(parseMcpServerName('mcp__codebase-memory-mcp__list_projects'), 'codebase-memory-mcp');
});

test('parseMcpServerName returns null for a non-MCP tool name', () => {
  assert.equal(parseMcpServerName('editFiles'), null);
  assert.equal(parseMcpServerName(''), null);
  assert.equal(parseMcpServerName(undefined), null);
});

test('recordMcpUsage returns the same reference untouched for a non-MCP tool name', () => {
  const usage = { github: { calls: 1, lastUsed: '2026-01-01T00:00:00.000Z', firstSeen: '2026-01-01T00:00:00.000Z' } };
  const result = recordMcpUsage(usage, 'editFiles', '2026-01-02T00:00:00.000Z');
  assert.equal(result, usage);
});

test('recordMcpUsage creates a new server entry with firstSeen set on first call', () => {
  const result = recordMcpUsage({}, 'mcp__playwright__navigate', '2026-01-05T00:00:00.000Z');
  assert.deepEqual(result, {
    playwright: { calls: 1, lastUsed: '2026-01-05T00:00:00.000Z', firstSeen: '2026-01-05T00:00:00.000Z' },
  });
});

test('recordMcpUsage increments calls and advances lastUsed while preserving firstSeen', () => {
  const usage = {
    playwright: { calls: 3, lastUsed: '2026-01-05T00:00:00.000Z', firstSeen: '2026-01-01T00:00:00.000Z' },
  };
  const result = recordMcpUsage(usage, 'mcp__playwright__navigate', '2026-01-10T00:00:00.000Z');
  assert.deepEqual(result.playwright, { calls: 4, lastUsed: '2026-01-10T00:00:00.000Z', firstSeen: '2026-01-01T00:00:00.000Z' });
});

test('recordMcpUsage does not mutate the usage state object it was given', () => {
  const usage = { playwright: { calls: 1, lastUsed: '2026-01-01T00:00:00.000Z', firstSeen: '2026-01-01T00:00:00.000Z' } };
  const snapshot = JSON.parse(JSON.stringify(usage));
  recordMcpUsage(usage, 'mcp__playwright__navigate', '2026-01-02T00:00:00.000Z');
  assert.deepEqual(usage, snapshot);
});

test('recordAndPromote falls back to a bare file suggestion when the touched file matches no screen', () => {
  const request = { sessionId: 's1', toolName: 'editFiles', filesTouched: ['src/legacy/report.js'], timestamp: '2026-01-01T00:00:00.000Z' };
  const sessionCache = sessionCacheFor('improve the report generator');
  const { answerEntry } = recordAndPromote(request, { answersLog: [], sessionCache, manifest });

  assert.deepEqual(answerEntry.suggestion, { file: 'src/legacy/report.js' });
});
