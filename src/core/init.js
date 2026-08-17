'use strict';

// `ctx-gate init` — runs detectors, merges manifest.json, asks standing
// questions for unfilled slots, checks for codebase-memory-mcp, writes
// .context-ops/ scaffolding into the target repo. See Phase 1-3 of the
// build plan.

const { detectNode } = require('../detectors/node');
const { detectReact } = require('../detectors/react');
const { detectPython } = require('../detectors/python');
const { detectDotnet } = require('../detectors/dotnet');
const { emptyManifest, emptyStanding, emptyFeatures } = require('../memory/schema');
const { buildStandingEntries, buildFeatureMappings } = require('./standingQuestions');
const store = require('../memory/store');

/**
 * @param {string} repoRoot
 * @param {Object} [opts]
 * @param {{ input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream }} [opts.streams]
 *   readline streams for the standing questions — defaults to process.stdin/stdout.
 * @returns {Promise<{ manifest: Object, standing: Object, features: Object }>}
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

  let standing = store.readStanding(repoRoot);
  if (!standing) {
    standing = emptyStanding();
    standing.entries = await buildStandingEntries(repoRoot, opts.streams);
    store.writeStanding(repoRoot, standing);
  }

  let features = store.readFeatures(repoRoot);
  if (!features) {
    features = emptyFeatures();
    features.mappings = await buildFeatureMappings(repoRoot, opts.streams);
    store.writeFeatures(repoRoot, features);
  }

  // TODO(phase 3): check codebase-memory-mcp availability and print guidance

  return { manifest, standing, features };
}

module.exports = { init };
