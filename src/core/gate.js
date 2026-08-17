'use strict';

// `ctx-gate check` — the userPromptSubmitted hook's core logic. Pure,
// deterministic, zero LLM calls. Operates only on the normalized
// CheckRequest/CheckResponse shapes from src/adapters/types.js; never
// reads hook-specific JSON directly (that's the adapter's job).

const SHORT_FOLLOWUP_WORD_LIMIT = 4;

const VAGUE_TERMS = [
  'properly',
  'handle it',
  'as needed',
  'optimize',
  'etc',
  'some',
  'better',
];

/**
 * @param {string} prompt
 * @param {Object} sessionCache
 * @param {string} sessionId
 * @returns {boolean}
 */
function isShortFollowUp(prompt, sessionCache, sessionId) {
  throw new Error('not implemented');
}

/**
 * @param {string} prompt
 * @param {Object} manifest
 * @returns {import('../adapters/types').CheckMatch[]}
 */
function extractMentionedEntities(prompt, manifest) {
  throw new Error('not implemented');
}

/**
 * @param {string} prompt
 * @param {Object} features
 * @returns {import('../adapters/types').CheckMatch[]}
 */
function matchFeatures(prompt, features) {
  throw new Error('not implemented');
}

/**
 * @param {string} prompt
 * @param {Object} learned
 * @param {Object} manifest
 * @returns {import('../adapters/types').LearnedSuggestion[]}
 */
function matchLearned(prompt, learned, manifest) {
  throw new Error('not implemented');
}

/**
 * @param {string} prompt
 * @param {import('../adapters/types').CheckMatch[]} matches
 * @returns {{ scope: boolean, acceptance: boolean, vagueTerms: string[] }}
 */
function identifyUnknownSlots(prompt, matches) {
  throw new Error('not implemented');
}

/**
 * @param {Object} parts
 * @returns {import('../adapters/types').CheckResponse}
 */
function composeResponse(parts) {
  throw new Error('not implemented');
}

/**
 * @param {import('../adapters/types').CheckRequest} request
 * @param {Object} deps - { manifest, standing, learned, features, searchCode, sessionCache }
 * @returns {Promise<import('../adapters/types').CheckResponse>}
 */
async function runCheck(request, deps) {
  throw new Error('not implemented');
}

module.exports = {
  SHORT_FOLLOWUP_WORD_LIMIT,
  VAGUE_TERMS,
  isShortFollowUp,
  extractMentionedEntities,
  matchFeatures,
  matchLearned,
  identifyUnknownSlots,
  composeResponse,
  runCheck,
};
