'use strict';

// `ctx-gate check` — the userPromptSubmitted hook's core logic. Pure,
// deterministic, zero LLM calls. Operates only on the normalized
// CheckRequest/CheckResponse shapes from src/adapters/types.js; never
// reads hook-specific JSON directly (that's the adapter's job).

const SHORT_FOLLOWUP_WORD_LIMIT = 4;

// Short-circuits acknowledgment-style follow-ups ("yes", "ok continue") —
// deliberately NOT any prompt under the word limit, since real short
// imperatives ("add validation") still need full analysis. Combined with
// the word limit above as a belt-and-suspenders check.
const SHORT_FOLLOWUP_ACK_WORDS = new Set([
  'yes', 'yeah', 'yep', 'yup', 'no', 'nope', 'ok', 'okay', 'sure',
  'continue', 'proceed', 'go', 'ahead', 'do', 'it', 'sounds', 'good',
  'looks', 'thanks', 'thank', 'you', 'please', 'keep', 'going',
]);

const VAGUE_TERMS = [
  'properly',
  'handle it',
  'as needed',
  'optimize',
  'etc',
  'some',
  'better',
];

const ACCEPTANCE_SIGNAL_RE = /\b(test|tests|passes?|fails?|when|until|should|must|criteria)\b|\d+/i;

const ERROR_HANDLING_MENTION_RE = /\b(error|exception|throw|catch|fail(?:ure)?)\b/i;
const NAMING_MENTION_RE = /\b(name|naming|rename)\b/i;
const PERFORMANCE_MENTION_RE = /\b(performance|perf|slow|latency|speed)\b/i;
const LOGGING_MENTION_RE = /\b(log|logs|logging|logger)\b/i;

const QUESTION_TEMPLATES = {
  scope: 'Which screen, file, or endpoint does this apply to?',
  acceptance: 'What does "done" mean for this — a test, a specific check, or a number?',
};

