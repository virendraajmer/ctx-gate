'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');

const { init } = require('../../src/core/init');
const { fakeMcpClient } = require('../helpers/fakeMcpClient');
const {
  BudgetExceededError,
  scanForOptimizer,
  selectContextTerms,
  renderAgentsMd,
  renderContextMd,
  renderInstructionsFiles,
  renderSkillFiles,
  diffAgainstExisting,
  optimize,
} = require('../../src/core/optimize');
const store = require('../../src/memory/store');
const { checkBudget, countTokens, AGENTS_MD_BUDGET, INSTRUCTIONS_BUDGET } = require('../../src/tokenBudget');
const { buildEfficiencyBlock } = require('../../src/core/efficiencyBlock');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

function copyFixture(name) {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-gate-optimize-'));
  fs.cpSync(path.join(FIXTURES, name), dest, { recursive: true });
  return dest;
}

function silentStreams(blankLines = 10) {
  let remaining = blankLines;
  const input = new Readable({
    read() {
      setImmediate(() => {
        if (remaining <= 0) {
          this.push(null);
        } else {
          remaining -= 1;
          this.push('\n');
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

const NO_LINE_NUMBER_RE = /:\d+\b/;

function assertNoLineNumberCitations(text) {
  assert.doesNotMatch(text, NO_LINE_NUMBER_RE);
}

// --- unit tests: render* + diffAgainstExisting -----------------------------

const sampleFacts = {
  stacksPresent: ['node', 'react'],
  summary: 'This repo uses node, react.',
  efficiencyBlock: buildEfficiencyBlock({ testCommand: 'vitest', stacksPresent: ['node', 'react'] }),
  alwaysTrue: [{ claim: 'Tests run via `vitest`', evidence: { path: 'package.json', symbol: 'scripts.test' } }],
  instructionsGroups: [
    {
      id: 'react-screens',
      applyTo: 'src/**/*.{jsx,tsx}',
      title: 'React screens',
      rules: [{ claim: 'Screen "Orders" is routed at `/orders`', evidence: { path: 'src/pages/OrdersPage.tsx' } }],
    },
  ],
  skillGroups: [
    {
      id: 'adding-a-screen',
      title: 'Adding a screen',
      description: 'Add a new screen to this app',
      rules: [{ claim: '"Orders" is a working example', evidence: { path: 'src/pages/OrdersPage.tsx' } }],
    },
  ],
};

test('renderAgentsMd includes the summary, always-true bullets with evidence, and a routing section', () => {
  const md = renderAgentsMd(sampleFacts);
  assert.match(md, /This repo uses node, react\./);
  assert.match(md, /Tests run via `vitest` \(package\.json#scripts\.test\)/);
  assert.match(md, /react-screens\.instructions\.md/);
  assert.match(md, /adding-a-screen\/SKILL\.md/);
  assertNoLineNumberCitations(md);
});

test('renderAgentsMd places the fixed efficiency block after the summary and before the routing list', () => {
  const md = renderAgentsMd(sampleFacts);
  const summaryIdx = md.indexOf('This repo uses node, react.');
  const blockIdx = md.indexOf('## Running commands');
  const alwaysTrueIdx = md.indexOf('## Always true');
  const routingIdx = md.indexOf('## Routing');
  assert.ok(summaryIdx > -1 && blockIdx > -1 && alwaysTrueIdx > -1 && routingIdx > -1);
  assert.ok(summaryIdx < blockIdx);
  assert.ok(blockIdx < alwaysTrueIdx);
  assert.ok(blockIdx < routingIdx);
  assert.match(md, /## Reading files/);
  assert.match(md, /## Editing files/);
  assert.match(md, /## Response style/);
});

test('renderInstructionsFiles produces one file per group with applyTo frontmatter data', () => {
  const files = renderInstructionsFiles(sampleFacts);
  assert.equal(files.length, 1);
  assert.equal(files[0].filename, 'react-screens.instructions.md');
  assert.equal(files[0].frontmatter.applyTo, 'src/**/*.{jsx,tsx}');
  assert.match(files[0].body, /Orders/);
  assertNoLineNumberCitations(files[0].body);
});

test('renderSkillFiles produces one SKILL.md body per group with name/description frontmatter', () => {
  const files = renderSkillFiles(sampleFacts);
  assert.equal(files.length, 1);
  assert.equal(files[0].dirName, 'adding-a-screen');
  assert.match(files[0].body, /name: adding-a-screen/);
  assert.match(files[0].body, /description: Add a new screen to this app/);
  assertNoLineNumberCitations(files[0].body);
});

test('renderSkillFiles appends a sharp "Done when" completion criterion only when a confirmed acceptance answer exists', () => {
  const withAcceptance = renderSkillFiles({ ...sampleFacts, acceptanceCriterion: 'tests pass + CI green' });
  assert.match(withAcceptance[0].body, /Done when: tests pass \+ CI green/);

  const without = renderSkillFiles(sampleFacts);
  assert.doesNotMatch(without[0].body, /Done when:/);
});

test('diffAgainstExisting reports changed:true with diff text when the file does not exist yet', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-gate-diff-'));
  try {
    const result = diffAgainstExisting(path.join(dir, 'AGENTS.md'), 'hello\n');
    assert.equal(result.changed, true);
    assert.match(result.diffText, /\+hello/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('diffAgainstExisting reports changed:false for identical content', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-gate-diff-'));
  try {
    const p = path.join(dir, 'AGENTS.md');
    fs.writeFileSync(p, 'hello\n', 'utf8');
    const result = diffAgainstExisting(p, 'hello\n');
    assert.deepEqual(result, { changed: false, diffText: '' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('diffAgainstExisting reports changed:true with a real unified diff for modified content', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-gate-diff-'));
  try {
    const p = path.join(dir, 'AGENTS.md');
    fs.writeFileSync(p, 'old line\n', 'utf8');
    const result = diffAgainstExisting(p, 'new line\n');
    assert.equal(result.changed, true);
    assert.match(result.diffText, /-old line/);
    assert.match(result.diffText, /\+new line/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- BudgetExceededError: real over-budget input, real tokenizer ----------

test('optimize throws BudgetExceededError when an instructions file cannot fit even after splitting', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-gate-overbudget-'));
  try {
    const hugeEndpoints = Array.from({ length: 2000 }, (_, i) => ({
      method: 'GET',
      route: `/api/very/long/descriptive/route/segment/number/${i}/with/extra/padding/words/to/inflate/tokens`,
      path: `src/api/module_${i}.py#handler_${i}`,
      confidence: 'high',
      source: 'fastapi',
    }));
    fs.mkdirSync(path.join(dir, '.context-ops'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.context-ops', 'manifest.json'),
      JSON.stringify({
        stacks: { node: { detected: false }, react: { detected: false }, python: { detected: true }, dotnet: { detected: false } },
        endpoints: hugeEndpoints,
      })
    );

    await assert.rejects(() => optimize(dir, { write: false }), BudgetExceededError);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- end-to-end against real fixtures --------------------------------------

test('optimize on the node-react fixture produces an under-budget AGENTS.md with real path citations, writes nothing without --write', async () => {
  const dir = copyFixture('node-react-basic');
  try {
    await init(dir, { streams: silentStreams(), mcp: { client: fakeMcpClient() } });
    const result = await optimize(dir, { write: false });

    const budget = checkBudget(result.agentsMd, AGENTS_MD_BUDGET);
    assert.equal(budget.ok, true);
    assertNoLineNumberCitations(result.agentsMd);

    for (const file of result.instructionsFiles) {
      assertNoLineNumberCitations(file.body);
    }
    for (const file of result.skillFiles) {
      assertNoLineNumberCitations(file.body);
    }

    assert.ok(result.diffs.every((d) => d.changed === true));
    assert.equal(fs.existsSync(path.join(dir, 'AGENTS.md')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('optimize --write actually writes files, and a second run is idempotent (no further diff)', async () => {
  const dir = copyFixture('node-react-basic');
  try {
    await init(dir, { streams: silentStreams(), mcp: { client: fakeMcpClient() } });
    await optimize(dir, { write: true });

    assert.equal(fs.existsSync(path.join(dir, 'AGENTS.md')), true);

    const second = await optimize(dir, { write: false });
    assert.ok(second.diffs.every((d) => d.changed === false));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('optimize on the python-fastapi fixture cites real endpoint paths, never a line number', async () => {
  const dir = copyFixture('python-fastapi-basic');
  try {
    await init(dir, { streams: silentStreams(), mcp: { client: fakeMcpClient() } });
    const result = await optimize(dir, { write: false });

    const apiInstructions = result.instructionsFiles.find((f) => f.filename === 'api-endpoints.instructions.md');
    assert.ok(apiInstructions);
    assert.match(apiInstructions.body, /GET \/api\/orders/);
    assertNoLineNumberCitations(apiInstructions.body);

    for (const file of result.instructionsFiles) {
      const budget = checkBudget(file.body, INSTRUCTIONS_BUDGET);
      assert.equal(budget.ok, true);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('two consecutive optimize runs on an unchanged repo produce a byte-identical AGENTS.md', async () => {
  const dir = copyFixture('node-react-basic');
  try {
    await init(dir, { streams: silentStreams(), mcp: { client: fakeMcpClient() } });
    const first = await optimize(dir, { write: false });
    const second = await optimize(dir, { write: false });
    assert.equal(first.agentsMd, second.agentsMd);
    assert.equal(Buffer.compare(Buffer.from(first.agentsMd, 'utf8'), Buffer.from(second.agentsMd, 'utf8')), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('optimize reports the real measured token count of the efficiency block, and it is counted against the AGENTS.md budget', async () => {
  const dir = copyFixture('node-react-basic');
  try {
    await init(dir, { streams: silentStreams(), mcp: { client: fakeMcpClient() } });
    const result = await optimize(dir, { write: false });
    assert.equal(typeof result.efficiencyBlockTokens, 'number');
    assert.ok(result.efficiencyBlockTokens > 0);
    assert.match(result.agentsMd, /## Running commands/);
    assert.ok(countTokens(result.agentsMd) <= AGENTS_MD_BUDGET);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the efficiency block extends the baseline ignore list with .NET-specific paths, without dropping the baseline', async () => {
  const dir = copyFixture('dotnet-basic');
  try {
    await init(dir, { streams: silentStreams(), mcp: { client: fakeMcpClient() } });
    const result = await optimize(dir, { write: false });
    assert.match(result.agentsMd, /Never read: node_modules\/, dist\/, build\/, \*\.lock, \*\.min\.js, generated\/, migrations\/, test fixtures, sample data, bin\/, obj\/, packages\/\./);
    assert.match(result.agentsMd, /`dotnet test > \/tmp\/out\.log/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the efficiency block extends the baseline ignore list with Python-specific paths, without dropping the baseline', async () => {
  const dir = copyFixture('python-fastapi-basic');
  try {
    await init(dir, { streams: silentStreams(), mcp: { client: fakeMcpClient() } });
    const result = await optimize(dir, { write: false });
    assert.match(result.agentsMd, /Never read: node_modules\/, dist\/, build\/, \*\.lock, \*\.min\.js, generated\/, migrations\/, test fixtures, sample data, __pycache__\/, \.venv\/, \*\.egg-info\/\./);
    assert.match(result.agentsMd, /`pytest > \/tmp\/out\.log/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- CONTEXT.md / glossary rendering ---------------------------------------

test('selectContextTerms keeps only confirmed/inferred terms, sorted by hits descending', () => {
  const glossary = {
    terms: [
      { term: 'low', status: 'confirmed', hits: 1 },
      { term: 'high', status: 'inferred', hits: 9 },
      { term: 'unconfirmed', status: 'candidate', hits: 100 },
      { term: 'mid', status: 'confirmed', hits: 5 },
    ],
  };
  const terms = selectContextTerms(glossary);
  assert.deepEqual(terms.map((t) => t.term), ['high', 'mid', 'low']);
});

test('selectContextTerms returns [] for a null glossary', () => {
  assert.deepEqual(selectContextTerms(null), []);
});

test('renderContextMd includes each term\'s definition, aka, and paths', () => {
  const terms = [
    { term: 'Orders screen', aka: ['order list'], definition: 'The customer-facing list of placed orders.', paths: ['src/screens/OrderList/**'] },
  ];
  const md = renderContextMd(terms);
  assert.match(md, /## Orders screen/);
  assert.match(md, /aka: order list/);
  assert.match(md, /The customer-facing list of placed orders\./);
  assert.match(md, /Paths: src\/screens\/OrderList\/\*\*/);
});

test('renderContextMd notes how many terms were omitted rather than silently truncating', () => {
  const terms = [{ term: 'a', definition: 'x', paths: [] }, { term: 'b', definition: 'y', paths: [] }];
  const md = renderContextMd(terms, { maxTerms: 1 });
  assert.match(md, /## a/);
  assert.doesNotMatch(md, /## b/);
  assert.match(md, /1 more term omitted to stay under budget/);
});

test('renderAgentsMd points to CONTEXT.md instead of duplicating it, only when it has content', () => {
  const withContext = renderAgentsMd({ ...sampleFacts, hasContextMd: true });
  assert.match(withContext, /`CONTEXT\.md`/);

  const withoutContext = renderAgentsMd({ ...sampleFacts, hasContextMd: false });
  assert.doesNotMatch(withoutContext, /CONTEXT\.md/);
});

test('optimize renders and writes CONTEXT.md from confirmed glossary terms, and a second run is byte-identical', async () => {
  const dir = copyFixture('node-react-basic');
  try {
    await init(dir, { streams: silentStreams(), mcp: { client: fakeMcpClient() } });
    store.writeGlossary(dir, {
      version: 1,
      terms: [
        { term: 'sorting', aka: [], definition: 'How order rows are sorted.', paths: ['src/utils/sort.js'], status: 'confirmed', hits: 3 },
        { term: 'unconfirmed-term', aka: [], definition: '', paths: [], status: 'candidate', hits: 100 },
      ],
    });

    await optimize(dir, { write: true });
    const written = fs.readFileSync(path.join(dir, 'CONTEXT.md'), 'utf8');
    assert.match(written, /## sorting/);
    assert.match(written, /How order rows are sorted\./);
    assert.doesNotMatch(written, /unconfirmed-term/);
    assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /CONTEXT\.md/);

    const first = await optimize(dir, { write: false });
    const second = await optimize(dir, { write: false });
    assert.equal(first.contextMd, second.contextMd);
    assert.ok(second.diffs.every((d) => d.changed === false));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scanForOptimizer never fabricates a claim it has no evidence for (empty repo)', async () => {
  const dir = copyFixture('empty-repo');
  try {
    await init(dir, { streams: silentStreams(), mcp: { client: fakeMcpClient() } });
    const facts = scanForOptimizer(dir, { stacks: {}, endpoints: [] });
    assert.deepEqual(facts.alwaysTrue, []);
    assert.deepEqual(facts.instructionsGroups, []);
    assert.deepEqual(facts.skillGroups, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
