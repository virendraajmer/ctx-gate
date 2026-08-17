'use strict';

// All local file I/O for .context-ops/. Every read/write helper here is
// the single place that touches disk for manifest/standing/learned/
// features/config — core modules receive already-loaded objects as
// `deps` and never call fs directly themselves.

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function contextOpsDir(repoRoot) {
  return path.join(repoRoot, '.context-ops');
}

function memoryDir(repoRoot) {
  return path.join(contextOpsDir(repoRoot), 'memory');
}

/** @param {string} repoRoot @returns {Object} */
function readManifest(repoRoot) {
  const p = path.join(contextOpsDir(repoRoot), 'manifest.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** @param {string} repoRoot @param {Object} manifest */
function writeManifest(repoRoot, manifest) {
  const dir = contextOpsDir(repoRoot);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

/**
 * @param {string} repoRoot
 * @returns {Object|null} the parsed standing.yml, or null if it doesn't exist yet
 */
function readStanding(repoRoot) {
  const p = path.join(memoryDir(repoRoot), 'standing.yml');
  if (!fs.existsSync(p)) {
    return null;
  }
  return yaml.load(fs.readFileSync(p, 'utf8'));
}

/** @param {string} repoRoot @param {Object} standing */
function writeStanding(repoRoot, standing) {
  const dir = memoryDir(repoRoot);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'standing.yml'), yaml.dump(standing), 'utf8');
}

/**
 * @param {string} repoRoot
 * @returns {Object|null} the parsed learned.yml, or null if it doesn't exist yet
 */
function readLearned(repoRoot) {
  const p = path.join(memoryDir(repoRoot), 'learned.yml');
  if (!fs.existsSync(p)) {
    return null;
  }
  return yaml.load(fs.readFileSync(p, 'utf8'));
}

/** @param {string} repoRoot @param {Object} learned */
function writeLearned(repoRoot, learned) {
  const dir = memoryDir(repoRoot);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'learned.yml'), yaml.dump(learned), 'utf8');
}

/**
 * @param {string} repoRoot
 * @returns {Object|null} the parsed features.yml, or null if it doesn't exist yet
 */
function readFeatures(repoRoot) {
  const p = path.join(memoryDir(repoRoot), 'features.yml');
  if (!fs.existsSync(p)) {
    return null;
  }
  return yaml.load(fs.readFileSync(p, 'utf8'));
}

/** @param {string} repoRoot @param {Object} features */
function writeFeatures(repoRoot, features) {
  const dir = memoryDir(repoRoot);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'features.yml'), yaml.dump(features), 'utf8');
}

/**
 * Reads config.yml (team) and config.local.yml (personal, optional).
 * Purely loads raw file contents — downgrade validation is the caller's
 * job (see src/core/enforce.js#assertNoDowngrade), kept out of this I/O
 * layer so store.js never depends on core.
 *
 * @param {string} repoRoot
 * @returns {{ team: Object|null, local: Object|null }}
 */
function readConfig(repoRoot) {
  const teamPath = path.join(contextOpsDir(repoRoot), 'config.yml');
  const localPath = path.join(contextOpsDir(repoRoot), 'config.local.yml');
  return {
    team: fs.existsSync(teamPath) ? yaml.load(fs.readFileSync(teamPath, 'utf8')) : null,
    local: fs.existsSync(localPath) ? yaml.load(fs.readFileSync(localPath, 'utf8')) : null,
  };
}

/** @param {string} repoRoot @param {Object} config */
function writeTeamConfig(repoRoot, config) {
  const dir = contextOpsDir(repoRoot);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.yml'), yaml.dump(config), 'utf8');
}

/** @param {string} repoRoot @param {Object} config */
function writeLocalConfig(repoRoot, config) {
  const dir = contextOpsDir(repoRoot);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.local.yml'), yaml.dump(config), 'utf8');
}

/**
 * Idempotently appends any of the given lines that aren't already present
 * in the target repo's .gitignore, creating the file if it doesn't exist.
 *
 * @param {string} repoRoot
 * @param {string[]} entries
 */
function ensureGitignoreEntries(repoRoot, entries) {
  const p = path.join(repoRoot, '.gitignore');
  const existing = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  const existingLines = new Set(existing.split('\n').map((l) => l.trim()));
  const missing = entries.filter((e) => !existingLines.has(e));
  if (missing.length === 0) {
    return;
  }
  const sep = existing && !existing.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(p, `${existing}${sep}${missing.join('\n')}\n`, 'utf8');
}

/**
 * Append-only JSONL write, no read-modify-write race.
 *
 * @param {string} repoRoot
 * @param {Object} entry
 */
function appendAnswerLine(repoRoot, entry) {
  const dir = memoryDir(repoRoot);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'answers.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8');
}

/** @param {string} repoRoot @returns {Object[]} */
function readAnswersLog(repoRoot) {
  const p = path.join(memoryDir(repoRoot), 'answers.jsonl');
  if (!fs.existsSync(p)) {
    return [];
  }
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function logsDir(repoRoot) {
  return path.join(contextOpsDir(repoRoot), 'logs');
}

/**
 * Ephemeral, gitignored per-session snapshot (see src/core/gate.js) —
 * reused by learn.js and enforce.js since hooks fire as separate
 * short-lived processes with no shared memory between them.
 *
 * @param {string} repoRoot
 * @returns {Object} keyed by sessionId, {} if the cache doesn't exist yet
 */
function readSessionCache(repoRoot) {
  const p = path.join(logsDir(repoRoot), 'session-cache.json');
  if (!fs.existsSync(p)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

/** @param {string} repoRoot @param {Object} cache */
function writeSessionCache(repoRoot, cache) {
  const dir = logsDir(repoRoot);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'session-cache.json'), JSON.stringify(cache, null, 2), 'utf8');
}

module.exports = {
  readManifest,
  writeManifest,
  readStanding,
  writeStanding,
  readLearned,
  writeLearned,
  readFeatures,
  writeFeatures,
  readConfig,
  writeTeamConfig,
  writeLocalConfig,
  ensureGitignoreEntries,
  appendAnswerLine,
  readAnswersLog,
  readSessionCache,
  writeSessionCache,
};
