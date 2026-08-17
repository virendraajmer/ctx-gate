'use strict';

// `ctx-gate optimize` — the Context Optimizer. Scans a target repo and
// writes/diffs AGENTS.md, .github/instructions/*.instructions.md, and
// .github/skills/*/SKILL.md, all budget-checked via tokenBudget.js and
// diffed against any existing version before writing.

/**
 * @param {string} repoRoot
 * @param {Object} manifest
 * @returns {Object} facts object with every claim tagged with evidence path/symbol
 */
function scanForOptimizer(repoRoot, manifest) {
  throw new Error('not implemented');
}

/**
 * @param {Object} facts
 * @returns {string} AGENTS.md content
 */
function renderAgentsMd(facts) {
  throw new Error('not implemented');
}

/**
 * @param {Object} facts
 * @returns {Array<{filename: string, frontmatter: Object, body: string}>}
 */
function renderInstructionsFiles(facts) {
  throw new Error('not implemented');
}

/**
 * @param {Object} facts
 * @returns {Array<{dirName: string, body: string}>}
 */
function renderSkillFiles(facts) {
  throw new Error('not implemented');
}

/**
 * @param {string} targetPath
 * @param {string} newContent
 * @returns {{ changed: boolean, diffText: string }}
 */
function diffAgainstExisting(targetPath, newContent) {
  throw new Error('not implemented');
}

/**
 * @param {string} repoRoot
 * @param {Object} [opts] - { write: boolean }
 * @returns {Promise<void>}
 */
async function optimize(repoRoot, opts = {}) {
  throw new Error('not implemented');
}

module.exports = {
  scanForOptimizer,
  renderAgentsMd,
  renderInstructionsFiles,
  renderSkillFiles,
  diffAgainstExisting,
  optimize,
};
