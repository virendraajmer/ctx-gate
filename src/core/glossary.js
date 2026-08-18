'use strict';

// `ctx-gate glossary` — glossary.yml is the single source of truth for this
// repo's shared vocabulary (see src/memory/schema.js#emptyGlossary and
// src/memory/store.js#readGlossary/writeGlossary). It replaces features.yml
// entirely: `definition` renders into CONTEXT.md (src/core/optimize.js),
// `paths` is read directly by src/core/gate.js to resolve a vague request
// locally without ever being sent to a model. Zero LLM calls anywhere here.

const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');

const MAX_INIT_DEFINITION_PROMPTS = 8;
const SKIP_DIRS = new Set(['node_modules', '.git', 'venv', '.venv', '__pycache__', 'bin', 'obj', 'dist', 'build']);
const SKIP_TOP_LEVEL_MODULES = new Set(['utils', 'lib', 'libs', 'common', 'shared', 'test', 'tests', '__tests__', 'assets', 'public']);
const NAMING_SUFFIXES = ['Service', 'Controller', 'Reducer', 'Repository'];
const MAX_FILES_SCANNED = 400;

function resolveStreams(streams) {
  return {
    input: (streams && streams.input) || process.stdin,
    output: (streams && streams.output) || process.stdout,
  };
}

function walkFiles(dir, out, exts) {
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
      walkFiles(full, out, exts);
    } else if (!exts || exts.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
}

function addCandidate(byTerm, term, filePath, repoRoot) {
  if (!term) return;
  const key = term.toLowerCase();
  const rel = filePath ? path.relative(repoRoot, filePath).replace(/\\/g, '/') : null;
  const existing = byTerm.get(key);
  if (existing) {
    existing.occurrences += 1;
    if (rel && !existing.paths.includes(rel)) existing.paths.push(rel);
  } else {
    byTerm.set(key, { term, paths: rel ? [rel] : [], occurrences: 1 });
  }
}

/**
 * Derives `candidate` glossary terms from what the detectors already found
 * — screen names, endpoint route segments, top-level module folders, and
 * Service/Controller/Reducer/Repository-suffixed files — for `ctx-gate
 * init` to seed glossary.yml with, prioritised by how often each term
 * appears. Pure read-only scan, no writes.
 *
 * @param {string} repoRoot
 * @param {Object} manifest
 * @returns {Array<{term: string, paths: string[], occurrences: number}>} sorted by occurrences desc
 */
function seedCandidateTerms(repoRoot, manifest) {
  const byTerm = new Map();
  const stacks = (manifest && manifest.stacks) || {};

  const screens = (stacks.react && stacks.react.screens) || [];
  for (const s of screens) {
    if (s.name) addCandidate(byTerm, s.name, path.join(repoRoot, s.path), repoRoot);
  }

  const endpoints = (manifest && manifest.endpoints) || [];
  const GENERIC_ROUTE_SEGMENTS = new Set(['api', 'v1', 'v2', 'index']);
  for (const e of endpoints) {
    const [pOnly] = (e.path || '').split('#');
    const segments = (e.route || '').split('/').filter(Boolean).filter((s) => !GENERIC_ROUTE_SEGMENTS.has(s.toLowerCase()));
    const term = segments[segments.length - 1];
    if (term) addCandidate(byTerm, term, pOnly ? path.join(repoRoot, pOnly) : null, repoRoot);
  }

  for (const srcRoot of [path.join(repoRoot, 'src'), repoRoot]) {
    if (!fs.existsSync(srcRoot)) continue;
    let entries;
    try {
      entries = fs.readdirSync(srcRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name) || SKIP_TOP_LEVEL_MODULES.has(entry.name.toLowerCase())) continue;
      const dirPath = path.join(srcRoot, entry.name);
      const files = [];
      walkFiles(dirPath, files);
      if (files.length > 0) {
        addCandidate(byTerm, entry.name, dirPath, repoRoot);
      }
    }
    break; // prefer src/ when present, else repo root, never both
  }

  const namingFiles = [];
  walkFiles(repoRoot, namingFiles, new Set(['.js', '.jsx', '.ts', '.tsx', '.py', '.cs']));
  for (const f of namingFiles) {
    const base = path.basename(f, path.extname(f));
    for (const suffix of NAMING_SUFFIXES) {
      if (base.endsWith(suffix) && base.length > suffix.length) {
        addCandidate(byTerm, base, f, repoRoot);
        break;
      }
    }
  }

  return [...byTerm.values()].sort((a, b) => b.occurrences - a.occurrences || a.term.localeCompare(b.term));
}

/**
 * Asks the developer to define at most `MAX_INIT_DEFINITION_PROMPTS` of the
 * seeded candidates, prioritised by occurrence count. Every candidate is
 * written to glossary.yml regardless — the top ones just get a chance at a
 * definition during init; the rest fill in over time.
 *
 * @param {Array<{term: string, paths: string[], occurrences: number}>} candidates
 * @param {{ input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream }} [streams]
 * @returns {Promise<Object[]>} glossary.yml `terms` entries
 */
