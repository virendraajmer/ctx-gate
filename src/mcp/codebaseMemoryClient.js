'use strict';

// Speaks MCP JSON-RPC over stdio to a locally-installed codebase-memory-mcp
// binary. Never installed automatically by ctx-gate (see README/SECURITY
// and src/core/init.js guidance text) — this module only talks to it if
// it's already on PATH.

const SEARCH_TIMEOUT_MS = 1500; // stays inside the ~2s hook budget

/**
 * @returns {boolean} true if the codebase-memory-mcp binary is on PATH
 */
function isAvailable() {
  throw new Error('not implemented');
}

/**
 * @returns {{ proc: import('child_process').ChildProcess, request: Function }}
 */
function spawnClient() {
  throw new Error('not implemented');
}

/**
 * Resolves to [] on timeout or error rather than rejecting, so callers
 * (gate.js) never need to wrap this in try/catch.
 *
 * @param {string} query
 * @returns {Promise<Array<{ symbol: string, path: string, kind: string }>>}
 */
async function searchCode(query) {
  throw new Error('not implemented');
}

/**
 * Only place indexing is triggered automatically — run manually via
 * `ctx-gate mcp-check` after the developer has installed the binary.
 *
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function runIndexBuildAndConfirm() {
  throw new Error('not implemented');
}

module.exports = { SEARCH_TIMEOUT_MS, isAvailable, spawnClient, searchCode, runIndexBuildAndConfirm };
