'use strict';

// `ctx-gate agents install|update|validate` — bundles and installs the
// plan -> implement -> review agent pack (agent-pack/) into a target
// repo's .github/agents/, following the same diff-not-overwrite rule as
// src/core/optimize.js. Zero LLM calls, no network calls: this is file
// copying, hashing, and YAML parsing only. See addon-4-agent-pack.md.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');
const { createTwoFilesPatch } = require('diff');

const { countTokens } = require('../tokenBudget');
const { resolveTestCommand } = require('./efficiencyBlock');

const PACK_DIR = path.join(__dirname, '..', '..', 'agent-pack');
const AGENT_FILES = ['planner.agent.md', 'implementer.agent.md', 'reviewer.agent.md', 'pipeline.agent.md'];
const GUIDELINES_FILE = 'agents.instructions.md';
// Copilot skill format (.github/skills/<name>/SKILL.md), not an *.agent.md
// file, so it installs alongside AGENT_FILES but is never scanned by
// validate() below. See agent-pack/handoff/SKILL.md and addon-6 Part 3.
const HANDOFF_SKILL_FILE = 'handoff/SKILL.md';

const SKIP_DIRS = new Set(['node_modules', '.git', 'venv', '.venv', '__pycache__', 'bin', 'obj', 'dist', 'build']);

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function readPackFile(filename) {
  return fs.readFileSync(path.join(PACK_DIR, filename), 'utf8');
}

/** @returns {Object} the bundled pack.json */
function loadPackManifest() {
  return JSON.parse(fs.readFileSync(path.join(PACK_DIR, 'pack.json'), 'utf8'));
}

/**
 * Applies the only two per-repo substitutions the addon spec permits:
 * the `model:` frontmatter value, and (planner.agent.md only) a concrete
 * Verification command hint. Both are literal-string replacements
 * anchored on exact text present in the bundled originals — nothing else
 * about a file's body is templated, so an unmodified default install
 * (default model, no detected test command) stays byte-identical to the
 * bundle.
 *
 * @param {string} filename
 * @param {string} content
 * @param {{ model?: string, testCommand?: string|null }} [subs]
 * @returns {string}
 */
function renderAgentFile(filename, content, subs = {}) {
  let out = content;
  if (subs.model) {
    out = out.replace(/^model: '[^']*'$/m, `model: '${subs.model}'`);
  }
  if (filename === 'planner.agent.md' && subs.testCommand) {
    out = out.replace(
      '<Command(s) to run, and what passing output looks like.>',
      `<Command(s) to run, and what passing output looks like. This repo's detected test command: \`${subs.testCommand}\`.>`
    );
  }
  return out;
}

/**
 * @param {string} repoRoot
 * @returns {string} agentPack.model from config.yml, else the pack's own default
 */
function resolveModel(repoRoot) {
  const store = require('../memory/store');
  const { team } = store.readConfig(repoRoot);
  const packManifest = loadPackManifest();
  return (team && team.agentPack && team.agentPack.model) || packManifest.defaultModel;
}

/**
 * @param {string} repoRoot
 * @returns {string|null} the detected test command, or null if none was detected
 */
function resolveTestCommandHint(repoRoot) {
  const store = require('../memory/store');
  let manifest;
  try {
    manifest = store.readManifest(repoRoot);
  } catch {
    return null;
  }
  const cmd = resolveTestCommand(manifest.stacks || {});
  return cmd === '<test command>' ? null : cmd;
}

/**
 * @param {string} repoRoot
 * @returns {boolean} true if this repo's config opts into committing .agentflow/ run artifacts
 */
function commitArtifactsEnabled(repoRoot) {
  const store = require('../memory/store');
  const { team } = store.readConfig(repoRoot);
  return Boolean(team && team.agentPack && team.agentPack.commitArtifacts === true);
}

function targetAgentsDir(repoRoot) {
  return path.join(repoRoot, '.github', 'agents');
}

function targetInstructionsDir(repoRoot) {
  return path.join(repoRoot, '.github', 'instructions');
}

function targetSkillsDir(repoRoot) {
  return path.join(repoRoot, '.github', 'skills');
}

function agentPackStatePath(repoRoot) {
  return path.join(repoRoot, '.context-ops', 'agent-pack.json');
}

