'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const CLI = path.join(__dirname, '..', 'bin', 'ctx-gate.js');

test('ctx-gate --version prints the VERSION file contents', () => {
  const version = fs
    .readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8')
    .trim();
  const out = execFileSync('node', [CLI, '--version'], { encoding: 'utf8' });
  assert.equal(out.trim(), `ctx-gate ${version}`);
});

test('adapters registry resolves the copilot adapter', () => {
  const { resolveAdapter } = require('../src/adapters');
  const adapter = resolveAdapter('copilot');
  assert.equal(typeof adapter.parseCheckInput, 'function');
  assert.equal(typeof adapter.formatCheckOutput, 'function');
  assert.equal(typeof adapter.parseLearnInput, 'function');
  assert.equal(typeof adapter.parseEnforceInput, 'function');
  assert.equal(typeof adapter.formatEnforceOutput, 'function');
});

test('adapters registry rejects an unknown adapter name', () => {
  const { resolveAdapter } = require('../src/adapters');
  assert.throws(() => resolveAdapter('does-not-exist'), /Unknown agent adapter/);
});
