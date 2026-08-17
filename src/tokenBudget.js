'use strict';

// Real tokenizer-based counting and budget enforcement. Never estimate —
// if a count can't be computed, callers must say "not measured," never
// guess (see the no-fabricated-numbers constraint).
//
// Uses gpt-tokenizer (pure JS, OpenAI-compatible cl100k/o200k encoding).
// This is an approximation of whatever tokenizer Copilot's models
// actually use — budgets below carry headroom for that difference.

const AGENTS_MD_BUDGET = 1500;
const INSTRUCTIONS_BUDGET = 800;
const SKILL_BUDGET = 1000;

/**
 * @param {string} text
 * @returns {number} real token count via gpt-tokenizer
 */
function countTokens(text) {
  throw new Error('not implemented');
}

/**
 * @param {string} text
 * @param {number} limitTokens
 * @returns {{ ok: boolean, count: number, limit: number }}
 */
function checkBudget(text, limitTokens) {
  throw new Error('not implemented');
}

module.exports = { AGENTS_MD_BUDGET, INSTRUCTIONS_BUDGET, SKILL_BUDGET, countTokens, checkBudget };
