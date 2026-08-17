'use strict';

const fs = require('fs');
const path = require('path');

const LINT_CONFIG_CANDIDATES = [
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
];

/**
 * Detect Node.js project facts from a repo root. Pure function: reads
 * files under repoRoot, no writes, no side effects.
 *
 * @param {string} repoRoot
 * @returns {Object|null} NodeFacts, or null if no package.json found
 */
function lockfileAt(dir) {
  if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml')) || fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) {
    return 'yarn';
  }
  if (fs.existsSync(path.join(dir, 'package-lock.json'))) {
    return 'npm';
  }
  return null;
}

// Walks up from repoRoot looking for a lockfile / pnpm-workspace.yaml, since
// a package inside a monorepo workspace (e.g. apps/player/package.json)
// usually has neither its own lockfile nor a `packageManager` field — only
// the workspace root does.
function findUpwardPackageManager(startDir) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const found = lockfileAt(dir);
    if (found) return found;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function detectNode(repoRoot) {
  const pkgPath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return null;
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  let packageManager;
  if (typeof pkg.packageManager === 'string') {
    packageManager = pkg.packageManager.split('@')[0];
  } else {
    packageManager = lockfileAt(repoRoot) || findUpwardPackageManager(path.dirname(repoRoot));
  }
  packageManager = packageManager || 'npm';

  const scripts = pkg.scripts || {};
  const lintConfig =
    LINT_CONFIG_CANDIDATES.find((f) => fs.existsSync(path.join(repoRoot, f))) || null;

  const dependencies = Object.keys({
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  }).sort();

  return {
    detected: true,
    packageManager,
    testCommand: scripts.test || null,
    buildCommand: scripts.build || null,
    lintConfig,
    dependencies,
  };
}

module.exports = { detectNode };
