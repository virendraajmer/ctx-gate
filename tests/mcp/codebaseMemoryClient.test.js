'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const {
  isAvailable,
  guidanceText,
  searchCode,
  runIndexBuildAndConfirm,
} = require('../../src/mcp/codebaseMemoryClient');

const BIN_NAME = process.platform === 'win32' ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp';

function tmpPathDir(withBinary) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-gate-path-'));
  if (withBinary) {
    fs.writeFileSync(path.join(dir, BIN_NAME), '');
  }
  return dir;
}

test('isAvailable returns true when the binary is on PATH', () => {
  const dir = tmpPathDir(true);
  try {
    assert.equal(isAvailable({ PATH: dir }), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('isAvailable returns false when PATH has no matching binary', () => {
  const dir = tmpPathDir(false);
  try {
    assert.equal(isAvailable({ PATH: dir }), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('isAvailable returns false for an empty PATH', () => {
  assert.equal(isAvailable({ PATH: '' }), false);
});

test('guidanceText differs between win32 and other platforms, never fabricates a URL', () => {
  const win = guidanceText('win32');
  const mac = guidanceText('darwin');
  assert.match(win, /WSL2/);
  assert.doesNotMatch(mac, /WSL2/);
  assert.doesNotMatch(win, /https?:\/\//);
  assert.doesNotMatch(mac, /https?:\/\//);
});

// Fake ChildProcess-like object driving the same stdout/stdin/stderr shape
// spawnClient expects, so searchCode's JSON-RPC framing can be exercised
// without a real codebase-memory-mcp binary.
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

test('searchCode resolves matches from a well-formed JSON-RPC response', async () => {
  const proc = fakeProc();
  const requests = [];
  const spawnFn = () => proc;

  const resultPromise = searchCode('orders', {
    spawn: spawnFn,
    timeoutMs: 1000,
  });

  // Give spawnClient a tick to register its stdout listener before we
  // simulate the server responding.
  setImmediate(() => {
    const response = { jsonrpc: '2.0', id: 1, result: [{ symbol: 'listOrders', path: 'src/orders.ts', kind: 'function' }] };
    proc.stdout.emit('data', Buffer.from(`${JSON.stringify(response)}\n`));
  });

  const results = await resultPromise;
  assert.deepEqual(results, [{ symbol: 'listOrders', path: 'src/orders.ts', kind: 'function' }]);
  assert.equal(proc.killed, true);
  void requests;
});

test('searchCode resolves to [] on timeout rather than rejecting', async () => {
  const proc = fakeProc();
  const spawnFn = () => proc;

  const results = await searchCode('orders', { spawn: spawnFn, timeoutMs: 20 });
  assert.deepEqual(results, []);
});

test('runIndexBuildAndConfirm reports guidance when the binary is unavailable', async () => {
  const result = await runIndexBuildAndConfirm('/some/repo', { env: { PATH: '' }, platform: 'darwin' });
  assert.equal(result.success, false);
  assert.match(result.message, /codebase-memory-mcp not found on PATH/);
});

test('runIndexBuildAndConfirm reports success on a well-formed build response', async () => {
  const proc = fakeProc();
  const spawnFn = () => proc;

  const dir = tmpPathDir(true);
  try {
    const resultPromise = runIndexBuildAndConfirm('/some/repo', {
      env: { PATH: dir },
      spawn: spawnFn,
      timeoutMs: 1000,
    });

    setImmediate(() => {
      const response = { jsonrpc: '2.0', id: 1, result: { indexed: true } };
      proc.stdout.emit('data', Buffer.from(`${JSON.stringify(response)}\n`));
    });

    const result = await resultPromise;
    assert.equal(result.success, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
