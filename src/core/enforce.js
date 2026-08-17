'use strict';

// `ctx-gate enforce` — the preToolUse hook's core logic (only hook type
// that can actually block). Three levels: off < warn < block. Team level
// (config.yml, committed) and local level (config.local.yml, gitignored)
// combine as max(team, local) — local can only raise, never lower.

const ORDER = { off: 0, warn: 1, block: 2 };

/**
 * @param {'off'|'warn'|'block'} teamLevel
 * @param {'off'|'warn'|'block'} localLevel
 * @returns {'off'|'warn'|'block'}
 */
function computeEffectiveLevel(teamLevel, localLevel) {
  throw new Error('not implemented');
}

/**
 * Throws if a local override would (incorrectly) claim a level below the
 * team level; used when loading config.local.yml to flag misconfiguration
 * rather than silently trusting a lower value.
 *
 * @param {'off'|'warn'|'block'} teamLevel
 * @param {'off'|'warn'|'block'} localLevel
 */
function assertNoDowngrade(teamLevel, localLevel) {
  throw new Error('not implemented');
}

/**
 * @param {import('../adapters/types').EnforceRequest} request
 * @param {Object} deps - { effectiveLevel, sessionCache, answersLogPath }
 * @returns {import('../adapters/types').EnforceDecision}
 */
function decide(request, deps) {
  throw new Error('not implemented');
}

/**
 * Writes .context-ops/config.local.yml only. Never touches config.yml,
 * never runs git commands.
 *
 * @param {string} repoRoot
 * @param {'off'|'warn'|'block'} level
 */
function setLocalOverride(repoRoot, level) {
  throw new Error('not implemented');
}

module.exports = { ORDER, computeEffectiveLevel, assertNoDowngrade, decide, setLocalOverride };
