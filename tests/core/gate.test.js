'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  isPipelineInvocation,
  isShortFollowUp,
  extractMentionedEntities,
  matchGlossary,
  matchLearned,
  identifyUnknownSlots,
  extractCandidateJargonTerms,
  isTermKnown,
  updateUnknownTerms,
  UNKNOWN_TERM_SESSION_THRESHOLD,
  estimateSessionCost,
  evaluateSessionWarning,
  composeResponse,
  runCheck,
} = require('../../src/core/gate');

const manifest = {
  stacks: {
    react: {
      detected: true,
      screens: [{ name: 'Orders', route: '/orders', path: 'src/pages/OrdersPage.tsx', confidence: 'high', source: 'route-table' }],
    },
  },
  endpoints: [
    { method: 'GET', route: '/api/orders', path: 'src/api/orders.py#list_orders', confidence: 'high', source: 'fastapi' },
  ],
};

const standing = {
  version: 1,
  entries: [
    { id: 'done-means', slot: 'acceptance', value: 'tests pass + CI green', status: 'confirmed' },
    { id: 'high-risk-paths', slot: 'riskPaths', value: 'src/api/', status: 'confirmed' },
    { id: 'error-handling', slot: 'errorHandling', value: 'Services throw exceptions', status: 'detected' },
    { id: 'naming-convention', slot: 'naming', value: 'Services suffixed with Service', status: 'confirmed' },
    { id: 'performance-target', slot: 'performance', value: 'not measured', status: 'default' },
    { id: 'logging-convention', slot: 'logging', value: 'winston', status: 'confirmed' },
  ],
};

const glossary = { version: 1, terms: [{ term: 'sorting', aka: [], definition: 'How order rows are sorted.', paths: ['src/utils/sort.js'], status: 'confirmed', hits: 0 }] };

const learned = {
  patterns: [
    {
      id: 'sorting-defaults-to-orders',
      trigger: { keywords: ['sorting'], noScreenNamed: true },
      suggestion: { screen: 'Orders' },
      confidence: 'learned',
      occurrences: 3,
    },
  ],
};

function deps(overrides = {}) {
  return { manifest, standing, learned, glossary, searchCode: async () => [], sessionCache: {}, ...overrides };
}

// --- isShortFollowUp -------------------------------------------------

test('isShortFollowUp treats prompts at or under the word limit as short', () => {
  assert.equal(isShortFollowUp('yes', {}, 's1'), true);
  assert.equal(isShortFollowUp('ok sounds good', {}, 's1'), true);
  assert.equal(isShortFollowUp('please add validation to the form', {}, 's1'), false);
});

test('isShortFollowUp treats an already-checked session as short-circuited', () => {
  const sessionCache = { s1: { checked: true } };
  assert.equal(isShortFollowUp('please add validation to the form', sessionCache, 's1'), true);
  assert.equal(isShortFollowUp('please add validation to the form', sessionCache, 's2'), false);
});

// --- extractMentionedEntities -----------------------------------------

test('extractMentionedEntities matches a screen name mentioned in the prompt', () => {
  const matches = extractMentionedEntities('update the Orders screen', manifest);
  assert.ok(matches.some((m) => m.path === 'src/pages/OrdersPage.tsx' && m.kind === 'screen'));
});

test('extractMentionedEntities matches an endpoint by route segment', () => {
  const matches = extractMentionedEntities('fix bug in orders listing', manifest);
  assert.ok(matches.some((m) => m.path === 'src/api/orders.py' && m.symbol === 'list_orders' && m.kind === 'endpoint'));
});

test('extractMentionedEntities returns [] when nothing matches', () => {
  assert.deepEqual(extractMentionedEntities('add validation', manifest), []);
});

// --- matchGlossary -------------------------------------------------

test('matchGlossary matches a confirmed term to its mapped path', () => {
  const matches = matchGlossary('change sorting order', glossary);
  assert.deepEqual(matches, [{ path: 'src/utils/sort.js', kind: 'glossary-term', confidence: 'high' }]);
});

test('matchGlossary returns [] when no term matches', () => {
  assert.deepEqual(matchGlossary('add validation', glossary), []);
});

test('matchGlossary never resolves a candidate (unconfirmed) term automatically', () => {
  const candidateGlossary = { version: 1, terms: [{ term: 'sorting', paths: ['src/utils/sort.js'], status: 'candidate' }] };
  assert.deepEqual(matchGlossary('change sorting order', candidateGlossary), []);
});

// --- extractCandidateJargonTerms / isTermKnown / updateUnknownTerms --------

