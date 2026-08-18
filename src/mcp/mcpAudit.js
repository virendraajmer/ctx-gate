'use strict';

// `ctx-gate mcp-audit` / `ctx-gate mcp-trim` — per-server MCP tool-definition
// cost measurement and unused-server trim proposals. See
// addon-5-mcp-audit.md for the full spec. This module holds the reusable
// logic (reading .vscode/mcp.json, spawning servers to measure real
// tool-schema token cost, and combining that with usage data); bin/ctx-gate.js
// owns the actual command wiring, printing, and confirmation prompt.
//
// Scope boundary (see addon-5-mcp-audit.md): this measures and proposes
// only. No blocking, no denying, no preToolUse involvement.

const fs = require('fs');
const path = require('path');
const { createTwoFilesPatch } = require('diff');
const { spawnJsonRpcClient, killIfOwned } = require('./jsonRpcStdio');
const { countTokens: defaultCountTokens } = require('../tokenBudget');

const TOOLS_LIST_TIMEOUT_MS = 5000;
const DEFAULT_MCP_UNUSED_AFTER_DAYS = 30;
const DEFAULT_MCP_WARN_ABOVE_TOKENS = 8000;

/**
 * Reads and parses .vscode/mcp.json. Never throws — absent/malformed is
 * reported via `ok`/`reason`, same defensive fs.existsSync + try/catch
 * idiom used throughout src/memory/store.js.
 *
 * @param {string} repoRoot
 * @returns {{ ok: boolean, reason?: 'absent'|'malformed', servers: Object, raw: Object|null, rawText: string }}
 */
function readMcpJson(repoRoot) {
  const p = path.join(repoRoot, '.vscode', 'mcp.json');
  if (!fs.existsSync(p)) {
    return { ok: false, reason: 'absent', servers: {}, raw: null, rawText: '' };
  }
  const rawText = fs.readFileSync(p, 'utf8');
  try {
    const raw = JSON.parse(rawText);
    const servers = raw && typeof raw.servers === 'object' && raw.servers !== null ? raw.servers : {};
    return { ok: true, servers, raw, rawText };
  } catch {
    return { ok: false, reason: 'malformed', servers: {}, raw: null, rawText };
  }
}

/**
 * Starts one declared server, calls tools/list over stdio JSON-RPC, and
 * measures the serialized tool schemas with the real tokenizer. Never
 * estimates: any failure to start, respond, or respond well-formed within
 * the timeout resolves to `measured: false` ("not measured"), same
 * Promise.race -> null -> sentinel pattern as codebaseMemoryClient.js.
 * Always cleans up the spawned process, including on error paths.
 *
 * @param {string} name
 * @param {{ command?: string, args?: string[], env?: Object }} serverConfig
 * @param {Object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {Function} [opts.countTokens] injectable tokenizer (tests)
 * @param {Function} [opts.spawn] injectable replacement for child_process.spawn (tests)
 * @param {{ proc: Object, request: Function }} [opts.client] injectable client (tests)
 * @returns {Promise<{ name: string, measured: boolean, toolCount: number|null, tokens: number|null }>}
 */
