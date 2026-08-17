'use strict';

// `ctx-gate init` — runs detectors, merges manifest.json, asks standing
// questions for unfilled slots, checks for codebase-memory-mcp, writes
// .context-ops/ scaffolding into the target repo. See Phase 1-3 of the
// build plan.

const { detectNode } = require('../detectors/node');
const { detectReact } = require('../detectors/react');
const { detectPython } = require('../detectors/python');
const { detectDotnet } = require('../detectors/dotnet');
const { emptyManifest } = require('../memory/schema');
const store = require('../memory/store');

/**
 * @param {string} repoRoot
 * @param {Object} [opts]
 * @returns {Promise<Object>} the written manifest
 */
async function init(repoRoot, opts = {}) {
  const manifest = emptyManifest();

  const nodeFacts = detectNode(repoRoot);
  if (nodeFacts) {
    manifest.stacks.node = nodeFacts;
  }

  const reactFacts = detectReact(repoRoot, nodeFacts);
  if (reactFacts) {
    manifest.stacks.react = reactFacts;
  }

  const pythonFacts = detectPython(repoRoot);
  if (pythonFacts) {
    const { endpoints, ...stackFacts } = pythonFacts;
    manifest.stacks.python = stackFacts;
    if (endpoints && endpoints.length) {
      manifest.endpoints.push(...endpoints);
    }
  }

  const dotnetFacts = detectDotnet(repoRoot);
  if (dotnetFacts) {
    manifest.stacks.dotnet = dotnetFacts;
  }

  store.writeManifest(repoRoot, manifest);

  // TODO(phase 2): ask the 7 standing questions via readline/promises for
  // slots not already filled by a detector, write .context-ops/memory/standing.yml
  // TODO(phase 3): check codebase-memory-mcp availability and print guidance

  return manifest;
}

module.exports = { init };
