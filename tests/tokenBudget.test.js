'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { countTokens, checkBudget, AGENTS_MD_BUDGET } = require('../src/tokenBudget');

test('countTokens returns a real positive count for non-trivial text', () => {
  const count = countTokens('The quick brown fox jumps over the lazy dog.');
  assert.ok(count > 0);
  assert.ok(Number.isInteger(count));
});

test('countTokens returns 0 for empty text', () => {
  assert.equal(countTokens(''), 0);
  assert.equal(countTokens(undefined), 0);
});

test('countTokens grows with text length (a real tokenizer, not a stub)', () => {
  const short = countTokens('hello');
  const long = countTokens('hello '.repeat(500));
  assert.ok(long > short * 10);
});

test('checkBudget reports ok:true when under the limit', () => {
  const result = checkBudget('short text', 1000);
  assert.equal(result.ok, true);
  assert.equal(result.limit, 1000);
  assert.ok(result.count > 0);
});

test('checkBudget reports ok:false when over the limit', () => {
  const text = 'word '.repeat(5000);
  const result = checkBudget(text, AGENTS_MD_BUDGET);
  assert.equal(result.ok, false);
  assert.ok(result.count > AGENTS_MD_BUDGET);
});