async function measureServer(name, serverConfig, opts = {}) {
  const timeoutMs = opts.timeoutMs || TOOLS_LIST_TIMEOUT_MS;
  const countTokensFn = opts.countTokens || defaultCountTokens;

  if (!serverConfig || typeof serverConfig.command !== 'string' || !serverConfig.command) {
    return { name, measured: false, toolCount: null, tokens: null };
  }

  const client =
    opts.client ||
    spawnJsonRpcClient({
      command: serverConfig.command,
      args: serverConfig.args || [],
      env: serverConfig.env ? { ...process.env, ...serverConfig.env } : undefined,
      spawn: opts.spawn,
    });

  try {
    const response = await Promise.race([
      client.request('tools/list', {}),
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!response || response.error || !response.result || !Array.isArray(response.result.tools)) {
      return { name, measured: false, toolCount: null, tokens: null };
    }
    const tools = response.result.tools;
    const tokens = countTokensFn(JSON.stringify(tools));
    return { name, measured: true, toolCount: tools.length, tokens };
  } catch {
    return { name, measured: false, toolCount: null, tokens: null };
  } finally {
    killIfOwned(client, opts);
  }
}

/**
 * Measures every declared server, one at a time (each one is a spawned
 * process — sequential keeps resource use and cleanup simple; this only
 * runs from the manual mcp-audit/mcp-trim commands, never a hook path).
 *
 * @param {Object} servers - servers map from readMcpJson
 * @param {Object} [opts] - forwarded to measureServer; opts.clients (Object,
 *   keyed by server name) injects a per-server test client
 * @returns {Promise<Array<{ name: string, measured: boolean, toolCount: number|null, tokens: number|null }>>}
 */
async function measureAllServers(servers, opts = {}) {
  const results = [];
  for (const [name, serverConfig] of Object.entries(servers || {})) {
    const perServerOpts = { ...opts, client: (opts.clients && opts.clients[name]) || opts.client };
    // eslint-disable-next-line no-await-in-loop
    results.push(await measureServer(name, serverConfig, perServerOpts));
  }
  return results;
}

/**
 * Ensures every currently-declared server has a usage-state entry, so
 * "insufficient usage window" can be judged even for a server that has
 * never once been called (and therefore never touched by
 * src/core/learn.js#recordMcpUsage). Only ever *adds* a stub — never
 * overwrites an existing record — so it's safe to call on every
 * mcp-audit/mcp-trim run. `firstSeen` on the stub anchors the window: the
 * first time ctx-gate observes a server declared in .vscode/mcp.json is
 * the earliest point it could possibly know whether that server is unused.
 *
 * @param {Object} usage - current .context-ops/state/mcp-usage.json contents
 * @param {string[]} serverNames
 * @param {string} nowIso
 * @returns {{ usage: Object, changed: boolean }}
 */
function ensureUsageStubs(usage, serverNames, nowIso) {
  let changed = false;
  const next = { ...usage };
  for (const name of serverNames) {
    if (!next[name]) {
      next[name] = { calls: 0, lastUsed: null, firstSeen: nowIso };
      changed = true;
    }
  }
  return { usage: next, changed };
}

function daysBetween(fromIso, now) {
  if (!fromIso) return 0;
  return (now.getTime() - new Date(fromIso).getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Combines per-server measurements with usage state into the rows
 * mcp-audit prints. Pure — no I/O.
 *
 * @param {Array<{ name: string, measured: boolean, toolCount: number|null, tokens: number|null }>} measurements
 * @param {Object} usage - .context-ops/state/mcp-usage.json contents (see ensureUsageStubs)
 * @param {{ unusedAfterDays?: number, warnAboveTokens?: number }} [config]
 * @param {Date} [now]
 * @returns {{ rows: Array, totalTools: number, totalTokens: number, unused: Array, warnAboveTokens: number, exceedsWarn: boolean }}
 */
function buildAuditReport(measurements, usage = {}, config = {}, now = new Date()) {
  const unusedAfterDays = config.unusedAfterDays ?? DEFAULT_MCP_UNUSED_AFTER_DAYS;
  const warnAboveTokens = config.warnAboveTokens ?? DEFAULT_MCP_WARN_ABOVE_TOKENS;

  const rows = measurements.map((m) => {
    const u = usage[m.name];
    const calls = u ? u.calls : 0;
    const lastUsed = u ? u.lastUsed : null;
    const windowCoverageDays = daysBetween(u && u.firstSeen, now);
    // "Unused" requires both a real measurement (never infer unused-ness
    // for a server we couldn't even start) and enough elapsed watch-time
    // to trust a zero-call count — see the insufficient-window guard in
    // buildTrimProposal below.
    const isUnused = m.measured && calls === 0 && windowCoverageDays >= unusedAfterDays;
    return { ...m, calls, lastUsed, windowCoverageDays, isUnused };
  });

  const totalTools = rows.reduce((sum, r) => sum + (r.toolCount || 0), 0);
  const totalTokens = rows.reduce((sum, r) => sum + (r.tokens || 0), 0);
  const unused = rows.filter((r) => r.isUnused);

  return { rows, totalTools, totalTokens, unused, warnAboveTokens, exceedsWarn: totalTokens > warnAboveTokens };
}

/**
 * Computes trim candidates from buildAuditReport's rows. Pure — no I/O,
 * no diffing or confirmation here (that's bin/ctx-gate.js's job).
 *
 * Never proposes a `not measured` server (absence of a measurement is not
 * evidence it's unused) and refuses per-server when usage tracking hasn't
 * covered the full unusedAfterDays window yet, reporting that separately
 * so the caller can say why nothing was proposed for that server.
 *
 * @param {Array} rows - buildAuditReport(...).rows
 * @param {{ unusedAfterDays?: number }} [config]
 * @returns {{ candidates: Array<{name: string, tokens: number}>, insufficientWindow: Array<{name: string, daysCovered: number, neededDays: number}>, notMeasuredSkipped: Array<{name: string}> }}
 */
function buildTrimProposal(rows, config = {}) {
  const unusedAfterDays = config.unusedAfterDays ?? DEFAULT_MCP_UNUSED_AFTER_DAYS;
  const candidates = [];
  const insufficientWindow = [];
  const notMeasuredSkipped = [];

  for (const r of rows) {
    if (!r.measured) {
      if (r.calls === 0) {
        notMeasuredSkipped.push({ name: r.name });
      }
      continue;
    }
    if (r.calls > 0) {
      continue; // actively used — never a removal candidate
    }
    if (r.windowCoverageDays < unusedAfterDays) {
      insufficientWindow.push({
        name: r.name,
        daysCovered: Math.floor(r.windowCoverageDays),
        neededDays: unusedAfterDays,
      });
      continue;
    }
    candidates.push({ name: r.name, tokens: r.tokens });
  }

  return { candidates, insufficientWindow, notMeasuredSkipped };
}

/**
 * Builds a unified diff of .vscode/mcp.json with the given server names
 * removed from its `servers` map, for mcp-trim to show before prompting.
 *
 * @param {{ raw: Object, rawText: string }} mcpJson - readMcpJson(...) result
 * @param {string[]} namesToRemove
 * @returns {{ diffText: string, nextJson: Object, nextText: string }}
 */
function buildTrimDiff(mcpJson, namesToRemove) {
  const nextServers = { ...mcpJson.servers };
  for (const name of namesToRemove) {
    delete nextServers[name];
  }
  const nextJson = { ...mcpJson.raw, servers: nextServers };
  const nextText = `${JSON.stringify(nextJson, null, 2)}\n`;
  const diffText = createTwoFilesPatch(
    '.vscode/mcp.json',
    '.vscode/mcp.json',
    mcpJson.rawText,
    nextText,
    'existing',
    'proposed'
  );
  return { diffText, nextJson, nextText };
}

module.exports = {
  TOOLS_LIST_TIMEOUT_MS,
  DEFAULT_MCP_UNUSED_AFTER_DAYS,
  DEFAULT_MCP_WARN_ABOVE_TOKENS,
  readMcpJson,
  measureServer,
  measureAllServers,
  ensureUsageStubs,
  buildAuditReport,
  buildTrimProposal,
  buildTrimDiff,
};
