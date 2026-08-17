'use strict';

// `ctx-gate learn` — the postToolUse hook's core logic. Pure/deterministic:
// derives an answers.jsonl line from the LearnRequest plus the Phase-4
// session-cache snapshot of the matching check, and promotes a repeated
// trigger->suggestion pair into learned.yml at 3 occurrences. No file I/O
// here — bin/ctx-gate.js reads answersLog/sessionCache/manifest first and
// writes back whatever this returns.

const PROMOTION_THRESHOLD = 3;
const KEYWORD_MIN_LENGTH = 4;
const KEYWORD_MAX_COUNT = 5;

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

module.exports = { PROMOTION_THRESHOLD, recordAndPromote };
