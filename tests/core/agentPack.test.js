'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const store = require('../../src/memory/store');
const {
  install,
  update,
  validate,
  validateAgentFile,
  renderAgentFile,
  classifyDrift,
  loadPackManifest,
  AGENT_FILES,
  HANDOFF_SKILL_FILE,
  PACK_DIR,
  isHandoffInstalled,
} = require('../../src/core/agentPack');

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-gate-agentpack-'));
}

// --- pack.json hash-match ----------------------------------------------

test('every file recorded in pack.json hash-matches the bundled file on disk', () => {
  const packManifest = loadPackManifest();
  for (const [filename, hash] of Object.entries(packManifest.files)) {
    const content = fs.readFileSync(path.join(PACK_DIR, filename), 'utf8');
    assert.equal(sha256(content), hash, `${filename} hash mismatch`);
  }
});

test('install on a clean repo writes files byte-identical to the bundle (no substitution occurs)', () => {
  const dir = tmpRepo();
  try {
    const { results } = install(dir);
    assert.equal(results.length, AGENT_FILES.length + 1); // + the handoff skill, installed unconditionally
    assert.ok(results.every((r) => r.status === 'written'));

    for (const filename of AGENT_FILES) {
      const installed = fs.readFileSync(path.join(dir, '.github', 'agents', filename), 'utf8');
      const bundled = fs.readFileSync(path.join(PACK_DIR, filename), 'utf8');
      assert.equal(installed, bundled);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- handoff skill installation ------------------------------------------

test('install writes the handoff skill alongside the four agents, byte-identical to the bundle', () => {
  const dir = tmpRepo();
  try {
    const { results } = install(dir);
    const handoff = results.find((r) => r.file === `.github/skills/${HANDOFF_SKILL_FILE}`);
    assert.equal(handoff.status, 'written');

    const installed = fs.readFileSync(path.join(dir, '.github', 'skills', 'handoff', 'SKILL.md'), 'utf8');
    const bundled = fs.readFileSync(path.join(PACK_DIR, 'handoff', 'SKILL.md'), 'utf8');
    assert.equal(installed, bundled);
    assert.equal(isHandoffInstalled(dir), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('isHandoffInstalled is false before install runs', () => {
  const dir = tmpRepo();
  try {
    assert.equal(isHandoffInstalled(dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('install never overwrites a hand-edited handoff skill — reports conflict with a diff', () => {
  const dir = tmpRepo();
  try {
    const skillDir = path.join(dir, '.github', 'skills', 'handoff');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# a hand-edited handoff skill\n', 'utf8');

    const { results } = install(dir);
    const handoff = results.find((r) => r.file === `.github/skills/${HANDOFF_SKILL_FILE}`);
    assert.equal(handoff.status, 'conflict');
    assert.match(handoff.diffText, /existing/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('update applies a safe (pack-only) change to the handoff skill', () => {
  const dir = tmpRepo();
  try {
    install(dir);
    const target = path.join(dir, '.github', 'skills', 'handoff', 'SKILL.md');
    const oldContent = '# old handoff skill body\n';
    fs.writeFileSync(target, oldContent, 'utf8');
    const statePath = path.join(dir, '.context-ops', 'agent-pack.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state.files[HANDOFF_SKILL_FILE] = sha256(oldContent);
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');

    const { results } = update(dir);
    const handoff = results.find((r) => r.file === `.github/skills/${HANDOFF_SKILL_FILE}`);
    assert.equal(handoff.status, 'safe-to-apply');

    const bundled = fs.readFileSync(path.join(PACK_DIR, 'handoff', 'SKILL.md'), 'utf8');
    assert.equal(fs.readFileSync(target, 'utf8'), bundled);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('install is idempotent: a second run reports unchanged for every file', () => {
  const dir = tmpRepo();
  try {
    install(dir);
    const { results } = install(dir);
    assert.ok(results.every((r) => r.status === 'unchanged'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('install never overwrites a target file that differs from the pack — reports conflict with a diff', () => {
  const dir = tmpRepo();
  try {
    const agentsDir = path.join(dir, '.github', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, 'planner.agent.md'), '# a hand-edited planner\n', 'utf8');

    const { results } = install(dir);
    const plannerResult = results.find((r) => r.file.endsWith('planner.agent.md'));
    assert.equal(plannerResult.status, 'conflict');
    assert.match(plannerResult.diffText, /existing/);

    const onDisk = fs.readFileSync(path.join(agentsDir, 'planner.agent.md'), 'utf8');
    assert.equal(onDisk, '# a hand-edited planner\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('install --with-guidelines writes agents.instructions.md and reports its real measured token count', () => {
  const dir = tmpRepo();
  try {
    const { results } = install(dir, { withGuidelines: true });
    const guidelines = results.find((r) => r.file.endsWith('agents.instructions.md'));
    assert.equal(guidelines.status, 'written');
    assert.ok(guidelines.tokenCount > 0);
    assert.ok(fs.existsSync(path.join(dir, '.github', 'instructions', 'agents.instructions.md')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('install without --with-guidelines never writes agents.instructions.md', () => {
  const dir = tmpRepo();
  try {
    install(dir);
    assert.equal(fs.existsSync(path.join(dir, '.github', 'instructions', 'agents.instructions.md')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('install adds .agentflow/ to .gitignore by default (commitArtifacts: false)', () => {
  const dir = tmpRepo();
  try {
    install(dir);
    const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    assert.match(gitignore, /^\.agentflow\/$/m);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('install skips the .gitignore entry when agentPack.commitArtifacts is true', () => {
  const dir = tmpRepo();
  try {
    store.writeTeamConfig(dir, { version: 1, agentPack: { commitArtifacts: true } });
    install(dir);
    const gitignorePath = path.join(dir, '.gitignore');
    const gitignore = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
    assert.doesNotMatch(gitignore, /\.agentflow\//);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('install substitutes agentPack.model from config.yml into every agent file', () => {
  const dir = tmpRepo();
  try {
    store.writeTeamConfig(dir, { version: 1, agentPack: { model: 'gpt-4o' } });
    install(dir);
    const planner = fs.readFileSync(path.join(dir, '.github', 'agents', 'planner.agent.md'), 'utf8');
    assert.match(planner, /^model: 'gpt-4o'$/m);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- renderAgentFile -----------------------------------------------------

test('renderAgentFile substitutes the model frontmatter value only', () => {
  const src = "---\nmodel: 'Claude Sonnet 4.5'\n---\nbody\n";
  const out = renderAgentFile('reviewer.agent.md', src, { model: 'gpt-4o' });
  assert.match(out, /model: 'gpt-4o'/);
});

test('renderAgentFile inserts a Verification test-command hint only in planner.agent.md', () => {
  const src = '## Verification\n<Command(s) to run, and what passing output looks like.>\n';
  const plannerOut = renderAgentFile('planner.agent.md', src, { testCommand: 'npm test' });
  assert.match(plannerOut, /npm test/);

  const reviewerOut = renderAgentFile('reviewer.agent.md', src, { testCommand: 'npm test' });
  assert.equal(reviewerOut, src);
});

// --- classifyDrift ---------------------------------------------------------

test('classifyDrift covers all four update() categories plus missing', () => {
  assert.equal(classifyDrift({ recordedHash: undefined, currentHash: undefined, newHash: 'x' }), 'missing');
  assert.equal(classifyDrift({ recordedHash: 'a', currentHash: 'a', newHash: 'a' }), 'unchanged');
  assert.equal(classifyDrift({ recordedHash: 'a', currentHash: 'a', newHash: 'b' }), 'safe-to-apply');
  assert.equal(classifyDrift({ recordedHash: 'a', currentHash: 'b', newHash: 'a' }), 'locally-modified');
  assert.equal(classifyDrift({ recordedHash: 'a', currentHash: 'b', newHash: 'c' }), 'manual-merge-needed');
});

// --- update() ---------------------------------------------------------

test('update reports unchanged for every file right after a fresh install', () => {
  const dir = tmpRepo();
  try {
    install(dir);
    const { results } = update(dir);
    assert.ok(results.every((r) => r.status === 'unchanged'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('update detects a locally-modified file and never overwrites it', () => {
  const dir = tmpRepo();
  try {
    install(dir);
    const target = path.join(dir, '.github', 'agents', 'reviewer.agent.md');
    fs.writeFileSync(target, `${fs.readFileSync(target, 'utf8')}\n<!-- local note -->\n`, 'utf8');

    const { results } = update(dir);
    const reviewer = results.find((r) => r.file.endsWith('reviewer.agent.md'));
    assert.equal(reviewer.status, 'locally-modified');
    assert.match(fs.readFileSync(target, 'utf8'), /local note/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('update applies a safe (pack-only) change and updates the recorded hash', () => {
  const dir = tmpRepo();
  try {
    install(dir);

    // Simulate a prior pack version: the installed file and the recorded
    // hash both reflect old content the developer never touched.
    const oldContent = '# old pipeline body\n';
    const target = path.join(dir, '.github', 'agents', 'pipeline.agent.md');
    fs.writeFileSync(target, oldContent, 'utf8');
    const statePath = path.join(dir, '.context-ops', 'agent-pack.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state.files['pipeline.agent.md'] = sha256(oldContent);
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');

    const { results } = update(dir);
    const pipeline = results.find((r) => r.file.endsWith('pipeline.agent.md'));
    assert.equal(pipeline.status, 'safe-to-apply');

    const bundled = fs.readFileSync(path.join(PACK_DIR, 'pipeline.agent.md'), 'utf8');
    assert.equal(fs.readFileSync(target, 'utf8'), bundled);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- validate ---------------------------------------------------------

function writeAgentFile(dir, filename, content) {
  const target = path.join(dir, '.github', 'agents', filename);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
  return target;
}

test('validate passes the bundled agent-pack files with no errors', () => {
  const dir = tmpRepo();
  try {
    install(dir);
    const report = validate(dir);
    const errors = report.files.flatMap((f) => f.errors);
    assert.deepEqual(errors, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validate flags a missing description', () => {
  const dir = tmpRepo();
  try {
    writeAgentFile(dir, 'no-desc.agent.md', "---\nname: 'X'\ntools: ['read']\n---\nbody\n");
    const report = validate(dir);
    const f = report.files.find((r) => r.file.endsWith('no-desc.agent.md'));
    assert.ok(f.errors.some((e) => /description/.test(e)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validate flags a description that is not single-quoted', () => {
  const dir = tmpRepo();
  try {
    writeAgentFile(dir, 'bad-quote.agent.md', '---\ndescription: "unquoted properly"\ntools: [\'read\']\n---\nbody\n');
    const report = validate(dir);
    const f = report.files.find((r) => r.file.endsWith('bad-quote.agent.md'));
    assert.ok(f.errors.some((e) => /single-quoted/.test(e)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validate warns on an empty tools list and on an absent tools list', () => {
  const dir = tmpRepo();
  try {
    writeAgentFile(
      dir,
      'empty-tools.agent.md',
      "---\ndescription: 'This agent has a fully empty tools list which disables everything for it'\ntools: []\n---\nbody\n"
    );
    writeAgentFile(
      dir,
      'no-tools.agent.md',
      "---\ndescription: 'This agent has no tools key at all which grants every tool by default'\n---\nbody\n"
    );
    const report = validate(dir);
    const empty = report.files.find((r) => r.file.endsWith('empty-tools.agent.md'));
    const none = report.files.find((r) => r.file.endsWith('no-tools.agent.md'));
    assert.ok(empty.warnings.some((w) => /empty list/.test(w)));
    assert.ok(none.warnings.some((w) => /absent/.test(w)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validate warns when model or handoffs are set without target: vscode', () => {
  const dir = tmpRepo();
  try {
    writeAgentFile(
      dir,
      'no-target.agent.md',
      "---\ndescription: 'Uses a model field but never declares a vscode-only target property'\ntools: ['read']\nmodel: 'gpt-4o'\n---\nbody\n"
    );
    const report = validate(dir);
    const f = report.files.find((r) => r.file.endsWith('no-target.agent.md'));
    assert.ok(f.warnings.some((w) => /target/.test(w)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validate reports an error for a handoff pointing at an agent file that does not exist', () => {
  const dir = tmpRepo();
  try {
    writeAgentFile(
      dir,
      'dangling.agent.md',
      "---\ndescription: 'Hands off to an agent identifier that has no matching agent file in this repo'\ntools: ['read']\nhandoffs:\n  - label: Go\n    agent: does-not-exist\n---\nbody\n"
    );
    const report = validate(dir);
    const f = report.files.find((r) => r.file.endsWith('dangling.agent.md'));
    assert.ok(f.errors.some((e) => /does not resolve/.test(e)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validate rejects a filename that is not lowercase-with-hyphens', () => {
  const dir = tmpRepo();
  try {
    writeAgentFile(dir, 'BadName.agent.md', "---\ndescription: 'A perfectly fine description that is long enough to pass'\ntools: ['read']\n---\nbody\n");
    const report = validate(dir);
    const f = report.files.find((r) => r.file.endsWith('BadName.agent.md'));
    assert.ok(f.errors.some((e) => /lowercase-with-hyphens/.test(e)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validate rejects a file over the 30,000-character budget', () => {
  const dir = tmpRepo();
  try {
    const big = `---\ndescription: 'A perfectly fine description that is long enough to pass here'\ntools: ['read']\n---\n${'x'.repeat(31000)}\n`;
    writeAgentFile(dir, 'too-big.agent.md', big);
    const report = validate(dir);
    const f = report.files.find((r) => r.file.endsWith('too-big.agent.md'));
    assert.ok(f.errors.some((e) => /30,000-character/.test(e)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateAgentFile is directly usable without touching disk', () => {
  const content = "---\ndescription: 'A perfectly fine description that is long enough to pass here'\ntools: ['read']\n---\nbody\n";
  const result = validateAgentFile('/tmp/fake.agent.md', content, new Set());
  assert.deepEqual(result.errors, []);
});
