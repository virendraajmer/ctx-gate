'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const {
  readMcpJson,
  measureServer,
  ensureUsageStubs,
  buildAuditReport,
  buildTrimProposal,
  buildTrimDiff,
} = require('../../src/mcp/mcpAudit');

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-gate-mcp-audit-'));
}

// Same fake ChildProcess-like object as tests/mcp/codebaseMemoryClient.test.js.
function fakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: () => {} };
  proc.killed = false;
  proc.kill = function kill() {
    proc.killed = true;
  };
  return proc;
}

const FIXTURE_TOOLS = [
  { name: 'searchCode', description: 'Search the codebase', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
  { name: 'buildIndex', description: 'Build the index', inputSchema: { type: 'object' } },
];

// --- readMcpJson ---------------------------------------------------------

test('readMcpJson reports absent when .vscode/mcp.json does not exist', () => {
  const dir = tmpRepo();
  try {
    const result = readMcpJson(dir);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'absent');
    assert.deepEqual(result.servers, {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readMcpJson reports malformed on invalid JSON, never crashes', () => {
  const dir = tmpRepo();
  try {
    fs.mkdirSync(path.join(dir, '.vscode'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.vscode', 'mcp.json'), '{ not valid json', 'utf8');
    const result = readMcpJson(dir);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'malformed');
    assert.deepEqual(result.servers, {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readMcpJson parses a well-formed file', () => {
  const dir = tmpRepo();
  try {
    fs.mkdirSync(path.join(dir, '.vscode'), { recursive: true });
    const contents = { servers: { github: { command: 'github-mcp', args: ['serve'] } } };
    fs.writeFileSync(path.join(dir, '.vscode', 'mcp.json'), JSON.stringify(contents, null, 2), 'utf8');
    const result = readMcpJson(dir);
    assert.equal(result.ok, true);
    assert.deepEqual(result.servers, contents.servers);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- measureServer ---------------------------------------------------------

test('measureServer measures real token counts from a fixture tools/list response', async () => {
  const proc = fakeProc();
  const spawnFn = () => proc;

  const resultPromise = measureServer('codebase-memory', { command: 'codebase-memory-mcp', args: ['mcp'] }, {
    spawn: spawnFn,
    timeoutMs: 1000,
  });

  setImmediate(() => {
    const response = { jsonrpc: '2.0', id: 1, result: { tools: FIXTURE_TOOLS } };
    proc.stdout.emit('data', Buffer.from(`${JSON.stringify(response)}\n`));
  });

  const result = await resultPromise;
  assert.equal(result.name, 'codebase-memory');
  assert.equal(result.measured, true);
  assert.equal(result.toolCount, 2);
  assert.ok(result.tokens > 0, 'expected a real positive token count, not an estimate');
  // Real tokenizer, not a stub — must scale with the serialized schema size.
  const expectedTokens = require('../../src/tokenBudget').countTokens(JSON.stringify(FIXTURE_TOOLS));
  assert.equal(result.tokens, expectedTokens);
  assert.equal(proc.killed, true);
});

test('measureServer reports not measured (never an estimate) on timeout', async () => {
  const proc = fakeProc();
  const spawnFn = () => proc;

  const result = await measureServer('slow-server', { command: 'slow-mcp' }, { spawn: spawnFn, timeoutMs: 20 });
  assert.equal(result.measured, false);
  assert.equal(result.toolCount, null);
  assert.equal(result.tokens, null);
});

test('measureServer reports not measured when the server has no command (cannot start)', async () => {
  const result = await measureServer('broken', {}, {});
  assert.equal(result.measured, false);
});

test('measureServer reports not measured on a malformed tools/list response', async () => {
  const proc = fakeProc();
  const spawnFn = () => proc;

  const resultPromise = measureServer('weird', { command: 'weird-mcp' }, { spawn: spawnFn, timeoutMs: 1000 });
  setImmediate(() => {
    const response = { jsonrpc: '2.0', id: 1, result: { notTools: [] } };
    proc.stdout.emit('data', Buffer.from(`${JSON.stringify(response)}\n`));
  });
  const result = await resultPromise;
  assert.equal(result.measured, false);
});

// --- ensureUsageStubs ------------------------------------------------------

test('ensureUsageStubs adds a firstSeen stub only for servers missing from usage state', () => {
  const usage = { github: { calls: 3, lastUsed: '2026-01-01T00:00:00.000Z', firstSeen: '2025-12-01T00:00:00.000Z' } };
  const { usage: next, changed } = ensureUsageStubs(usage, ['github', 'playwright'], '2026-02-01T00:00:00.000Z');
  assert.equal(changed, true);
  assert.deepEqual(next.github, usage.github); // untouched
  assert.deepEqual(next.playwright, { calls: 0, lastUsed: null, firstSeen: '2026-02-01T00:00:00.000Z' });
});

test('ensureUsageStubs reports changed:false when nothing needs stubbing', () => {
  const usage = { github: { calls: 3, lastUsed: '2026-01-01T00:00:00.000Z', firstSeen: '2025-12-01T00:00:00.000Z' } };
  const { changed } = ensureUsageStubs(usage, ['github'], '2026-02-01T00:00:00.000Z');
  assert.equal(changed, false);
});

// --- buildAuditReport / buildTrimProposal ----------------------------------

const NOW = new Date('2026-02-01T00:00:00.000Z');

function measurement(name, overrides = {}) {
  return { name, measured: true, toolCount: 10, tokens: 1000, ...overrides };
}

test('buildTrimProposal never proposes removing a not-measured server', () => {
  const measurements = [measurement('flaky', { measured: false, toolCount: null, tokens: null })];
  const usage = { flaky: { calls: 0, lastUsed: null, firstSeen: '2025-01-01T00:00:00.000Z' } }; // long window, but unmeasured
  const report = buildAuditReport(measurements, usage, { unusedAfterDays: 30 }, NOW);
  const proposal = buildTrimProposal(report.rows, { unusedAfterDays: 30 });

  assert.deepEqual(proposal.candidates, []);
  assert.deepEqual(proposal.notMeasuredSkipped, [{ name: 'flaky' }]);
});

test('buildTrimProposal refuses to recommend removal when the usage window is too short', () => {
  const measurements = [measurement('playwright')];
  // Only 5 days of tracking so far, well under the 30-day threshold.
  const usage = { playwright: { calls: 0, lastUsed: null, firstSeen: '2026-01-27T00:00:00.000Z' } };
  const report = buildAuditReport(measurements, usage, { unusedAfterDays: 30 }, NOW);
  const proposal = buildTrimProposal(report.rows, { unusedAfterDays: 30 });

  assert.deepEqual(proposal.candidates, []);
  assert.equal(proposal.insufficientWindow.length, 1);
  assert.equal(proposal.insufficientWindow[0].name, 'playwright');
  assert.equal(proposal.insufficientWindow[0].daysCovered, 5);
  assert.equal(proposal.insufficientWindow[0].neededDays, 30);
});

test('buildTrimProposal proposes a measured, zero-call server once the window is fully covered', () => {
  const measurements = [measurement('playwright', { tokens: 3910 })];
  const usage = { playwright: { calls: 0, lastUsed: null, firstSeen: '2025-12-01T00:00:00.000Z' } }; // 62 days
  const report = buildAuditReport(measurements, usage, { unusedAfterDays: 30 }, NOW);
  const proposal = buildTrimProposal(report.rows, { unusedAfterDays: 30 });

  assert.deepEqual(proposal.candidates, [{ name: 'playwright', tokens: 3910 }]);
  assert.deepEqual(proposal.insufficientWindow, []);
});

test('buildTrimProposal never proposes a server that has been called', () => {
  const measurements = [measurement('github')];
  const usage = { github: { calls: 8, lastUsed: '2026-01-30T00:00:00.000Z', firstSeen: '2025-01-01T00:00:00.000Z' } };
  const report = buildAuditReport(measurements, usage, { unusedAfterDays: 30 }, NOW);
  const proposal = buildTrimProposal(report.rows, { unusedAfterDays: 30 });

  assert.deepEqual(proposal.candidates, []);
});

test('buildAuditReport totals tools/tokens across measured servers and flags unused ones', () => {
  const measurements = [
    measurement('codebase-memory', { toolCount: 15, tokens: 2180 }),
    measurement('github', { toolCount: 41, tokens: 6340 }),
    measurement('playwright', { toolCount: 24, tokens: 3910 }),
  ];
  const usage = {
    'codebase-memory': { calls: 412, lastUsed: '2026-01-31T00:00:00.000Z', firstSeen: '2025-01-01T00:00:00.000Z' },
    github: { calls: 8, lastUsed: '2026-01-20T00:00:00.000Z', firstSeen: '2025-01-01T00:00:00.000Z' },
    playwright: { calls: 0, lastUsed: null, firstSeen: '2025-01-01T00:00:00.000Z' },
  };
  const report = buildAuditReport(measurements, usage, { unusedAfterDays: 30, warnAboveTokens: 8000 }, NOW);

  assert.equal(report.totalTools, 80);
  assert.equal(report.totalTokens, 12430);
  assert.deepEqual(report.unused.map((r) => r.name), ['playwright']);
  assert.equal(report.exceedsWarn, true);
});

// --- buildTrimDiff -----------------------------------------------------

test('buildTrimDiff removes the named servers and leaves the rest of the file intact', () => {
  const raw = {
    servers: {
      'codebase-memory': { command: 'codebase-memory-mcp', args: ['mcp'] },
      playwright: { command: 'playwright-mcp' },
    },
  };
  const rawText = `${JSON.stringify(raw, null, 2)}\n`;
  const mcpJson = { ok: true, servers: raw.servers, raw, rawText };

  const { diffText, nextJson } = buildTrimDiff(mcpJson, ['playwright']);

  assert.deepEqual(Object.keys(nextJson.servers), ['codebase-memory']);
  assert.match(diffText, /-\s*"playwright":/);
});
