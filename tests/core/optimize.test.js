'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');

const { init } = require('../../src/core/init');
const {
  BudgetExceededError,
  scanForOptimizer,
  renderAgentsMd,
  renderInstructionsFiles,
  renderSkillFiles,
  diffAgainstExisting,
  optimize,
} = require('../../src/core/optimize');
const { checkBudget, AGENTS_MD_BUDGET, INSTRUCTIONS_BUDGET } = require('../../src/tokenBudget');

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
    await init(dir, { streams: silentStreams() });
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
    await init(dir, { streams: silentStreams() });
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
    await init(dir, { streams: silentStreams() });
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

test('scanForOptimizer never fabricates a claim it has no evidence for (empty repo)', async () => {
  const dir = copyFixture('empty-repo');
  try {
    await init(dir, { streams: silentStreams() });
    const facts = scanForOptimizer(dir, { stacks: {}, endpoints: [] });
    assert.deepEqual(facts.alwaysTrue, []);
    assert.deepEqual(facts.instructionsGroups, []);
    assert.deepEqual(facts.skillGroups, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