test('extractCandidateJargonTerms finds a Title Case phrase and a long unusual single word', () => {
  const terms = extractCandidateJargonTerms('run the Order Reconciliation flow for reconciliation');
  assert.ok(terms.includes('Order Reconciliation'));
  assert.ok(terms.includes('reconciliation'));
});

test('extractCandidateJargonTerms returns [] for a plain short prompt', () => {
  assert.deepEqual(extractCandidateJargonTerms('add validation'), []);
});

test('isTermKnown is true when the term is defined in the glossary', () => {
  assert.equal(isTermKnown('sorting', glossary), true);
});

test('isTermKnown is true when the term matches a repo symbol name', () => {
  const known = new Set(['reconciliation']);
  assert.equal(isTermKnown('reconciliation', { terms: [] }, known), true);
});

test('isTermKnown is false when the term is in neither the glossary nor known symbol names', () => {
  assert.equal(isTermKnown('reconciliation', { terms: [] }, new Set()), false);
});

test('updateUnknownTerms crosses the threshold only once a term appears in 3 distinct sessions', () => {
  let state = {};
  let result = updateUnknownTerms(state, ['reconciliation'], 's1', '2026-01-01T00:00:00.000Z');
  assert.deepEqual(result.crossed, []);
  state = result.state;
  result = updateUnknownTerms(state, ['reconciliation'], 's2', '2026-01-02T00:00:00.000Z');
  assert.deepEqual(result.crossed, []);
  state = result.state;
  result = updateUnknownTerms(state, ['reconciliation'], 's3', '2026-01-03T00:00:00.000Z');
  assert.equal(result.crossed.length, 1);
  assert.equal(result.crossed[0].term, 'reconciliation');
  assert.equal(result.crossed[0].sessionCount, UNKNOWN_TERM_SESSION_THRESHOLD);
});

test('updateUnknownTerms does not double-count the same session', () => {
  let state = {};
  state = updateUnknownTerms(state, ['reconciliation'], 's1', 't1').state;
  state = updateUnknownTerms(state, ['reconciliation'], 's1', 't2').state;
  assert.equal(state.reconciliation.sessions.length, 1);
});

// --- matchLearned -------------------------------------------------

test('matchLearned suggests a learned pattern when keywords match and no screen is named', () => {
  const suggestions = matchLearned('change sorting order', learned, manifest);
  assert.deepEqual(suggestions, [{ id: 'sorting-defaults-to-orders', suggestion: { screen: 'Orders' }, confidence: 'learned' }]);
});

test('matchLearned withholds the suggestion once a screen is explicitly named', () => {
  const suggestions = matchLearned('change sorting order on the Orders screen', learned, manifest);
  assert.deepEqual(suggestions, []);
});

// --- identifyUnknownSlots -------------------------------------------------

test('identifyUnknownSlots flags scope unknown when there are no matches', () => {
  const result = identifyUnknownSlots('add validation', []);
  assert.equal(result.scope, true);
  assert.equal(result.acceptance, true);
});

test('identifyUnknownSlots finds acceptance signal words', () => {
  const result = identifyUnknownSlots('make sure tests pass when saving', [{ path: 'x' }]);
  assert.equal(result.acceptance, false);
});

test('identifyUnknownSlots collects vague terms', () => {
  const result = identifyUnknownSlots('handle it as needed, properly', [{ path: 'x' }]);
  assert.deepEqual(result.vagueTerms.sort(), ['as needed', 'handle it', 'properly'].sort());
});

// --- composeResponse -------------------------------------------------

test('composeResponse returns an empty skipped response', () => {
  const res = composeResponse({ skipped: true });
  assert.equal(res.skipped, true);
  assert.deepEqual(res.matches, []);
  assert.deepEqual(res.questions, []);
});

test('composeResponse builds questions for unknown slots and vague terms', () => {
  const res = composeResponse({
    skipped: false,
    matches: [],
    standingNotes: [],
    learnedSuggestions: [],
    unknown: { scope: true, acceptance: true, vagueTerms: ['optimize'] },
    warningLevel: 'warn',
  });
  assert.deepEqual(res.unknownSlots, ['scope', 'acceptance']);
  assert.equal(res.questions.length, 3);
  assert.equal(res.warningLevel, 'warn');
});

// --- runCheck: 10-prompt example table -----------------------------------

