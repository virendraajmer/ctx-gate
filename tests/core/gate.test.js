'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  isShortFollowUp,
  extractMentionedEntities,
  matchFeatures,
  matchLearned,
  identifyUnknownSlots,
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

const features = { version: 1, mappings: [{ word: 'sorting', paths: ['src/utils/sort.js'] }] };

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
  return { manifest, standing, learned, features, searchCode: async () => [], sessionCache: {}, ...overrides };
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

// --- matchFeatures -------------------------------------------------

test('matchFeatures matches a business word to its mapped path', () => {
  const matches = matchFeatures('change sorting order', features);
  assert.deepEqual(matches, [{ path: 'src/utils/sort.js', kind: 'feature-mapping', confidence: 'high' }]);
});

test('matchFeatures returns [] when no word matches', () => {
  assert.deepEqual(matchFeatures('add validation', features), []);
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

test('runCheck falls back to searchCode when no manifest/feature matches are found', async () => {
  const searchCode = async () => [{ path: 'src/legacy/report.js', symbol: 'renderReport', kind: 'function' }];
  const response = await runCheck(
    { prompt: 'improve the report generator', sessionId: 'search-1', cwd: '/repo' },
    deps({ searchCode })
  );
  assert.ok(response.matches.some((m) => m.path === 'src/legacy/report.js' && m.confidence === 'low'));
  assert.equal(response.unknownSlots.includes('scope'), false);
});
