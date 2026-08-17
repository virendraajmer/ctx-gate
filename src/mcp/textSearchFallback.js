'use strict';

// Plain-text search over tracked files, used automatically by gate.js
// whenever codebase-memory-mcp isn't available. Same call shape as
// codebaseMemoryClient.searchCode so gate.js doesn't need to branch.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MAX_FILES_SCANNED = 500;
const MAX_MATCHES = 20;
const MAX_SYMBOL_LENGTH = 120;

function listTrackedFiles(repoRoot) {
  try {
    const out = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * @param {string} repoRoot
 * @param {string} query
 * @returns {Promise<Array<{ symbol: string, path: string, kind: string }>>}
 */
async function searchCode(repoRoot, query) {
  const needle = (query || '').trim().toLowerCase();
  if (!needle) {
    return [];
  }

  const files = listTrackedFiles(repoRoot).slice(0, MAX_FILES_SCANNED);
  const matches = [];

  for (const file of files) {
    if (matches.length >= MAX_MATCHES) break;
    let content;
    try {
      content = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.toLowerCase().includes(needle)) {
        matches.push({ symbol: line.trim().slice(0, MAX_SYMBOL_LENGTH), path: file, kind: 'text-match' });
        if (matches.length >= MAX_MATCHES) break;
      }
    }
  }

  return matches;
}

module.exports = { searchCode };
