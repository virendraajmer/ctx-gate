'use strict';

// Plain-text search over tracked files, used automatically by gate.js
// whenever codebase-memory-mcp isn't available. Same call shape as
// codebaseMemoryClient.searchCode so gate.js doesn't need to branch.

/**
 * @param {string} repoRoot
 * @param {string} query
 * @returns {Promise<Array<{ symbol: string, path: string, kind: string }>>}
 */
async function searchCode(repoRoot, query) {
  throw new Error('not implemented');
}

module.exports = { searchCode };
