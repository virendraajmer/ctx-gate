'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { detectPython } = require('../../src/detectors/python');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

test('detectPython finds fastapi framework and endpoints with symbols', () => {
  const facts = detectPython(path.join(FIXTURES, 'python-fastapi-basic'));
  assert.equal(facts.detected, true);
  assert.equal(facts.framework, 'fastapi');
  assert.equal(facts.endpoints.length, 2);
  const get = facts.endpoints.find((e) => e.method === 'GET');
  assert.equal(get.route, '/api/orders');
  assert.equal(get.path, 'src/api/orders.py#list_orders');
  assert.equal(get.confidence, 'high');
});

test('detectPython returns null when there is no python manifest', () => {
  const facts = detectPython(path.join(FIXTURES, 'empty-repo'));
  assert.equal(facts, null);
});