const TABLE = [
  { prompt: 'yes', expect: { skipped: true } },
  { prompt: 'ok continue', expect: { skipped: true } },
  { prompt: 'add validation', expect: { skipped: false, scopeUnknown: true, acceptanceUnknown: true } },
  {
    prompt: 'change sorting order',
    expect: { skipped: false, scopeUnknown: false, acceptanceUnknown: true, hasLearnedSuggestion: true },
  },
  { prompt: 'update the Orders screen', expect: { skipped: false, scopeUnknown: false, acceptanceUnknown: true } },
  {
    prompt: 'fix bug in orders when order not found',
    expect: { skipped: false, scopeUnknown: false, acceptanceUnknown: false },
  },
  {
    prompt: 'properly optimize the orders page',
    expect: { skipped: false, scopeUnknown: false, acceptanceUnknown: true, vagueTerms: ['properly', 'optimize'] },
  },
  {
    prompt: 'handle it as needed for the login flow',
    expect: { skipped: false, scopeUnknown: true, acceptanceUnknown: true, vagueTerms: ['handle it', 'as needed'] },
  },
  {
    prompt: 'make sure tests pass for the Orders screen when saving',
    expect: { skipped: false, scopeUnknown: false, acceptanceUnknown: false },
  },
  {
    prompt: 'some better error handling in orders.py',
    expect: { skipped: false, scopeUnknown: false, acceptanceUnknown: true, vagueTerms: ['some', 'better'] },
  },
];

for (const [i, row] of TABLE.entries()) {
  test(`runCheck table row ${i + 1}: "${row.prompt}"`, async () => {
    const request = { prompt: row.prompt, sessionId: `row-${i}`, cwd: '/repo' };
    const response = await runCheck(request, deps());

    assert.equal(response.skipped, row.expect.skipped);
    if (row.expect.skipped) return;

    assert.equal(response.unknownSlots.includes('scope'), row.expect.scopeUnknown);
    assert.equal(response.unknownSlots.includes('acceptance'), row.expect.acceptanceUnknown);

    if (row.expect.hasLearnedSuggestion) {
      assert.ok(response.learnedSuggestions.length > 0);
    }
    if (row.expect.vagueTerms) {
      assert.deepEqual(response.vagueTermsFound.sort(), [...row.expect.vagueTerms].sort());
    }
  });
}

// --- estimateSessionCost / evaluateSessionWarning ----------------------

const sessionConfig = { sessionWarnAt: 1000, sessionWarnHardAt: 3000, sessionWarnings: true };

test('estimateSessionCost is 0 for a null/absent state', () => {
  assert.equal(estimateSessionCost(null), 0);
});

test('estimateSessionCost combines turns and bytes so heavy reads outrank many short turns', () => {
  const manyShortTurns = estimateSessionCost({ turnCount: 15, estimatedBytesRead: 0 });
  const fewHeavyTurns = estimateSessionCost({ turnCount: 5, estimatedBytesRead: 400000 });
  assert.ok(fewHeavyTurns > manyShortTurns);
});

test('evaluateSessionWarning does nothing when there is no session state', () => {
  assert.equal(evaluateSessionWarning(null, sessionConfig), null);
});

test('evaluateSessionWarning does nothing when sessionWarnings is disabled', () => {
  const state = { turnCount: 100, estimatedBytesRead: 0, warningsEmitted: 0 };
  assert.equal(evaluateSessionWarning(state, { ...sessionConfig, sessionWarnings: false }), null);
});

test('evaluateSessionWarning stays silent below the soft threshold', () => {
  const state = { turnCount: 1, estimatedBytesRead: 0, warningsEmitted: 0 };
  assert.equal(evaluateSessionWarning(state, sessionConfig), null);
});

test('evaluateSessionWarning fires the soft warning once the soft threshold is crossed', () => {
  const state = { turnCount: 21, estimatedBytesRead: 0, warningsEmitted: 0 }; // 21*50 = 1050 >= 1000
  const result = evaluateSessionWarning(state, sessionConfig);
  assert.equal(result.level, 'soft');
  assert.equal(result.warningsEmittedAfter, 1);
});

test('evaluateSessionWarning does not re-fire the soft warning once already emitted', () => {
  const state = { turnCount: 21, estimatedBytesRead: 0, warningsEmitted: 1 };
  assert.equal(evaluateSessionWarning(state, sessionConfig), null);
});

test('evaluateSessionWarning fires the firm warning once the hard threshold is crossed', () => {
  const state = { turnCount: 61, estimatedBytesRead: 0, warningsEmitted: 1 }; // 61*50 = 3050 >= 3000
  const result = evaluateSessionWarning(state, sessionConfig);
  assert.equal(result.level, 'hard');
  assert.equal(result.warningsEmittedAfter, 2);
});

test('evaluateSessionWarning caps at two warnings per session, never a third', () => {
  const state = { turnCount: 1000, estimatedBytesRead: 0, warningsEmitted: 2 };
  assert.equal(evaluateSessionWarning(state, sessionConfig), null);
});

