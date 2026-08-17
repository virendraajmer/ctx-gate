'use strict';

// `ctx-gate enforce` — the preToolUse hook's core logic (only hook type
// that can actually block). Three levels: off < warn < block. Team level
// (config.yml, committed) and local level (config.local.yml, gitignored)
// combine as max(team, local) — local can only raise, never lower.

const store = require('../memory/store');

const ORDER = { off: 0, warn: 1, block: 2 };

/**
 * @param {'off'|'warn'|'block'} teamLevel
 * @param {'off'|'warn'|'block'|null|undefined} localLevel
 * @returns {'off'|'warn'|'block'}
 */
function computeEffectiveLevel(teamLevel, localLevel) {
  const teamRank = ORDER[teamLevel] ?? ORDER.off;
  const localRank = localLevel != null ? (ORDER[localLevel] ?? ORDER.off) : ORDER.off;
  const rank = Math.max(teamRank, localRank);
  return Object.keys(ORDER).find((level) => ORDER[level] === rank);
}

/**
 * Throws if a local override would (incorrectly) claim a level below the
 * team level; used when loading config.local.yml to flag misconfiguration
 * rather than silently trusting a lower value.
 *
 * @param {'off'|'warn'|'block'} teamLevel
 * @param {'off'|'warn'|'block'|null|undefined} localLevel
 */
function assertNoDowngrade(teamLevel, localLevel) {
  if (localLevel == null) {
    return;
  }
  const teamRank = ORDER[teamLevel] ?? ORDER.off;
  const localRank = ORDER[localLevel] ?? ORDER.off;
  if (localRank < teamRank) {
    throw new Error(
      `config.local.yml enforcement level "${localLevel}" is below the team level "${teamLevel}" — ` +
        'a local override may only raise the effective level, never lower it.'
    );
  }
}

/**
 * @param {import('../adapters/types').EnforceRequest} request
 * @param {Object} deps - { effectiveLevel, sessionCache, answersLog }
 * @returns {import('../adapters/types').EnforceDecision}
 */
function decide(request, deps) {
  const { effectiveLevel, sessionCache = {}, answersLog = [] } = deps;

  // Read-only tools are always allowed, checked before any level logic.
  if (request.changeType !== 'write') {
    return { decision: 'allow' };
  }

  if (effectiveLevel === 'off') {
    return { decision: 'allow' };
  }

  if (effectiveLevel === 'warn') {
    return { decision: 'warn', reason: 'This request looked underspecified when last checked — proceeding anyway.' };
  }

  // block: deny only if the linked check flagged BOTH scope and acceptance
  // unknown, and nothing has been recorded for this session since.
  const session = sessionCache[request.check.sessionId];
  if (!session) {
    return { decision: 'allow' };
  }

  const unknownSlots = session.unknownSlots || [];
  const bothUnknown = unknownSlots.includes('scope') && unknownSlots.includes('acceptance');
  if (!bothUnknown) {
    return { decision: 'allow' };
  }

  const sessionCheckedAt = session.timestamp ? new Date(session.timestamp) : null;
  const answeredSince = answersLog.some(
    (entry) =>
      entry.sessionId === request.check.sessionId &&
      (!sessionCheckedAt || new Date(entry.timestamp) >= sessionCheckedAt)
  );
  if (answeredSince) {
    return { decision: 'allow' };
  }

  return {
    decision: 'deny',
    reason: 'Missing scope and acceptance criteria for this request — clarify before this write proceeds.',
  };
}

/**
 * Writes .context-ops/config.local.yml only. Never touches config.yml,
 * never runs git commands.
 *
 * @param {string} repoRoot
 * @param {'off'|'warn'|'block'} level
 */
function setLocalOverride(repoRoot, level) {
  if (!(level in ORDER)) {
    throw new Error(`Invalid enforcement level: ${level}`);
  }
  store.writeLocalConfig(repoRoot, { version: 1, enforcement: level });
}

module.exports = { ORDER, computeEffectiveLevel, assertNoDowngrade, decide, setLocalOverride };
