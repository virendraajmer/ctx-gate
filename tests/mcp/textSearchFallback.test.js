'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { searchCode } = require('../../src/mcp/textSearchFallback');

function gitRepoWithFiles(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-gate-textsearch-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  execFileSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}

test('searchCode finds matching lines in git-tracked files', async () => {
  const dir = gitRepoWithFiles({
    'src/orders.ts': 'export function listOrders() {\n  return db.orders.findAll();\n}\n',
    'src/unrelated.ts': 'export const PI = 3.14;\n',
  });
  try {
    const results = await searchCode(dir, 'orders');
    assert.ok(results.length >= 1);
    assert.ok(results.every((r) => r.kind === 'text-match'));
    assert.ok(results.some((r) => r.path === 'src/orders.ts'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('searchCode returns [] when nothing matches', async () => {
  const dir = gitRepoWithFiles({ 'src/a.ts': 'const x = 1;\n' });
  try {
    const results = await searchCode(dir, 'nonexistentterm');
    assert.deepEqual(results, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('searchCode returns [] on a blank query', async () => {
  const dir = gitRepoWithFiles({ 'src/a.ts': 'const x = 1;\n' });
  try {
    const results = await searchCode(dir, '   ');
    assert.deepEqual(results, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('searchCode returns [] when the directory is not a git repo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-gate-nogit-'));
  fs.writeFileSync(path.join(dir, 'a.ts'), 'orders orders orders\n', 'utf8');
  try {
    const results = await searchCode(dir, 'orders');
    assert.deepEqual(results, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
