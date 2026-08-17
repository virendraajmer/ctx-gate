'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { sniffErrorHandling, deriveRiskPathsFromCodeowners } = require('../../src/core/standingSniffers');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

test('sniffErrorHandling detects Result/Either usage', () => {
  const value = sniffErrorHandling(path.join(FIXTURES, 'standing-detect-basic'));
  assert.equal(value, 'Services return a Result/Either type rather than throwing exceptions');
});

test('sniffErrorHandling returns null when there is no signal', () => {
  const value = sniffErrorHandling(path.join(FIXTURES, 'empty-repo'));
  assert.equal(value, null);
});

test('deriveRiskPathsFromCodeowners parses CODEOWNERS patterns', () => {
  const paths = deriveRiskPathsFromCodeowners(path.join(FIXTURES, 'standing-detect-basic'));
  assert.deepEqual(paths, ['src/payments/', 'src/auth/']);
});

test('deriveRiskPathsFromCodeowners returns [] when there is no CODEOWNERS file', () => {
  const paths = deriveRiskPathsFromCodeowners(path.join(FIXTURES, 'empty-repo'));
  assert.deepEqual(paths, []);
});
