'use strict';

// All local file I/O for .context-ops/. Every read/write helper here is
// the single place that touches disk for manifest/standing/learned/
// features/config — core modules receive already-loaded objects as
// `deps` and never call fs directly themselves.

const fs = require('fs');
const path = require('path');

function contextOpsDir(repoRoot) {
  return path.join(repoRoot, '.context-ops');
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

/** @param {string} repoRoot @returns {Object} */
function readStanding(repoRoot) {
  throw new Error('not implemented');
}

/** @param {string} repoRoot @param {Object} standing */
function writeStanding(repoRoot, standing) {
  throw new Error('not implemented');
}

/** @param {string} repoRoot @returns {Object} */
function readLearned(repoRoot) {
  throw new Error('not implemented');
}

/** @param {string} repoRoot @param {Object} learned */
function writeLearned(repoRoot, learned) {
  throw new Error('not implemented');
}

/** @param {string} repoRoot @returns {Object} */
function readFeatures(repoRoot) {
  throw new Error('not implemented');
}

/** @param {string} repoRoot @param {Object} features */
function writeFeatures(repoRoot, features) {
  throw new Error('not implemented');
}

/**
 * Reads config.yml (team) and config.local.yml (personal, optional) and
 * validates the local override never claims a level below the team
 * level (see src/core/enforce.js#assertNoDowngrade).
 *
 * @param {string} repoRoot
 * @returns {{ team: Object, local: Object|null }}
 */
function readConfig(repoRoot) {
  throw new Error('not implemented');
}

/** @param {string} repoRoot @param {Object} config */
function writeTeamConfig(repoRoot, config) {
  throw new Error('not implemented');
}

/** @param {string} repoRoot @param {Object} config */
function writeLocalConfig(repoRoot, config) {
  throw new Error('not implemented');
}

/**
 * Append-only JSONL write, no read-modify-write race.
 *
 * @param {string} repoRoot
 * @param {Object} entry
 */
function appendAnswerLine(repoRoot, entry) {
  throw new Error('not implemented');
}

/** @param {string} repoRoot @returns {Object[]} */
function readAnswersLog(repoRoot) {
  throw new Error('not implemented');
}

/** @param {string} repoRoot @returns {Object} */
function readSessionCache(repoRoot) {
  throw new Error('not implemented');
}

/** @param {string} repoRoot @param {Object} cache */
function writeSessionCache(repoRoot, cache) {
  throw new Error('not implemented');
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
  appendAnswerLine,
  readAnswersLog,
  readSessionCache,
  writeSessionCache,
};