/** @returns {Object|null} */
function readInstalledState(repoRoot) {
  const p = agentPackStatePath(repoRoot);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeInstalledState(repoRoot, state) {
  const dir = path.dirname(agentPackStatePath(repoRoot));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(agentPackStatePath(repoRoot), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function diffText(targetLabel, existing, next) {
  return createTwoFilesPatch(targetLabel, targetLabel, existing, next, 'existing', 'proposed');
}

/**
 * Installs the four agent files (always) and, opt-in only, the authoring
 * guidelines file. Never overwrites a target file whose content differs
 * from what would be installed — reports a conflict with a diff instead.
 *
 * @param {string} repoRoot
 * @param {{ withGuidelines?: boolean }} [opts]
 * @returns {{ results: Array<{file: string, status: 'written'|'unchanged'|'conflict', diffText?: string, tokenCount?: number}> }}
 */
function install(repoRoot, opts = {}) {
  const packManifest = loadPackManifest();
  const model = resolveModel(repoRoot);
  const testCommand = resolveTestCommandHint(repoRoot);

  const installedState = readInstalledState(repoRoot) || { version: packManifest.version, files: {} };
  const results = [];

  const agentsDir = targetAgentsDir(repoRoot);
  for (const filename of AGENT_FILES) {
    const rendered = renderAgentFile(filename, readPackFile(filename), { model, testCommand });
    const targetPath = path.join(agentsDir, filename);
    const hash = sha256(rendered);

    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(agentsDir, { recursive: true });
      fs.writeFileSync(targetPath, rendered, 'utf8');
      installedState.files[filename] = hash;
      results.push({ file: `.github/agents/${filename}`, status: 'written' });
      continue;
    }

    const existing = fs.readFileSync(targetPath, 'utf8');
    if (existing === rendered) {
      installedState.files[filename] = hash;
      results.push({ file: `.github/agents/${filename}`, status: 'unchanged' });
      continue;
    }

    results.push({
      file: `.github/agents/${filename}`,
      status: 'conflict',
      diffText: diffText(filename, existing, rendered),
    });
  }

  {
    const content = readPackFile(HANDOFF_SKILL_FILE);
    const targetPath = path.join(targetSkillsDir(repoRoot), HANDOFF_SKILL_FILE);
    const hash = sha256(content);

    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, content, 'utf8');
      installedState.files[HANDOFF_SKILL_FILE] = hash;
      results.push({ file: `.github/skills/${HANDOFF_SKILL_FILE}`, status: 'written' });
    } else {
      const existing = fs.readFileSync(targetPath, 'utf8');
      if (existing === content) {
        installedState.files[HANDOFF_SKILL_FILE] = hash;
        results.push({ file: `.github/skills/${HANDOFF_SKILL_FILE}`, status: 'unchanged' });
      } else {
        results.push({
          file: `.github/skills/${HANDOFF_SKILL_FILE}`,
          status: 'conflict',
          diffText: diffText(HANDOFF_SKILL_FILE, existing, content),
        });
      }
    }
  }

  if (opts.withGuidelines) {
    const content = readPackFile(GUIDELINES_FILE);
    const targetPath = path.join(targetInstructionsDir(repoRoot), GUIDELINES_FILE);
    const hash = sha256(content);
    const tokenCount = countTokens(content);

    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetInstructionsDir(repoRoot), { recursive: true });
      fs.writeFileSync(targetPath, content, 'utf8');
      installedState.files[GUIDELINES_FILE] = hash;
      results.push({ file: `.github/instructions/${GUIDELINES_FILE}`, status: 'written', tokenCount });
    } else {
      const existing = fs.readFileSync(targetPath, 'utf8');
      if (existing === content) {
        installedState.files[GUIDELINES_FILE] = hash;
        results.push({ file: `.github/instructions/${GUIDELINES_FILE}`, status: 'unchanged', tokenCount });
      } else {
        results.push({
          file: `.github/instructions/${GUIDELINES_FILE}`,
          status: 'conflict',
          diffText: diffText(GUIDELINES_FILE, existing, content),
          tokenCount,
        });
      }
    }
  }

  installedState.version = packManifest.version;
  writeInstalledState(repoRoot, installedState);

  if (!commitArtifactsEnabled(repoRoot)) {
    const store = require('../memory/store');
    store.ensureGitignoreEntries(repoRoot, ['.agentflow/']);
  }

  return { results };
}

