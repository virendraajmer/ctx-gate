'use strict';

// `ctx-gate optimize` — the Context Optimizer. Scans a target repo and
// writes/diffs AGENTS.md, .github/instructions/*.instructions.md, and
// .github/skills/*/SKILL.md, all budget-checked via tokenBudget.js and
// diffed against any existing version before writing. Every claim is
// tagged with a real evidence path (never fabricated).

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { createTwoFilesPatch } = require('diff');

const { sniffErrorHandling } = require('./standingSniffers');
const { AGENTS_MD_BUDGET, INSTRUCTIONS_BUDGET, SKILL_BUDGET, checkBudget, countTokens } = require('../tokenBudget');
const { resolveTestCommand, buildEfficiencyBlock } = require('./efficiencyBlock');

class BudgetExceededError extends Error {
  constructor(fileLabel, count, limit) {
    super(`${fileLabel} is ${count} tokens, over its ${limit}-token budget even after one split attempt.`);
    this.name = 'BudgetExceededError';
  }
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'venv', '.venv', '__pycache__', 'bin', 'obj', 'dist', 'build']);
const NAMING_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.py', '.cs']);
const NAMING_SUFFIXES = ['Service', 'Controller', 'Reducer', 'Repository'];
const MAX_NAMING_FILES_SCANNED = 400;

function walkFilenames(dir, out) {
  if (out.length >= MAX_NAMING_FILES_SCANNED) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_NAMING_FILES_SCANNED) return;
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFilenames(full, out);
    } else if (NAMING_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
}

function sniffNamingConvention(repoRoot) {
  const files = [];
  walkFilenames(repoRoot, files);

  for (const suffix of NAMING_SUFFIXES) {
    const matches = files.filter((f) => path.basename(f, path.extname(f)).endsWith(suffix));
    if (matches.length >= 2) {
      return {
        claim: `Files implementing this concern are suffixed "${suffix}" (seen in ${matches.length} files)`,
        evidence: { path: path.relative(repoRoot, matches[0]).replace(/\\/g, '/') },
      };
    }
  }
  return null;
}

