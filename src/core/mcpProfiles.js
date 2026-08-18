'use strict';

// Stack -> MCP server suggestions printed by `ctx-gate init` (see
// mcp-profiles.yml at the ctx-gate repo root — not the target repo). Print
// only: never writes to the target repo's .vscode/mcp.json, never installs
// anything, same convention as codebaseMemoryClient.js#guidanceText.

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const PROFILES_PATH = path.join(__dirname, '..', '..', 'mcp-profiles.yml');

// react's e2e suggestion only fires when the repo actually has e2e tests —
// approximated via known e2e-test dependencies, same dependency-based
// heuristic style as src/detectors/react.js's router detection.
const E2E_DEPENDENCY_MARKERS = ['@playwright/test', 'playwright', 'cypress'];

/**
 * @param {string} [profilesPath]
 * @returns {Object} parsed mcp-profiles.yml, or {} if missing/malformed
 */
function loadProfiles(profilesPath = PROFILES_PATH) {
  try {
    return yaml.load(fs.readFileSync(profilesPath, 'utf8')) || {};
  } catch {
    return {};
  }
}

/**
 * @param {Object|null} nodeFacts - manifest.stacks.node
 * @returns {boolean}
 */
function hasE2eTests(nodeFacts) {
  const deps = (nodeFacts && nodeFacts.dependencies) || [];
  return E2E_DEPENDENCY_MARKERS.some((marker) => deps.includes(marker));
}

/**
 * @param {Object} manifest - manifest.json, after stack detection
 * @param {Object} [profiles] - parsed mcp-profiles.yml, defaults to the bundled one
 * @returns {string[]} suggested server names, base servers first, deduped
 */
function suggestServers(manifest, profiles = loadProfiles()) {
  const stacks = (manifest && manifest.stacks) || {};
  const suggestions = [...(profiles.base || [])];

  if (stacks.react && stacks.react.detected && hasE2eTests(stacks.node)) {
    suggestions.push(...((profiles.react && profiles.react.suggest) || []));
  }
  if (stacks.dotnet && stacks.dotnet.detected) {
    suggestions.push(...((profiles.dotnet && profiles.dotnet.suggest) || []));
  }
  if (stacks.python && stacks.python.detected) {
    suggestions.push(...((profiles.python && profiles.python.suggest) || []));
  }

  return [...new Set(suggestions)];
}

module.exports = { PROFILES_PATH, loadProfiles, hasE2eTests, suggestServers };
