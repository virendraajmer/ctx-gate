'use strict';

// Canonical shapes for manifest.json / standing.yml / learned.yml /
// features.yml / config.yml / config.local.yml. Referenced by store.js
// and by every module that reads or writes these files, so the shape
// only needs to change in one place.

const MANIFEST_SCHEMA_VERSION = 1;

const STANDING_SLOTS = [
  'acceptance', // "done-means"
  'riskPaths', // "high-risk-paths"
  'errorHandling',
  'naming',
  'performance',
  'logging',
];

const STANDING_STATUS = ['confirmed', 'detected', 'default'];

const ENFORCEMENT_LEVELS = ['off', 'warn', 'block'];

/**
 * @returns {Object} an empty manifest.json shape with every stack key present
 */
function emptyManifest() {
  return {
    $schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    ctxGateVersion: require('../../package.json').version,
    stacks: {
      node: { detected: false },
      react: { detected: false },
      python: { detected: false },
      dotnet: { detected: false },
    },
    endpoints: [],
  };
}

/**
 * @returns {Object} default config.yml shape
 */
function defaultTeamConfig() {
  return {
    version: 1,
    enforcement: 'off',
    adapters: { active: 'copilot' },
  };
}

/**
 * @returns {Object} default config.local.yml shape
 */
function defaultLocalConfig() {
  return {
    version: 1,
    enforcement: 'off',
  };
}

/**
 * @returns {Object} an empty standing.yml shape
 */
function emptyStanding() {
  return { version: 1, entries: [] };
}

/**
 * @returns {Object} an empty features.yml shape
 */
function emptyFeatures() {
  return { version: 1, mappings: [] };
}

/**
 * @returns {Object} an empty learned.yml shape
 */
function emptyLearned() {
  return { version: 1, patterns: [] };
}

module.exports = {
  MANIFEST_SCHEMA_VERSION,
  STANDING_SLOTS,
  STANDING_STATUS,
  ENFORCEMENT_LEVELS,
  emptyManifest,
  defaultTeamConfig,
  defaultLocalConfig,
  emptyStanding,
  emptyFeatures,
  emptyLearned,
};
