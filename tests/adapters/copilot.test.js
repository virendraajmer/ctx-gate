'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseCheckInput, formatCheckOutput, parseLearnInput, parseEnforceInput, formatEnforceOutput } = require('../../src/adapters/copilot');
const { runCheck } = require('../../src/core/gate');

const manifest = {
  stacks: {
    react: {
      detected: true,
      screens: [{ name: 'Orders', route: '/orders', path: 'src/pages/OrdersPage.tsx', confidence: 'high', source: 'route-table' }],
    },
  },
  endpoints: [],
};

test('parseCheckInput produces the CheckRequest shape runCheck expects', () => {
  const stdinJson = JSON.stringify({ prompt: 'update the Orders screen', session_id: 'abc123', cwd: '/repo' });
  const request = parseCheckInput(stdinJson);

  assert.equal(request.prompt, 'update the Orders screen');
  assert.equal(request.sessionId, 'abc123');
  assert.equal(request.cwd, '/repo');
  assert.equal(request.agentName, 'copilot');
});

test('a Copilot stdin payload round-trips through parseCheckInput -> runCheck -> formatCheckOutput', async () => {
  const stdinJson = JSON.stringify({ prompt: 'add validation', session_id: 'session-1', cwd: '/repo' });
  const request = parseCheckInput(stdinJson);

  const response = await runCheck(request, {
    manifest,
    standing: { entries: [] },
    learned: { patterns: [] },
    features: { mappings: [] },
    searchCode: async () => [],
    sessionCache: {},
  });

  const output = formatCheckOutput(response);
  assert.equal(typeof output.additionalContext, 'string');
  assert.match(output.additionalContext, /Ask: Which screen, file, or endpoint/);
  assert.match(output.additionalContext, /Ask: What does "done" mean/);
});

test('formatCheckOutput returns empty context for a skipped response', () => {
  const output = formatCheckOutput({ skipped: true });
  assert.deepEqual(output, { additionalContext: '' });
});

test('parseLearnInput extracts tool name and touched files', () => {
  const stdinJson = JSON.stringify({
    session_id: 'abc',
    tool_name: 'editFiles',
    tool_input: { files: ['src/a.ts', 'src/b.ts'] },
  });
  const request = parseLearnInput(stdinJson);
  assert.equal(request.sessionId, 'abc');
  assert.equal(request.toolName, 'editFiles');
  assert.deepEqual(request.filesTouched, ['src/a.ts', 'src/b.ts']);
});

test('parseEnforceInput classifies a write tool as changeType write', () => {
  const stdinJson = JSON.stringify({ session_id: 'abc', prompt: 'add validation', cwd: '/repo', tool_name: 'editFiles' });
  const request = parseEnforceInput(stdinJson);
  assert.equal(request.changeType, 'write');
  assert.equal(request.toolName, 'editFiles');
  assert.equal(request.check.prompt, 'add validation');
});

test('parseEnforceInput classifies an unknown/read tool as changeType read', () => {
  const stdinJson = JSON.stringify({ session_id: 'abc', prompt: 'search for X', cwd: '/repo', tool_name: 'searchFiles' });
  const request = parseEnforceInput(stdinJson);
  assert.equal(request.changeType, 'read');
});

test('formatEnforceOutput passes through decision and reason', () => {
  const output = formatEnforceOutput({ decision: 'deny', reason: 'missing scope and acceptance' });
  assert.deepEqual(output, { decision: 'deny', reason: 'missing scope and acceptance' });
});
