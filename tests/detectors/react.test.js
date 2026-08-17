'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { detectNode } = require('../../src/detectors/node');
const { detectReact } = require('../../src/detectors/react');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

test('detectReact finds react-router route table', () => {
  const repoRoot = path.join(FIXTURES, 'node-react-basic');
  const nodeFacts = detectNode(repoRoot);
  const facts = detectReact(repoRoot, nodeFacts);
  assert.equal(facts.detected, true);
  assert.equal(facts.router, 'react-router');
  const routes = facts.screens.map((s) => s.route).sort();
  assert.deepEqual(routes, ['/', '/orders']);
  assert.ok(facts.screens.every((s) => s.source === 'route-table' && s.confidence === 'high'));
});

test('detectReact returns null when react is not a dependency', () => {
  const repoRoot = path.join(FIXTURES, 'python-fastapi-basic');
  const facts = detectReact(repoRoot, null);
  assert.equal(facts, null);
});
