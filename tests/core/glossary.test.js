'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');

const store = require('../../src/memory/store');
const {
  seedCandidateTerms,
  buildGlossaryTermsFromCandidates,
  collectRepoSymbolNames,
  addTerm,
  listTerms,
  reviewTerms,
} = require('../../src/core/glossary');

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-gate-glossary-'));
}

function scriptedStreams(lines) {
  const queue = [...lines];
  const input = new Readable({
    read() {
      const line = queue.shift();
      setImmediate(() => {
        if (line === undefined) {
          this.push(null);
        } else {
          this.push(`${line}\n`);
        }
      });
    },
  });
  const output = new Writable({
    write(chunk, enc, cb) {
      cb();
    },
  });
  return { input, output };
}

// --- seedCandidateTerms -----------------------------------------------

test('seedCandidateTerms derives a candidate from a react screen name', () => {
  const dir = tmpRepo();
  try {
    const manifest = {
      stacks: { react: { detected: true, screens: [{ name: 'Orders', route: '/orders', path: 'src/pages/OrdersPage.tsx' }] } },
      endpoints: [],
    };
    const candidates = seedCandidateTerms(dir, manifest);
    assert.ok(candidates.some((c) => c.term === 'Orders'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('seedCandidateTerms derives a candidate from an endpoint route segment, skipping generic segments', () => {
  const dir = tmpRepo();
  try {
    const manifest = { stacks: {}, endpoints: [{ method: 'GET', route: '/api/orders', path: 'src/api/orders.py#list_orders' }] };
    const candidates = seedCandidateTerms(dir, manifest);
    const orders = candidates.find((c) => c.term === 'orders');
    assert.ok(orders);
    assert.deepEqual(orders.paths, ['src/api/orders.py']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('seedCandidateTerms sorts by occurrence count descending', () => {
  const dir = tmpRepo();
  try {
    const manifest = {
      stacks: { react: { detected: true, screens: [{ name: 'Rare', path: 'a.tsx' }, { name: 'Common', path: 'b.tsx' }, { name: 'Common', path: 'c.tsx' }] } },
      endpoints: [],
    };
    const candidates = seedCandidateTerms(dir, manifest);
    assert.equal(candidates[0].term, 'Common');
    assert.equal(candidates[0].occurrences, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('seedCandidateTerms returns [] for a manifest with no signal', () => {
  const dir = tmpRepo();
  try {
    assert.deepEqual(seedCandidateTerms(dir, { stacks: {}, endpoints: [] }), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- buildGlossaryTermsFromCandidates -----------------------------------

test('buildGlossaryTermsFromCandidates confirms a term when the developer answers, leaves it candidate on blank', async () => {
  const candidates = [
    { term: 'orders', paths: ['src/api/orders.py'], occurrences: 3 },
    { term: 'unasked', paths: [], occurrences: 1 },
  ];
  const { input, output } = scriptedStreams(['Placed customer orders', '']);
  const terms = await buildGlossaryTermsFromCandidates(candidates, { input, output });

  assert.equal(terms[0].status, 'confirmed');
  assert.equal(terms[0].definition, 'Placed customer orders');
  assert.equal(terms[1].status, 'candidate');
  assert.equal(terms[1].definition, '');
});

test('buildGlossaryTermsFromCandidates never prompts past MAX_INIT_DEFINITION_PROMPTS, rest stay candidate', async () => {
  const candidates = Array.from({ length: 10 }, (_, i) => ({ term: `term-${i}`, paths: [], occurrences: 10 - i }));
  const { input, output } = scriptedStreams(Array(8).fill(''));
  const terms = await buildGlossaryTermsFromCandidates(candidates, { input, output });

  assert.equal(terms.length, 10);
  assert.ok(terms.slice(8).every((t) => t.status === 'candidate'));
});

// --- collectRepoSymbolNames ---------------------------------------------

test('collectRepoSymbolNames collects lowercased file and directory basenames', () => {
  const dir = tmpRepo();
  try {
    fs.mkdirSync(path.join(dir, 'src', 'reconciliation'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'reconciliation', 'Engine.js'), '', 'utf8');
    const names = collectRepoSymbolNames(dir);
    assert.ok(names.has('engine'));
    assert.ok(names.has('reconciliation'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- addTerm / listTerms -------------------------------------------------

test('addTerm creates glossary.yml from scratch as a confirmed entry', () => {
  const dir = tmpRepo();
  try {
    const entry = addTerm(dir, 'sorting', 'How order rows are sorted.', { paths: ['src/utils/sort.js'] });
    assert.equal(entry.status, 'confirmed');
    assert.equal(entry.definition, 'How order rows are sorted.');

    const onDisk = store.readGlossary(dir);
    assert.equal(onDisk.terms.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('addTerm confirms an existing candidate rather than duplicating it', () => {
  const dir = tmpRepo();
  try {
    store.writeGlossary(dir, { version: 1, terms: [{ term: 'sorting', aka: [], definition: '', paths: [], status: 'candidate', hits: 2 }] });
    addTerm(dir, 'sorting', 'How order rows are sorted.');

    const onDisk = store.readGlossary(dir);
    assert.equal(onDisk.terms.length, 1);
    assert.equal(onDisk.terms[0].status, 'confirmed');
    assert.equal(onDisk.terms[0].hits, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('listTerms returns [] before glossary.yml exists', () => {
  const dir = tmpRepo();
  try {
    assert.deepEqual(listTerms(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- reviewTerms -----------------------------------------------------

test('reviewTerms surfaces candidate glossary entries and unresolved crossed-threshold unknown terms', () => {
  const dir = tmpRepo();
  try {
    store.writeGlossary(dir, {
      version: 1,
      terms: [{ term: 'orders', aka: [], definition: '', paths: [], status: 'candidate', hits: 0 }],
    });
    store.writeUnknownTerms(dir, {
      reconciliation: { term: 'reconciliation', sessions: ['s1', 's2', 's3'], firstSeen: 't1', lastSeen: 't3' },
      almost: { term: 'almost', sessions: ['s1'], firstSeen: 't1', lastSeen: 't1' },
    });

    const { candidateTerms, unresolvedUnknownTerms } = reviewTerms(dir);
    assert.equal(candidateTerms.length, 1);
    assert.equal(candidateTerms[0].term, 'orders');
    assert.equal(unresolvedUnknownTerms.length, 1);
    assert.equal(unresolvedUnknownTerms[0].term, 'reconciliation');
    assert.equal(unresolvedUnknownTerms[0].sessions, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reviewTerms omits an unknown term that already has a glossary entry', () => {
  const dir = tmpRepo();
  try {
    store.writeGlossary(dir, {
      version: 1,
      terms: [{ term: 'reconciliation', aka: [], definition: 'Matches ledger entries.', paths: [], status: 'confirmed', hits: 0 }],
    });
    store.writeUnknownTerms(dir, {
      reconciliation: { term: 'reconciliation', sessions: ['s1', 's2', 's3'], firstSeen: 't1', lastSeen: 't3' },
    });

    const { unresolvedUnknownTerms } = reviewTerms(dir);
    assert.deepEqual(unresolvedUnknownTerms, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
