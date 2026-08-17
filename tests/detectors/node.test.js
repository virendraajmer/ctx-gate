'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { detectNode } = require('../../src/detectors/node');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

test('detectNode returns facts for a repo with package.json', () => {
  const facts = detectNode(path.join(FIXTURES, 'node-react-basic'));
  assert.equal(facts.detected, true);
  assert.equal(facts.packageManager, 'pnpm');
  assert.equal(facts.testCommand, 'vitest');
  assert.equal(facts.buildCommand, 'vite build');
  assert.equal(facts.lintConfig, '.eslintrc.json');
  assert.ok(facts.dependencies.includes('react'));
  assert.ok(facts.dependencies.includes('react-router-dom'));
});

test('detectNode returns null when there is no package.json', () => {
  const facts = detectNode(path.join(FIXTURES, 'empty-repo'));
  assert.equal(facts, null);
});