/**
 * Classifies one file's drift for `agents update`.
 *
 * @param {{ recordedHash: string|undefined, currentHash: string|undefined, newHash: string }} h
 * @returns {'missing'|'unchanged'|'safe-to-apply'|'locally-modified'|'manual-merge-needed'}
 */
function classifyDrift({ recordedHash, currentHash, newHash }) {
  if (currentHash === undefined) return 'missing';
  const userModified = currentHash !== recordedHash;
  const packChanged = newHash !== recordedHash;
  if (!userModified && !packChanged) return 'unchanged';
  if (!userModified && packChanged) return 'safe-to-apply';
  if (userModified && !packChanged) return 'locally-modified';
  return 'manual-merge-needed';
}

/**
 * Compares the installed pack against the bundled one and applies only
 * the files that are safe to apply (pack changed, developer never touched
 * the installed copy). Locally-modified and manual-merge-needed files are
 * reported but never written.
 *
 * @param {string} repoRoot
 * @returns {{ results: Array<{file: string, status: string, diffText?: string}> }}
 */
function update(repoRoot) {
  const packManifest = loadPackManifest();
  const model = resolveModel(repoRoot);
  const testCommand = resolveTestCommandHint(repoRoot);
  const installedState = readInstalledState(repoRoot) || { version: null, files: {} };

  const agentsDir = targetAgentsDir(repoRoot);
  const results = [];

  for (const filename of AGENT_FILES) {
    const targetPath = path.join(agentsDir, filename);
    const rendered = renderAgentFile(filename, readPackFile(filename), { model, testCommand });
    const newHash = sha256(rendered);
    const recordedHash = installedState.files[filename];

    if (!fs.existsSync(targetPath)) {
      const status = classifyDrift({ recordedHash, currentHash: undefined, newHash });
      results.push({ file: `.github/agents/${filename}`, status });
      continue;
    }

    const existing = fs.readFileSync(targetPath, 'utf8');
    const currentHash = sha256(existing);
    const status = classifyDrift({ recordedHash, currentHash, newHash });

    if (status === 'unchanged') {
      results.push({ file: `.github/agents/${filename}`, status });
      continue;
    }

    if (status === 'safe-to-apply') {
      fs.writeFileSync(targetPath, rendered, 'utf8');
      installedState.files[filename] = newHash;
      results.push({ file: `.github/agents/${filename}`, status, diffText: diffText(filename, existing, rendered) });
      continue;
    }

    // locally-modified / manual-merge-needed: report, never write.
    results.push({ file: `.github/agents/${filename}`, status, diffText: diffText(filename, existing, rendered) });
  }

  {
    const targetPath = path.join(targetSkillsDir(repoRoot), HANDOFF_SKILL_FILE);
    const content = readPackFile(HANDOFF_SKILL_FILE);
    const newHash = sha256(content);
    const recordedHash = installedState.files[HANDOFF_SKILL_FILE];
    const label = `.github/skills/${HANDOFF_SKILL_FILE}`;

    if (!fs.existsSync(targetPath)) {
      results.push({ file: label, status: classifyDrift({ recordedHash, currentHash: undefined, newHash }) });
    } else {
      const existing = fs.readFileSync(targetPath, 'utf8');
      const currentHash = sha256(existing);
      const status = classifyDrift({ recordedHash, currentHash, newHash });

      if (status === 'unchanged') {
        results.push({ file: label, status });
      } else if (status === 'safe-to-apply') {
        fs.writeFileSync(targetPath, content, 'utf8');
        installedState.files[HANDOFF_SKILL_FILE] = newHash;
        results.push({ file: label, status, diffText: diffText(HANDOFF_SKILL_FILE, existing, content) });
      } else {
        results.push({ file: label, status, diffText: diffText(HANDOFF_SKILL_FILE, existing, content) });
      }
    }
  }

  installedState.version = packManifest.version;
  writeInstalledState(repoRoot, installedState);

  return { results };
}

