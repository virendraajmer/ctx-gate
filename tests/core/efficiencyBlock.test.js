'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  BASELINE_IGNORE_PATHS,
  resolveTestCommand,
  resolveIgnorePaths,
  buildEfficiencyBlock,
} = require('../../src/core/efficiencyBlock');

test('resolveTestCommand prefers the detected node testCommand', () => {
  const stacks = { node: { detected: true, testCommand: 'jest' }, dotnet: { detected: true } };
  assert.equal(resolveTestCommand(stacks), 'jest');
});

test('resolveTestCommand falls back to a stack-standard default when nothing is detected', () => {
  assert.equal(resolveTestCommand({ dotnet: { detected: true } }), 'dotnet test');
  assert.equal(resolveTestCommand({ python: { detected: true } }), 'pytest');
  assert.equal(resolveTestCommand({}), '<test command>');
});

test('resolveIgnorePaths extends, never replaces, the baseline list', () => {
  const dotnetPaths = resolveIgnorePaths(['dotnet']);
  for (const p of BASELINE_IGNORE_PATHS) {
    assert.ok(dotnetPaths.includes(p));
  }
  assert.ok(dotnetPaths.includes('bin/'));
  assert.ok(dotnetPaths.includes('obj/'));
  assert.ok(dotnetPaths.includes('packages/'));
});

test('resolveIgnorePaths returns just the baseline for stacks with no extension', () => {
  assert.deepEqual(resolveIgnorePaths(['node', 'react']), BASELINE_IGNORE_PATHS);
});

test('buildEfficiencyBlock is a pure function: same input produces byte-identical output', () => {
  const opts = { testCommand: 'npm test', stacksPresent: ['node'] };
  assert.equal(buildEfficiencyBlock(opts), buildEfficiencyBlock(opts));
});

test('buildEfficiencyBlock substitutes the test command and never fabricates unrelated wording', () => {
  const block = buildEfficiencyBlock({ testCommand: 'npm test', stacksPresent: [] });
  assert.match(block, /`npm test > \/tmp\/out\.log 2>&1; grep -A5 "FAIL\\\|Error" \/tmp\/out\.log`/);
  assert.match(block, /## Running commands/);
  assert.match(block, /## Reading files/);
  assert.match(block, /## Editing files/);
  assert.match(block, /## Response style/);
});
