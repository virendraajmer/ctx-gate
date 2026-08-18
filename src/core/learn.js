'use strict';

// `ctx-gate learn` — the postToolUse hook's core logic. Pure/deterministic:
// derives an answers.jsonl line from the LearnRequest plus the Phase-4
// session-cache snapshot of the matching check, and promotes a repeated
// trigger->suggestion pair into learned.yml at 3 occurrences. No file I/O
// here — bin/ctx-gate.js reads answersLog/sessionCache/manifest first and
// writes back whatever this returns.

const { emptySessionState } = require('../memory/schema');

const PROMOTION_THRESHOLD = 3;
const KEYWORD_MIN_LENGTH = 4;
const KEYWORD_MAX_COUNT = 5;
const SESSION_STATE_TTL_DAYS = 7;

function deriveKeywords(prompt) {
  const words = (prompt || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= KEYWORD_MIN_LENGTH);
  return [...new Set(words)].sort().slice(0, KEYWORD_MAX_COUNT);
}

function deriveSuggestion(filesTouched, manifest) {
  if (!filesTouched || filesTouched.length === 0) {
    return null;
  }
  const touched = filesTouched[0];
  const screens = (manifest && manifest.stacks && manifest.stacks.react && manifest.stacks.react.screens) || [];
  const screen = screens.find((s) => s.path === touched);
  return screen ? { screen: screen.name } : { file: touched };
}

function triggerSignatureEquals(a, b) {
  if (!a || !b) return false;
  return (
    JSON.stringify([...a.keywords].sort()) === JSON.stringify([...b.keywords].sort()) &&
    Boolean(a.noScreenNamed) === Boolean(b.noScreenNamed)
  );
}

