'use strict';

// Heuristic, best-effort sniffers used to pre-fill (or skip) standing
// question defaults during `ctx-gate init`. Never fabricate: return null /
// empty when there's no real signal, rather than guessing.

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'venv', '.venv', '__pycache__', 'bin', 'obj', 'dist', 'build',
]);
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.py', '.cs']);
const MAX_FILES_SCANNED = 400;

function walkSourceFiles(dir, out) {
  if (out.length >= MAX_FILES_SCANNED) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES_SCANNED) return;
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(full, out);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
}

/**
 * Heuristically sniffs whether the codebase favors a Result/Either return
 * type or bare `throw` for error handling, by counting occurrences of each
 * pattern across source files. Returns a human-readable description to use
 * as a suggested default, or null if there's no signal either way.
 *
 * @param {string} repoRoot
 * @returns {string|null}
 */
function sniffErrorHandling(repoRoot) {
  const files = [];
  walkSourceFiles(repoRoot, files);

  let resultCount = 0;
  let throwCount = 0;
  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    resultCount += (content.match(/\b(Result|Either)\s*[<[]/g) || []).length;
    throwCount += (content.match(/\bthrow(?:\s+new)?\s/g) || []).length;
  }

  if (resultCount === 0 && throwCount === 0) {
    return null;
  }
  if (resultCount >= throwCount) {
    return 'Services return a Result/Either type rather than throwing exceptions';
  }
  return 'Services throw exceptions';
}

/**
 * Derives a suggested high-risk-paths list from a CODEOWNERS file, if one
 * exists at a conventional location. Never fabricated — returns an empty
 * array when no CODEOWNERS file is found.
 *
 * @param {string} repoRoot
 * @returns {string[]}
 */
function deriveRiskPathsFromCodeowners(repoRoot) {
  const candidates = [
    path.join(repoRoot, 'CODEOWNERS'),
    path.join(repoRoot, '.github', 'CODEOWNERS'),
    path.join(repoRoot, 'docs', 'CODEOWNERS'),
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) {
    return [];
  }
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const paths = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [pattern] = trimmed.split(/\s+/);
    if (pattern) paths.push(pattern);
  }
  return [...new Set(paths)];
}

module.exports = { sniffErrorHandling, deriveRiskPathsFromCodeowners };