async function buildGlossaryTermsFromCandidates(candidates, streams) {
  const { input, output } = resolveStreams(streams);
  const rl = readline.createInterface({ input, output, terminal: false });
  const now = new Date().toISOString();
  const entries = [];
  try {
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (i < MAX_INIT_DEFINITION_PROMPTS) {
        const locationHint = c.paths.length > 0 ? ` (found at ${c.paths.slice(0, 2).join(', ')})` : '';
        const raw = (await rl.question(`Define "${c.term}"?${locationHint} [blank to skip]\n> `)).trim();
        entries.push({
          term: c.term,
          aka: [],
          definition: raw,
          paths: c.paths,
          status: raw ? 'confirmed' : 'candidate',
          hits: 0,
          last_used: now,
        });
      } else {
        entries.push({ term: c.term, aka: [], definition: '', paths: c.paths, status: 'candidate', hits: 0, last_used: now });
      }
    }
  } finally {
    rl.close();
  }
  return entries;
}

/**
 * Collects every file/directory basename in the repo (lowercased, extension
 * stripped), capped at MAX_FILES_SCANNED, for the undefined-jargon detector
 * in src/core/gate.js to check a candidate term against before counting it
 * as unknown. Impure (walks disk) — kept out of gate.js, which stays pure.
 *
 * @param {string} repoRoot
 * @returns {Set<string>}
 */
function collectRepoSymbolNames(repoRoot) {
  const files = [];
  walkFiles(repoRoot, files);
  const names = new Set();
  for (const f of files) {
    names.add(path.basename(f, path.extname(f)).toLowerCase());
    names.add(path.basename(path.dirname(f)).toLowerCase());
  }
  return names;
}

/**
 * @param {string} repoRoot
 * @param {string} term
 * @param {string} definition
 * @param {{ paths?: string[], aka?: string[] }} [opts]
 * @returns {Object} the upserted entry
 */
function addTerm(repoRoot, term, definition, opts = {}) {
  const store = require('../memory/store');
  const { emptyGlossary } = require('../memory/schema');
  const glossary = store.readGlossary(repoRoot) || emptyGlossary();
  const now = new Date().toISOString();
  const existing = glossary.terms.find((t) => t.term.toLowerCase() === term.toLowerCase());

  if (existing) {
    existing.definition = definition;
    existing.status = 'confirmed';
    if (opts.paths) existing.paths = [...new Set([...(existing.paths || []), ...opts.paths])];
    if (opts.aka) existing.aka = [...new Set([...(existing.aka || []), ...opts.aka])];
    existing.last_used = now;
  } else {
    glossary.terms.push({
      term,
      aka: opts.aka || [],
      definition,
      paths: opts.paths || [],
      status: 'confirmed',
      hits: 0,
      last_used: now,
    });
  }

  store.writeGlossary(repoRoot, glossary);
  return glossary.terms.find((t) => t.term.toLowerCase() === term.toLowerCase());
}

/**
 * @param {string} repoRoot
 * @returns {Object[]} glossary.yml terms, empty array if glossary.yml doesn't exist yet
 */
function listTerms(repoRoot) {
  const store = require('../memory/store');
  const glossary = store.readGlossary(repoRoot);
  return (glossary && glossary.terms) || [];
}

/**
 * Manual review, following the same never-auto-delete convention as
 * src/core/review.js: surfaces `candidate` terms (need a definition or
 * deletion) and unknown-terms.json entries that crossed the surfacing
 * threshold but have no glossary entry yet at all.
 *
 * @param {string} repoRoot
 * @returns {{ candidateTerms: Object[], unresolvedUnknownTerms: Array<{term: string, sessions: number}> }}
 */
function reviewTerms(repoRoot) {
  const store = require('../memory/store');
  const { UNKNOWN_TERM_SESSION_THRESHOLD } = require('./gate');
  const glossary = store.readGlossary(repoRoot);
  const terms = (glossary && glossary.terms) || [];
  const candidateTerms = terms.filter((t) => t.status === 'candidate');

  const knownLower = new Set(terms.map((t) => t.term.toLowerCase()));
  const unknownTermsState = store.readUnknownTerms(repoRoot);
  const unresolvedUnknownTerms = Object.values(unknownTermsState)
    .filter((e) => (e.sessions || []).length >= UNKNOWN_TERM_SESSION_THRESHOLD && !knownLower.has(e.term.toLowerCase()))
    .map((e) => ({ term: e.term, sessions: e.sessions.length }));

  return { candidateTerms, unresolvedUnknownTerms };
}

module.exports = {
  MAX_INIT_DEFINITION_PROMPTS,
  seedCandidateTerms,
  buildGlossaryTermsFromCandidates,
  collectRepoSymbolNames,
  addTerm,
  listTerms,
  reviewTerms,
};