function walkAgentFiles(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkAgentFiles(full, out);
    } else if (entry.name.endsWith('.agent.md')) {
      out.push(full);
    }
  }
}

const FILENAME_RE = /^[.\-_a-zA-Z0-9]+\.agent\.md$/;
const LOWERCASE_HYPHEN_RE = /^[a-z0-9]+(-[a-z0-9]+)*\.agent\.md$/;

/**
 * @param {string} content
 * @returns {{ raw: string, data: Object }}
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { raw: '', data: {} };
  let data = {};
  try {
    data = yaml.load(match[1]) || {};
  } catch {
    data = {};
  }
  return { raw: match[1], data };
}

/**
 * @param {string} filePath - absolute path
 * @param {string} content
 * @param {Set<string>} knownAgentIds - filename stems (without .agent.md) of every agent file found in the repo
 * @returns {{ file: string, errors: string[], warnings: string[] }}
 */
function validateAgentFile(filePath, content, knownAgentIds) {
  const filename = path.basename(filePath);
  const errors = [];
  const warnings = [];

  if (!FILENAME_RE.test(filename) || !LOWERCASE_HYPHEN_RE.test(filename)) {
    errors.push('filename must be lowercase-with-hyphens, end in ".agent.md", and use only . - _ a-z A-Z 0-9');
  }

  if (content.length > 30000) {
    errors.push(`file is ${content.length} characters, over the 30,000-character budget`);
  }

  const { raw, data } = parseFrontmatter(content);

  const descMatch = raw.match(/^description:\s*'([^']*)'\s*$/m);
  if (!data.description) {
    errors.push('missing required "description" frontmatter field');
  } else if (!descMatch) {
    errors.push('"description" must be a single-quoted string');
  } else if (descMatch[1].length < 50 || descMatch[1].length > 150) {
    warnings.push(`"description" is ${descMatch[1].length} characters, outside the recommended 50-150 range`);
  }

  if (!('tools' in data)) {
    warnings.push('"tools" is absent — this grants access to every tool, which is usually a mistake');
  } else if (Array.isArray(data.tools) && data.tools.length === 0) {
    warnings.push('"tools" is an empty list — this disables all tools, which is usually a mistake');
  }

  if ((data.model || data.handoffs) && data.target !== 'vscode') {
    warnings.push('"model" or "handoffs" is set without target: \'vscode\' — GitHub.com\'s coding agent does not support these properties');
  }

  for (const handoff of data.handoffs || []) {
    if (handoff && handoff.agent && !knownAgentIds.has(handoff.agent)) {
      errors.push(`handoffs[].agent "${handoff.agent}" does not resolve to any agent file found in this repo — it will be silently ignored at runtime`);
    }
  }

  return { file: filePath, errors, warnings };
}

/**
 * @param {string} repoRoot
 * @returns {{ files: Array<{file: string, errors: string[], warnings: string[]}>, errorCount: number, warningCount: number }}
 */
function validate(repoRoot) {
  const paths = [];
  walkAgentFiles(repoRoot, paths);

  const knownAgentIds = new Set(paths.map((p) => path.basename(p, '.agent.md')));

  const files = paths.map((p) => {
    const content = fs.readFileSync(p, 'utf8');
    return validateAgentFile(p, content, knownAgentIds);
  });

  const errorCount = files.reduce((n, f) => n + f.errors.length, 0);
  const warningCount = files.reduce((n, f) => n + f.warnings.length, 0);

  return { files, errorCount, warningCount };
}

/**
 * @param {string} repoRoot
 * @returns {boolean} true if the handoff skill has been installed into this repo
 */
function isHandoffInstalled(repoRoot) {
  return fs.existsSync(path.join(targetSkillsDir(repoRoot), HANDOFF_SKILL_FILE));
}

module.exports = {
  PACK_DIR,
  AGENT_FILES,
  GUIDELINES_FILE,
  HANDOFF_SKILL_FILE,
  loadPackManifest,
  renderAgentFile,
  resolveModel,
  resolveTestCommandHint,
  classifyDrift,
  install,
  update,
  validate,
  validateAgentFile,
  parseFrontmatter,
  isHandoffInstalled,
};