function suggestionEquals(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * @param {import('../adapters/types').LearnRequest} request
 * @param {Object} [deps]
 * @param {Object[]} [deps.answersLog] - lines already on disk in answers.jsonl
 * @param {Object} [deps.sessionCache] - session-cache.json contents keyed by sessionId (src/core/gate.js)
 * @param {Object} [deps.manifest]
 * @param {number} [deps.promotionThreshold]
 * @returns {{ answerEntry: Object, learnedPatch: Object|null }}
 *   answerEntry - line to append to answers.jsonl
 *   learnedPatch - pattern to upsert into learned.yml once the promotion threshold is hit, else null
 */
function recordAndPromote(request, deps = {}) {
  const { answersLog = [], sessionCache = {}, manifest = {}, promotionThreshold = PROMOTION_THRESHOLD } = deps;

  const session = sessionCache[request.sessionId];
  const suggestion = deriveSuggestion(request.filesTouched, manifest);

  let trigger = null;
  if (session && suggestion) {
    const hadScreenMatch = (session.matches || []).some((m) => m.kind === 'screen');
    const keywords = deriveKeywords(session.prompt);
    if (keywords.length > 0) {
      trigger = { keywords, noScreenNamed: !hadScreenMatch };
    }
  }

  const answerEntry = {
    timestamp: request.timestamp,
    sessionId: request.sessionId,
    filesTouched: request.filesTouched || [],
    answerText: request.answerText,
    trigger,
    suggestion: trigger ? suggestion : null,
  };

  let learnedPatch = null;
  if (trigger) {
    const occurrences = [...answersLog, answerEntry].filter(
      (e) => triggerSignatureEquals(e.trigger, trigger) && suggestionEquals(e.suggestion, suggestion)
    ).length;

    if (occurrences >= promotionThreshold) {
      const suggestionLabel = suggestion.screen || suggestion.file || 'result';
      learnedPatch = {
        id: slugify(`${trigger.keywords.join('-')}-defaults-to-${suggestionLabel}`),
        trigger,
        suggestion,
        confidence: 'learned',
        occurrences,
        last_seen: request.timestamp,
      };
    }
  }

  return { answerEntry, learnedPatch };
}

/**
 * Session cost tracking — advances .context-ops/state/<sessionId>.json by
 * one turn. Pure: no file I/O here, bin/ctx-gate.js reads the existing
 * state and the bytes-read estimate (via fs.statSync on filesTouched)
 * before calling this, then writes back whatever is returned.
 *
 * @param {Object|null} existingState - prior state for this session, or null
 * @param {{ sessionId: string, timestamp: string, filesTouched?: string[], bytesRead?: number }} event
 * @returns {Object} updated session state
 */
function updateSessionState(existingState, event) {
  const state = existingState
    ? {
        ...existingState,
        filesRead: [...existingState.filesRead],
        fileReadCounts: { ...existingState.fileReadCounts },
      }
    : emptySessionState(event.sessionId, event.timestamp);

  state.turnCount += 1;
  state.estimatedBytesRead += event.bytesRead || 0;
  state.lastSeenAt = event.timestamp;

  for (const file of event.filesTouched || []) {
    if (!state.filesRead.includes(file)) {
      state.filesRead.push(file);
    }
    state.fileReadCounts[file] = (state.fileReadCounts[file] || 0) + 1;
  }

  return state;
}

/**
 * @param {{ sessionId: string, state: Object }[]} sessionStates - as returned by store.listSessionStates
 * @param {Date} now
 * @param {number} [ttlDays]
 * @returns {string[]} sessionIds whose state is stale enough to delete
 */
function findStaleSessionStates(sessionStates, now, ttlDays = SESSION_STATE_TTL_DAYS) {
  return sessionStates
    .filter(({ state }) => {
      if (!state || !state.lastSeenAt) return true;
      const ageDays = (now - new Date(state.lastSeenAt)) / (1000 * 60 * 60 * 24);
      return ageDays >= ttlDays;
    })
    .map(({ sessionId }) => sessionId);
}

// Confirmed live during addon-5 development (2026-08-18) by invoking an
// MCP tool directly in a Claude Code session and inspecting the resulting
// tool name: `mcp__codebase-memory-mcp__list_projects`. MCP-qualified tool
// names follow `mcp__<server-name>__<tool-name>` — note the server/tool
// split is on the first `__` *pair* after the `mcp__` prefix, not on every
// single underscore, since tool names themselves may contain underscores
// (e.g. `list_projects`).
const MCP_TOOL_NAME_RE = /^mcp__(.+?)__(.+)$/;

/**
 * @param {string} toolName
 * @returns {string|null} the MCP server name, or null if toolName isn't
 *   MCP-qualified (e.g. a plain editor tool like "editFiles")
 */
function parseMcpServerName(toolName) {
  const match = MCP_TOOL_NAME_RE.exec(toolName || '');
  return match ? match[1] : null;
}

/**
 * Per-server MCP usage counting for `ctx-gate mcp-audit` / `mcp-trim` (see
 * src/mcp/mcpAudit.js). Pure: no file I/O here, same convention as the
 * rest of this module — bin/ctx-gate.js reads mcp-usage.json first and
 * writes back whatever this returns. Returns the *same* object reference
 * when toolName isn't MCP-qualified, so callers can skip the write.
 *
 * @param {Object} usageState - current .context-ops/state/mcp-usage.json contents
 * @param {string} toolName
 * @param {string} timestamp - ISO 8601
 * @returns {Object} updated usage state
 */
function recordMcpUsage(usageState, toolName, timestamp) {
  const server = parseMcpServerName(toolName);
  if (!server) {
    return usageState;
  }
  const existing = usageState[server];
  return {
    ...usageState,
    [server]: {
      calls: (existing ? existing.calls : 0) + 1,
      lastUsed: timestamp,
      firstSeen: (existing && existing.firstSeen) || timestamp,
    },
  };
}

module.exports = {
  PROMOTION_THRESHOLD,
  SESSION_STATE_TTL_DAYS,
  recordAndPromote,
  updateSessionState,
  findStaleSessionStates,
  parseMcpServerName,
  recordMcpUsage,
};
