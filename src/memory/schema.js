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

// Session cost-warning thresholds (see src/core/gate.js#estimateSessionCost).
// These are heuristic cost-score units (turns weighted + bytes-read
// weighted), not measured token counts.
const DEFAULT_SESSION_WARN_AT = 6000;
const DEFAULT_SESSION_WARN_HARD_AT = 15000;

// Falls back to agent-pack/pack.json#defaultModel at write time; duplicated
// here as a schema-level default only so defaultTeamConfig() has no
// circular dependency on src/core/agentPack.js.
const DEFAULT_AGENT_PACK_MODEL = 'Claude Sonnet 4.5';

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
    sessionWarnAt: DEFAULT_SESSION_WARN_AT,
    sessionWarnHardAt: DEFAULT_SESSION_WARN_HARD_AT,
    sessionWarnings: true,
    agentPack: { model: DEFAULT_AGENT_PACK_MODEL, commitArtifacts: false },
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

/**
 * @param {string} sessionId
 * @param {string} timestamp - ISO 8601
 * @returns {Object} an empty .context-ops/state/<sessionId>.json shape
 */
function emptySessionState(sessionId, timestamp) {
  return {
    sessionId,
    turnCount: 0,
    filesRead: [],
    fileReadCounts: {},
    estimatedBytesRead: 0,
    warningsEmitted: 0,
    pipelineTurns: 0,
    startedAt: timestamp,
    lastSeenAt: timestamp,
  };
}

module.exports = {
  MANIFEST_SCHEMA_VERSION,
  STANDING_SLOTS,
  STANDING_STATUS,
  ENFORCEMENT_LEVELS,
  DEFAULT_SESSION_WARN_AT,
  DEFAULT_SESSION_WARN_HARD_AT,
  DEFAULT_AGENT_PACK_MODEL,
  emptyManifest,
  defaultTeamConfig,
  defaultLocalConfig,
  emptyStanding,
  emptyFeatures,
  emptyLearned,
  emptySessionState,
};
