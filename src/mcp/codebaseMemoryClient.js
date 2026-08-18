'use strict';

// Speaks MCP JSON-RPC over stdio to a locally-installed codebase-memory-mcp
// binary. Never installed automatically by ctx-gate (see README/SECURITY
// and src/core/init.js guidance text) — this module only talks to it if
// it's already on PATH.
//
// TODO(mcp-protocol): the JSON-RPC method names used here (`searchCode`,
// `buildIndex`) are best-guess against the codebase-memory-mcp MCP server
// and are unverified against its actual protocol/tool definitions — patch
// once confirmed.

const fs = require('fs');
const path = require('path');
const { spawnJsonRpcClient, killIfOwned } = require('./jsonRpcStdio');

const SEARCH_TIMEOUT_MS = 1500; // stays inside the ~2s hook budget
const INDEX_BUILD_TIMEOUT_MS = 30000;
const BIN_NAME = 'codebase-memory-mcp';

/**
 * PATH-only availability check — no child process spawned. Scans each
 * directory on PATH for a file matching the binary name (with the
 * platform's usual executable extensions on Windows).
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function isAvailable(env = process.env) {
  const execNames =
    process.platform === 'win32'
      ? [`${BIN_NAME}.exe`, `${BIN_NAME}.cmd`, `${BIN_NAME}.bat`]
      : [BIN_NAME];
  const pathVar = env.PATH || env.Path || '';
  const dirs = pathVar.split(path.delimiter).filter(Boolean);
  return dirs.some((dir) =>
    execNames.some((name) => {
      try {
        return fs.statSync(path.join(dir, name)).isFile();
      } catch {
        return false;
      }
    })
  );
}

/**
 * OS-branched manual install/approval guidance. Never includes an install
 * URL we haven't verified — points at the tool's own README/release page
 * instead of fabricating a curl command.
 *
 * @param {NodeJS.Platform} [platform]
 * @returns {string}
 */
function guidanceText(platform = process.platform) {
  const lines = ['codebase-memory-mcp not found on PATH.', ''];
  if (platform === 'win32') {
    lines.push(
      'Native Windows support is unclear/limited. Recommended path: install and run it',
      'inside WSL2, following the macOS/Linux install instructions from the',
      'codebase-memory-mcp project itself, run from within your WSL2 shell.',
      'It needs a C compiler (build-essential) inside WSL2 to build its tree-sitter parsers.'
    );
  } else {
    lines.push(
      'Install it per the codebase-memory-mcp project\'s own README/release instructions,',
      'then make sure the binary is on PATH.',
      'It needs a C compiler (Xcode Command Line Tools on macOS, build-essential on Linux)',
      'to build its tree-sitter parsers.'
    );
  }
  lines.push(
    '',
    'Get this approved by internal security before installing on a company machine —',
    'it reads full repo contents (even though it stays local).',
    '',
    'ctx-gate works fully without it (falls back to plain-text search over tracked files).',
    `Run \`ctx-gate mcp-check\` any time after you've installed it manually.`
  );
  return lines.join('\n');
}

function appendMcpLog(repoRoot, text) {
  if (!repoRoot || !text) return;
  try {
    const dir = path.join(repoRoot, '.context-ops', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'mcp.log'), text);
  } catch {
    // logging is best-effort only, never allowed to throw
  }
}

/**
 * Spawns the binary and wires up newline-delimited JSON-RPC framing over
 * stdio. stderr is only ever written to `.context-ops/logs/mcp.log`, never
 * to this process's own stdout/stderr.
 *
 * @param {Object} [opts]
 * @param {Function} [opts.spawn] injectable replacement for child_process.spawn (tests)
 * @param {string} [opts.repoRoot] used only to locate .context-ops/logs/mcp.log
 * @returns {{ proc: import('child_process').ChildProcess, request: (method: string, params?: Object) => Promise<Object> }}
 */
function spawnClient(opts = {}) {
  return spawnJsonRpcClient({
    command: BIN_NAME,
    args: ['mcp'],
    spawn: opts.spawn,
    onStderr: (text) => appendMcpLog(opts.repoRoot, text),
  });
}

/**
 * Resolves to [] on timeout or error rather than rejecting, so callers
 * (gate.js) never need to wrap this in try/catch.
 *
 * @param {string} query
 * @param {Object} [opts]
 * @param {{ proc: Object, request: Function }} [opts.client] injectable client (tests)
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<Array<{ symbol: string, path: string, kind: string }>>}
 */
async function searchCode(query, opts = {}) {
  const client = opts.client || spawnClient(opts);
  const timeoutMs = opts.timeoutMs || SEARCH_TIMEOUT_MS;
  try {
    const response = await Promise.race([
      client.request('searchCode', { query }),
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!response || !Array.isArray(response.result)) {
      return [];
    }
    return response.result;
  } catch {
    return [];
  } finally {
    killIfOwned(client, opts);
  }
}

/**
 * Only place indexing is triggered automatically — run manually via
 * `ctx-gate mcp-check` after the developer has installed the binary.
 *
 * @param {string} repoRoot
 * @param {Object} [opts]
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function runIndexBuildAndConfirm(repoRoot, opts = {}) {
  if (!isAvailable(opts.env)) {
    return { success: false, message: guidanceText(opts.platform) };
  }

  const client = opts.client || spawnClient({ ...opts, repoRoot });
  const timeoutMs = opts.timeoutMs || INDEX_BUILD_TIMEOUT_MS;
  try {
    const response = await Promise.race([
      client.request('buildIndex', { repoRoot }),
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!response) {
      return { success: false, message: 'Timed out waiting for codebase-memory-mcp to build its index.' };
    }
    if (response.error) {
      const detail = response.error.message || JSON.stringify(response.error);
      return { success: false, message: `codebase-memory-mcp reported an error: ${detail}` };
    }
    return { success: true, message: 'codebase-memory-mcp index built and background watcher confirmed.' };
  } finally {
    killIfOwned(client, opts);
  }
}

module.exports = {
  SEARCH_TIMEOUT_MS,
  isAvailable,
  guidanceText,
  spawnClient,
  searchCode,
  runIndexBuildAndConfirm,
};