test('evaluateSessionWarning message suggests starting a fresh chat when the handoff skill is not installed', () => {
  const state = { turnCount: 21, estimatedBytesRead: 0, warningsEmitted: 0 };
  const result = evaluateSessionWarning(state, { ...sessionConfig, handoffInstalled: false });
  assert.match(result.message, /Consider starting a fresh chat/);
  assert.doesNotMatch(result.message, /handoff skill/);
});

test('evaluateSessionWarning message points at the handoff skill when it is installed', () => {
  const state = { turnCount: 21, estimatedBytesRead: 0, warningsEmitted: 0 };
  const result = evaluateSessionWarning(state, { ...sessionConfig, handoffInstalled: true });
  assert.match(result.message, /Run the handoff skill/);
});

test('evaluateSessionWarning skips straight to the firm warning if the hard threshold is crossed on the first check', () => {
  const state = { turnCount: 1000, estimatedBytesRead: 0, warningsEmitted: 0 };
  const result = evaluateSessionWarning(state, sessionConfig);
  assert.equal(result.level, 'hard');
  assert.equal(result.warningsEmittedAfter, 2);
});

test('runCheck attaches sessionWarning to both skipped and non-skipped responses', async () => {
  const state = { turnCount: 21, estimatedBytesRead: 0, warningsEmitted: 0 };
  const skippedResponse = await runCheck(
    { prompt: 'yes', sessionId: 's1', cwd: '/repo' },
    deps({ sessionState: state, config: sessionConfig })
  );
  assert.equal(skippedResponse.skipped, true);
  assert.equal(skippedResponse.sessionWarning.level, 'soft');

  const fullResponse = await runCheck(
    { prompt: 'add validation', sessionId: 's2', cwd: '/repo' },
    deps({ sessionState: state, config: sessionConfig })
  );
  assert.equal(fullResponse.sessionWarning.level, 'soft');
});

test('runCheck.sessionWarning is null when no session state is passed', async () => {
  const response = await runCheck({ prompt: 'add validation', sessionId: 's1', cwd: '/repo' }, deps());
  assert.equal(response.sessionWarning, null);
});

test('runCheck falls back to searchCode when no manifest/feature matches are found', async () => {
  const searchCode = async () => [{ path: 'src/legacy/report.js', symbol: 'renderReport', kind: 'function' }];
  const response = await runCheck(
    { prompt: 'improve the report generator', sessionId: 'search-1', cwd: '/repo' },
    deps({ searchCode })
  );
  assert.ok(response.matches.some((m) => m.path === 'src/legacy/report.js' && m.confidence === 'low'));
  assert.equal(response.unknownSlots.includes('scope'), false);
});

// --- isPipelineInvocation / runCheck pipeline skip --------------------

test('isPipelineInvocation matches the pipeline sub-agent invocation template', () => {
  const prompt =
    'Act as the agent "Planner" defined in ".github/agents/planner.agent.md".\n' +
    'Read and apply that spec in full.\n\ntaskId: add-retry-queue\nbasePath: .agentflow/add-retry-queue\n\n' +
    'Task: add a retry queue\nReturn ONLY: status, artifact path, and up to 3 bullets.';
  assert.equal(isPipelineInvocation(prompt), true);
});

test('isPipelineInvocation matches a prompt that only references a .agentflow/ artifact path', () => {
  assert.equal(isPipelineInvocation('Fix only the BLOCKER items in .agentflow/add-retry-queue/review.md'), true);
});

test('isPipelineInvocation is false for a normal human request', () => {
  assert.equal(isPipelineInvocation('add a retry queue around fetchOrder'), false);
  assert.equal(isPipelineInvocation(''), false);
});

test('runCheck skips full analysis and reports skipReason "pipeline" for a sub-agent invocation prompt', async () => {
  const prompt = 'Act as the agent "Implementer" defined in ".github/agents/implementer.agent.md". Execute .agentflow/add-retry-queue/plan.md.';
  const response = await runCheck({ prompt, sessionId: 'pipeline-1', cwd: '/repo' }, deps());
  assert.equal(response.skipped, true);
  assert.equal(response.skipReason, 'pipeline');
  assert.deepEqual(response.questions, []);
});

test('runCheck still runs full analysis on the human\'s original request to the planner', async () => {
  const response = await runCheck(
    { prompt: 'add a retry queue around fetchOrder', sessionId: 'human-1', cwd: '/repo' },
    deps()
  );
  assert.equal(response.skipped, false);
  assert.equal(response.skipReason, undefined);
});

test('a short-followup skip still reports skipReason "short-followup"', async () => {
  const response = await runCheck({ prompt: 'yes', sessionId: 'human-2', cwd: '/repo' }, deps());
  assert.equal(response.skipped, true);
  assert.equal(response.skipReason, 'short-followup');
});
