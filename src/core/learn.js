'use strict';

// `ctx-gate learn` — the postToolUse hook's core logic. Records
// filesTouched to answers.jsonl and promotes repeated trigger→answer
// patterns into learned.yml after 3 occurrences.

/**
 * @param {import('../adapters/types').LearnRequest} request
 * @param {Object} deps - { answersLogPath, learnedYmlPath, readLearned, writeLearned }
 * @returns {Promise<void>}
 */
async function recordAndPromote(request, deps) {
  throw new Error('not implemented');
}

module.exports = { recordAndPromote };
