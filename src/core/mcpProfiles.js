'use strict';

// Stack -> MCP server suggestions printed by `ctx-gate init` (see
// mcp-profiles.yml at the ctx-gate repo root — not the target repo).
// suggestServers() only computes names to print. Writing them into the
// target repo's .vscode/mcp.json (buildAddProposal below) happens only if
// the developer opts in at bin/ctx-gate.js's confirm prompt — this module
// never installs the underlying binary itself, same convention as
// codebaseMemoryClient.js#guidanceText.

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { createTwoFilesPatch } = require('diff');

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

/**
 * @param {string} name - suggested server name (e.g. 'codebase-memory')
 * @param {Object} [profiles]
 * @returns {{command: string, args?: string[]}|null}
 */
function serverConfigFor(name, profiles = loadProfiles()) {
  return (profiles.servers && profiles.servers[name]) || null;
}

/**
 * Builds a proposed .vscode/mcp.json with the given suggested servers
 * added, for `ctx-gate init` to show before prompting — mirrors
 * src/mcp/mcpAudit.js#buildTrimDiff. Pure — no I/O.
 *
 * A suggested name already declared in mcpJson is left untouched
 * (never overwritten); a suggested name with no known command spec in
 * mcp-profiles.yml#servers is skipped rather than guessed at. This never
 * installs the underlying binary — only proposes the config entry.
 *
 * @param {{ raw: Object|null, rawText: string, servers: Object }} mcpJson - readMcpJson(...) result (mcpAudit.js), or the absent/default shape
 * @param {string[]} suggestedNames
 * @param {Object} [profiles]
 * @returns {{ added: string[], alreadyDeclared: string[], noKnownConfig: string[], nextJson: Object, nextText: string, diffText: string }}
 */
function buildAddProposal(mcpJson, suggestedNames, profiles = loadProfiles()) {
  const existingServers = (mcpJson && mcpJson.servers) || {};
  const added = [];
  const alreadyDeclared = [];
  const noKnownConfig = [];
  const nextServers = { ...existingServers };

  for (const name of suggestedNames) {
    if (existingServers[name]) {
      alreadyDeclared.push(name);
      continue;
    }
    const config = serverConfigFor(name, profiles);
    if (!config) {
      noKnownConfig.push(name);
      continue;
    }
    nextServers[name] = config;
    added.push(name);
  }

  const baseJson = (mcpJson && mcpJson.raw) || { servers: {} };
  const nextJson = { ...baseJson, servers: nextServers };
  const nextText = `${JSON.stringify(nextJson, null, 2)}\n`;
  const rawText = (mcpJson && mcpJson.rawText) || '';
  const diffText = createTwoFilesPatch(
    '.vscode/mcp.json',
    '.vscode/mcp.json',
    rawText,
    nextText,
    'existing',
    'proposed'
  );

  return { added, alreadyDeclared, noKnownConfig, nextJson, nextText, diffText };
}

module.exports = {
  PROFILES_PATH,
  loadProfiles,
  hasE2eTests,
  suggestServers,
  serverConfigFor,
  buildAddProposal,
};