function wordBoundaryIncludes(haystackLower, needleLower) {
  if (!needleLower) return false;
  const escaped = needleLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\b`, 'i');
  return re.test(haystackLower);
}

/**
 * @param {string} prompt
 * @param {Object} sessionCache
 * @param {string} sessionId
 * @returns {boolean}
 */
function isShortFollowUp(prompt, sessionCache, sessionId) {
  if (sessionCache && sessionId && sessionCache[sessionId] && sessionCache[sessionId].checked) {
    return true;
  }
  const words = (prompt || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > SHORT_FOLLOWUP_WORD_LIMIT) {
    return false;
  }
  return words.every((w) => SHORT_FOLLOWUP_ACK_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, '')));
}

/**
 * @param {string} prompt
 * @param {Object} manifest
 * @returns {import('../adapters/types').CheckMatch[]}
 */
function extractMentionedEntities(prompt, manifest) {
  const lower = (prompt || '').toLowerCase();
  const matches = [];

  const screens = (manifest && manifest.stacks && manifest.stacks.react && manifest.stacks.react.screens) || [];
  for (const screen of screens) {
    if (screen.name && wordBoundaryIncludes(lower, screen.name.toLowerCase())) {
      matches.push({ path: screen.path, kind: 'screen', confidence: screen.confidence });
    }
  }

  const endpoints = (manifest && manifest.endpoints) || [];
  for (const endpoint of endpoints) {
    const [pathOnly, symbol] = endpoint.path.split('#');
    const routeSegments = (endpoint.route || '').split('/').filter(Boolean);
    const mentionsRoute = routeSegments.some((seg) => wordBoundaryIncludes(lower, seg.toLowerCase()));
    const mentionsSymbol = symbol && wordBoundaryIncludes(lower, symbol.toLowerCase());
    if (mentionsRoute || mentionsSymbol) {
      matches.push({
        path: pathOnly,
        symbol: symbol || undefined,
        kind: 'endpoint',
        confidence: endpoint.confidence,
      });
    }
  }

  return matches;
}

/**
 * @param {string} prompt
 * @param {Object} features
 * @returns {import('../adapters/types').CheckMatch[]}
 */
function matchFeatures(prompt, features) {
  const lower = (prompt || '').toLowerCase();
  const matches = [];
  const mappings = (features && features.mappings) || [];
  for (const mapping of mappings) {
    if (mapping.word && wordBoundaryIncludes(lower, mapping.word.toLowerCase())) {
      for (const p of mapping.paths || []) {
        matches.push({ path: p, kind: 'feature-mapping', confidence: 'high' });
      }
    }
  }
  return matches;
}

/**
 * @param {string} prompt
 * @param {Object} learned
 * @param {Object} manifest
 * @returns {import('../adapters/types').LearnedSuggestion[]}
 */
function matchLearned(prompt, learned, manifest) {
  const lower = (prompt || '').toLowerCase();
  const patterns = (learned && learned.patterns) || [];
  const suggestions = [];

  for (const pattern of patterns) {
    const trigger = pattern.trigger || {};
    const keywords = trigger.keywords || [];
    const allKeywordsPresent = keywords.length > 0 && keywords.every((kw) => wordBoundaryIncludes(lower, kw.toLowerCase()));
    if (!allKeywordsPresent) continue;

    if (trigger.noScreenNamed) {
      const screens = (manifest && manifest.stacks && manifest.stacks.react && manifest.stacks.react.screens) || [];
      const aScreenIsNamed = screens.some((s) => s.name && wordBoundaryIncludes(lower, s.name.toLowerCase()));
      if (aScreenIsNamed) continue;
    }

    suggestions.push({ id: pattern.id, suggestion: pattern.suggestion, confidence: pattern.confidence });
  }

  return suggestions;
}

/**
 * @param {string} prompt
 * @param {import('../adapters/types').CheckMatch[]} matches
 * @returns {{ scope: boolean, acceptance: boolean, vagueTerms: string[] }}
 */
function identifyUnknownSlots(prompt, matches) {
  const lower = (prompt || '').toLowerCase();
  const scope = !matches || matches.length === 0;
  const acceptance = !ACCEPTANCE_SIGNAL_RE.test(prompt || '');
  const vagueTerms = VAGUE_TERMS.filter((term) => wordBoundaryIncludes(lower, term));
  return { scope, acceptance, vagueTerms };
}

function riskPathsFromEntry(entry) {
  if (!entry || !entry.value) return [];
  return String(entry.value)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

function buildStandingNotes(prompt, unknown, matches, standing) {
  const notes = [];
  const entries = (standing && standing.entries) || [];
  const bySlot = Object.fromEntries(entries.map((e) => [e.slot, e]));

  if (unknown.acceptance && bySlot.acceptance && bySlot.acceptance.value) {
    notes.push(`"done" means: ${bySlot.acceptance.value}`);
  }

  if (bySlot.riskPaths) {
    const riskPaths = riskPathsFromEntry(bySlot.riskPaths);
    const touchesRisk = matches.some((m) => riskPaths.some((rp) => m.path && m.path.startsWith(rp)));
    if (touchesRisk) {
      notes.push(`High-risk path — review carefully (${bySlot.riskPaths.value})`);
    }
  }

  if (bySlot.errorHandling && bySlot.errorHandling.value && ERROR_HANDLING_MENTION_RE.test(prompt || '')) {
    notes.push(`Error-handling convention: ${bySlot.errorHandling.value}`);
  }

  if (bySlot.naming && bySlot.naming.value && NAMING_MENTION_RE.test(prompt || '')) {
    notes.push(`Naming convention: ${bySlot.naming.value}`);
  }

  if (bySlot.performance && bySlot.performance.value && PERFORMANCE_MENTION_RE.test(prompt || '')) {
    notes.push(`Performance target: ${bySlot.performance.value}`);
  }

  if (bySlot.logging && bySlot.logging.value && LOGGING_MENTION_RE.test(prompt || '')) {
    notes.push(`Logging convention: ${bySlot.logging.value}`);
  }

  return notes;
}

/**
 * @param {Object} parts
 * @returns {import('../adapters/types').CheckResponse}
 */
function composeResponse(parts) {
  if (parts.skipped) {
    return {
      skipped: true,
      matches: [],
      standingNotes: [],
      learnedSuggestions: [],
      unknownSlots: [],
      vagueTermsFound: [],
      questions: [],
      warningLevel: 'off',
    };
  }

  const { matches, standingNotes, learnedSuggestions, unknown, warningLevel } = parts;

  const unknownSlots = [];
  const questions = [];
  if (unknown.scope) {
    unknownSlots.push('scope');
    questions.push({ slot: 'scope', question: QUESTION_TEMPLATES.scope });
  }
  if (unknown.acceptance) {
    unknownSlots.push('acceptance');
    questions.push({ slot: 'acceptance', question: QUESTION_TEMPLATES.acceptance });
  }
  for (const term of unknown.vagueTerms) {
    questions.push({ slot: `vagueTerm:${term}`, question: `Can you clarify what "${term}" means here?` });
  }

  return {
    skipped: false,
    matches,
    standingNotes,
    learnedSuggestions,
    unknownSlots,
    vagueTermsFound: unknown.vagueTerms,
    questions,
    warningLevel: warningLevel || 'off',
  };
}

/**
 * @param {import('../adapters/types').CheckRequest} request
 * @param {Object} deps - { manifest, standing, learned, features, searchCode, sessionCache }
 * @returns {Promise<import('../adapters/types').CheckResponse>}
 */
async function runCheck(request, deps) {
  const { prompt, sessionId } = request;
  const { manifest, standing, learned, features, searchCode, sessionCache } = deps;

  if (isShortFollowUp(prompt, sessionCache, sessionId)) {
    return composeResponse({ skipped: true });
  }

  const entityMatches = extractMentionedEntities(prompt, manifest);
  const featureMatches = matchFeatures(prompt, features);
  const seen = new Set();
  const matches = [];
  for (const m of [...entityMatches, ...featureMatches]) {
    const key = `${m.path}#${m.symbol || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push(m);
  }

  if (matches.length === 0 && typeof searchCode === 'function') {
    const searchMatches = await searchCode(prompt);
    for (const m of searchMatches || []) {
      const key = `${m.path}#${m.symbol || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({ path: m.path, symbol: m.symbol, kind: m.kind || 'search', confidence: 'low' });
    }
  }

  const learnedSuggestions = matchLearned(prompt, learned, manifest);
  const unknown = identifyUnknownSlots(prompt, matches);
  const standingNotes = buildStandingNotes(prompt, unknown, matches, standing);

  const warningLevel = unknown.scope || unknown.acceptance || unknown.vagueTerms.length > 0 ? 'warn' : 'off';

  return composeResponse({ skipped: false, matches, standingNotes, learnedSuggestions, unknown, warningLevel });
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