function errorHandlingClaimWithEvidence(repoRoot) {
  const claim = sniffErrorHandling(repoRoot);
  if (!claim) return null;
  // sniffErrorHandling only returns the claim text; re-derive one evidence
  // file cheaply rather than duplicating its full scan/regex logic.
  const files = [];
  walkFilenames(repoRoot, files);
  const resultFile = files.find((f) => /\b(Result|Either)\s*[<[]/.test(safeRead(f)));
  const throwFile = files.find((f) => /\bthrow(?:\s+new)?\s/.test(safeRead(f)));
  const evidenceFile = claim.includes('Result/Either') ? resultFile : throwFile;
  return { claim, evidence: evidenceFile ? { path: path.relative(repoRoot, evidenceFile).replace(/\\/g, '/') } : null };
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/**
 * @param {string} repoRoot
 * @param {Object} manifest
 * @returns {Object} facts object with every claim tagged with evidence path/symbol
 */
function scanForOptimizer(repoRoot, manifest) {
  const stacks = manifest.stacks || {};
  const stacksPresent = Object.keys(stacks).filter((k) => stacks[k] && stacks[k].detected);

  const alwaysTrue = [];
  const instructionsGroups = [];
  const skillGroups = [];

  if (stacks.node && stacks.node.detected) {
    if (stacks.node.testCommand) {
      alwaysTrue.push({
        claim: `Tests run via \`${stacks.node.testCommand}\``,
        evidence: { path: 'package.json', symbol: 'scripts.test' },
      });
    }
    if (stacks.node.buildCommand) {
      alwaysTrue.push({
        claim: `Build via \`${stacks.node.buildCommand}\``,
        evidence: { path: 'package.json', symbol: 'scripts.build' },
      });
    }
  }

  const errorHandling = errorHandlingClaimWithEvidence(repoRoot);
  if (errorHandling) {
    alwaysTrue.push(errorHandling);
  }

  const naming = sniffNamingConvention(repoRoot);
  if (naming) {
    alwaysTrue.push(naming);
  }

  if (stacks.react && stacks.react.detected && (stacks.react.screens || []).length > 0) {
    instructionsGroups.push({
      id: 'react-screens',
      applyTo: 'src/**/*.{jsx,tsx}',
      title: 'React screens',
      rules: stacks.react.screens.map((s) => ({
        claim: `Screen "${s.name}" is routed at \`${s.route || '(no static route)'}\``,
        evidence: { path: s.path },
      })),
    });
    skillGroups.push({
      id: 'adding-a-screen',
      title: 'Adding a screen',
      description: `Add a new ${stacks.react.router} screen to this app`,
      rules: stacks.react.screens.slice(0, 5).map((s) => ({
        claim: `"${s.name}" lives at \`${s.path}\` and is a working example of this app's screen structure`,
        evidence: { path: s.path },
      })),
    });
  }

  const endpoints = manifest.endpoints || [];
  if (endpoints.length > 0) {
    instructionsGroups.push({
      id: 'api-endpoints',
      applyTo: stacks.dotnet && stacks.dotnet.detected ? '**/*.cs' : '**/*.py',
      title: 'API endpoints',
      rules: endpoints.map((e) => ({
        claim: `\`${e.method} ${e.route}\` is implemented here`,
        evidence: (() => {
          const [p, symbol] = e.path.split('#');
          return { path: p, symbol };
        })(),
      })),
    });
    skillGroups.push({
      id: 'adding-an-endpoint',
      title: 'Adding an endpoint',
      description: 'Add a new API endpoint to this backend',
      rules: endpoints.slice(0, 5).map((e) => ({
        claim: `\`${e.method} ${e.route}\` is a working example of this backend's endpoint structure`,
        evidence: (() => {
          const [p, symbol] = e.path.split('#');
          return { path: p, symbol };
        })(),
      })),
    });
  }

  const summary =
    stacksPresent.length > 0
      ? `This repo uses ${stacksPresent.join(', ')}. Content below was generated from real detected facts (manifest.json) and a static scan — every claim cites its evidence path.`
      : `No supported stack was detected in this repo. This file will be regenerated once a stack is detected.`;

  const efficiencyBlock = buildEfficiencyBlock({
    testCommand: resolveTestCommand(stacks),
    stacksPresent,
  });

  return { stacksPresent, summary, efficiencyBlock, alwaysTrue, instructionsGroups, skillGroups };
}

function formatEvidence(evidence) {
  if (!evidence) return '';
  return evidence.symbol ? ` (${evidence.path}#${evidence.symbol})` : ` (${evidence.path})`;
}

/**
 * @param {Object} facts
 * @param {Object} [opts] - { maxBullets } used internally by optimize() for the one-split-attempt path
 * @returns {string} AGENTS.md content
 */
function renderAgentsMd(facts, opts = {}) {
  const bullets = opts.maxBullets != null ? facts.alwaysTrue.slice(0, opts.maxBullets) : facts.alwaysTrue;
  const lines = ['# AGENTS.md', '', facts.summary, '', facts.efficiencyBlock, ''];

  if (bullets.length > 0) {
    lines.push('## Always true', '');
    for (const b of bullets) {
      lines.push(`- ${b.claim}${formatEvidence(b.evidence)}`);
    }
    lines.push('');
  }

  if (facts.instructionsGroups.length > 0 || facts.skillGroups.length > 0) {
    lines.push('## Routing', '');
    for (const g of facts.instructionsGroups) {
      lines.push(`- ${g.title} conventions: \`.github/instructions/${g.id}.instructions.md\``);
    }
    for (const g of facts.skillGroups) {
      lines.push(`- ${g.title}: \`.github/skills/${g.id}/SKILL.md\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * @param {Object} facts
 * @returns {Array<{filename: string, frontmatter: Object, body: string}>}
 */
function renderInstructionsFiles(facts) {
  return facts.instructionsGroups.map((g) => ({
    filename: `${g.id}.instructions.md`,
    frontmatter: { applyTo: g.applyTo },
    body: [`# ${g.title}`, '', ...g.rules.map((r) => `- ${r.claim}${formatEvidence(r.evidence)}`), ''].join('\n'),
  }));
}

/**
 * @param {Object} facts
 * @returns {Array<{dirName: string, body: string}>}
 */
function renderSkillFiles(facts) {
  return facts.skillGroups.map((g) => ({
    dirName: g.id,
    body: [
      '---',
      `name: ${g.id}`,
      `description: ${g.description}`,
      '---',
      '',
      `# ${g.title}`,
      '',
      ...g.rules.map((r) => `- ${r.claim}${formatEvidence(r.evidence)}`),
      '',
    ].join('\n'),
  }));
}

function assembleInstructionsFile(file) {
  return `---\n${yaml.dump(file.frontmatter)}---\n\n${file.body}`;
}

function splitGroupInHalf(group) {
  const mid = Math.ceil(group.rules.length / 2);
  return [
    { ...group, id: `${group.id}-1`, rules: group.rules.slice(0, mid) },
    { ...group, id: `${group.id}-2`, rules: group.rules.slice(mid) },
  ];
}

function budgetedInstructionsFiles(facts) {
  const out = [];
  for (const group of facts.instructionsGroups) {
    let files = renderInstructionsFiles({ instructionsGroups: [group] });
    let over = files.find((f) => !checkBudget(assembleInstructionsFile(f), INSTRUCTIONS_BUDGET).ok);
    if (over && group.rules.length > 1) {
      const halves = splitGroupInHalf(group);
      files = renderInstructionsFiles({ instructionsGroups: halves });
      over = files.find((f) => !checkBudget(assembleInstructionsFile(f), INSTRUCTIONS_BUDGET).ok);
    }
    if (over) {
      const { count } = checkBudget(assembleInstructionsFile(over), INSTRUCTIONS_BUDGET);
      throw new BudgetExceededError(`.github/instructions/${over.filename}`, count, INSTRUCTIONS_BUDGET);
    }
    out.push(...files);
  }
  return out;
}

function budgetedSkillFiles(facts) {
  const out = [];
  for (const group of facts.skillGroups) {
    let files = renderSkillFiles({ skillGroups: [group] });
    let over = files.find((f) => !checkBudget(f.body, SKILL_BUDGET).ok);
    if (over && group.rules.length > 1) {
      const halves = splitGroupInHalf(group);
      files = renderSkillFiles({ skillGroups: halves });
      over = files.find((f) => !checkBudget(f.body, SKILL_BUDGET).ok);
    }
    if (over) {
      const { count } = checkBudget(over.body, SKILL_BUDGET);
      throw new BudgetExceededError(`.github/skills/${over.dirName}/SKILL.md`, count, SKILL_BUDGET);
    }
    out.push(...files);
  }
  return out;
}

function budgetedAgentsMd(facts) {
  let bulletCount = facts.alwaysTrue.length;
  let content = renderAgentsMd(facts, { maxBullets: bulletCount });
  let result = checkBudget(content, AGENTS_MD_BUDGET);
  if (result.ok) return content;

  // One split attempt: progressively drop always-true bullets (their
  // detail already lives in the instructions/skill files routed to below).
  // The fixed efficiency block is never trimmed to make room.
  while (bulletCount > 0 && !result.ok) {
    bulletCount -= 1;
    content = renderAgentsMd(facts, { maxBullets: bulletCount });
    result = checkBudget(content, AGENTS_MD_BUDGET);
  }
  if (!result.ok) {
    throw new BudgetExceededError('AGENTS.md', result.count, AGENTS_MD_BUDGET);
  }
  return content;
}

/**
 * @param {string} targetPath
 * @param {string} newContent
 * @returns {{ changed: boolean, diffText: string }}
 */
function diffAgainstExisting(targetPath, newContent) {
  const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
  if (existing === newContent) {
    return { changed: false, diffText: '' };
  }
  const diffText = createTwoFilesPatch(
    path.basename(targetPath),
    path.basename(targetPath),
    existing,
    newContent,
    'existing',
    'proposed'
  );
  return { changed: true, diffText };
}

/**
 * @param {string} repoRoot
 * @param {Object} [opts] - { write: boolean }
 * @returns {Promise<{ agentsMd: string, instructionsFiles: Array, skillFiles: Array, diffs: Array<{path: string, changed: boolean, diffText: string}> }>}
 */
async function optimize(repoRoot, opts = {}) {
  const store = require('../memory/store');
  const manifest = store.readManifest(repoRoot);
  const facts = scanForOptimizer(repoRoot, manifest);

  const agentsMd = budgetedAgentsMd(facts);
  const instructionsFiles = budgetedInstructionsFiles(facts);
  const skillFiles = budgetedSkillFiles(facts);
  const efficiencyBlockTokens = countTokens(facts.efficiencyBlock);

  const diffs = [];

  const agentsPath = path.join(repoRoot, 'AGENTS.md');
  const agentsDiff = diffAgainstExisting(agentsPath, agentsMd);
  diffs.push({ path: 'AGENTS.md', ...agentsDiff });
  if (opts.write && agentsDiff.changed) {
    fs.writeFileSync(agentsPath, agentsMd, 'utf8');
  }

  for (const file of instructionsFiles) {
    const rel = path.join('.github', 'instructions', file.filename);
    const full = path.join(repoRoot, rel);
    const content = assembleInstructionsFile(file);
    const d = diffAgainstExisting(full, content);
    diffs.push({ path: rel.replace(/\\/g, '/'), ...d });
    if (opts.write && d.changed) {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }
  }

  for (const file of skillFiles) {
    const rel = path.join('.github', 'skills', file.dirName, 'SKILL.md');
    const full = path.join(repoRoot, rel);
    const d = diffAgainstExisting(full, file.body);
    diffs.push({ path: rel.replace(/\\/g, '/'), ...d });
    if (opts.write && d.changed) {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, file.body, 'utf8');
    }
  }

  return { agentsMd, instructionsFiles, skillFiles, diffs, efficiencyBlockTokens };
}

module.exports = {
  BudgetExceededError,
  scanForOptimizer,
  renderAgentsMd,
  renderInstructionsFiles,
  renderSkillFiles,
  diffAgainstExisting,
  optimize,
};
