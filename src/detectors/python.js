'use strict';

const fs = require('fs');
const path = require('path');

const MANIFEST_FILES = ['requirements.txt', 'pyproject.toml', 'Pipfile'];
const ROUTE_DECORATOR_RE = /@(?:app|router)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/;
const FUNC_DEF_RE = /^\s*(?:async\s+)?def\s+(\w+)\s*\(/;

function walk(dir, exts, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'venv' ||
      entry.name === '.venv' ||
      entry.name === '__pycache__' ||
      entry.name.startsWith('.')
    ) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, exts, out);
    } else if (exts.includes(path.extname(entry.name))) {
      out.push(full);
    }
  }
}

function detectFramework(manifestText) {
  const lower = manifestText.toLowerCase();
  if (lower.includes('fastapi')) return 'fastapi';
  if (lower.includes('django')) return 'django';
  if (lower.includes('flask')) return 'flask';
  return null;
}

function detectFastapiEndpoints(repoRoot) {
  const endpoints = [];
  const files = [];
  walk(repoRoot, ['.py'], files);
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = ROUTE_DECORATOR_RE.exec(lines[i]);
      if (!m) continue;
      let symbol = null;
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const fm = FUNC_DEF_RE.exec(lines[j]);
        if (fm) {
          symbol = fm[1];
          break;
        }
      }
      endpoints.push({
        method: m[1].toUpperCase(),
        route: m[2],
        path: path.relative(repoRoot, f).replace(/\\/g, '/') + (symbol ? `#${symbol}` : ''),
        confidence: symbol ? 'high' : 'low',
        source: 'fastapi',
      });
    }
  }
  return endpoints;
}

/**
 * Detect Python project facts from a repo root. Pure function.
 *
 * @param {string} repoRoot
 * @returns {Object|null} PythonFacts, or null if no requirements.txt /
 *   pyproject.toml / Pipfile found
 */
function detectPython(repoRoot) {
  const present = MANIFEST_FILES.filter((f) => fs.existsSync(path.join(repoRoot, f)));
  if (present.length === 0) {
    return null;
  }

  const manifestText = present
    .map((f) => fs.readFileSync(path.join(repoRoot, f), 'utf8'))
    .join('\n');
  const framework = detectFramework(manifestText);

  const endpoints = framework === 'fastapi' ? detectFastapiEndpoints(repoRoot) : [];

  return { detected: true, framework, endpoints };
}

module.exports = { detectPython };
