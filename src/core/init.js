'use strict';

// `ctx-gate init` — runs detectors, merges manifest.json, asks standing
// questions for unfilled slots, checks for codebase-memory-mcp, writes
// .context-ops/ scaffolding into the target repo. See Phase 1-3 of the
// build plan.

const path = require('path');
const { detectNode } = require('../detectors/node');
const { detectReact } = require('../detectors/react');
const { detectPython } = require('../detectors/python');
const { detectDotnet } = require('../detectors/dotnet');
const { emptyManifest, emptyStanding, emptyGlossary, emptyLearned, defaultTeamConfig } = require('../memory/schema');
const { buildStandingEntries } = require('./standingQuestions');
const { seedCandidateTerms, buildGlossaryTermsFromCandidates } = require('./glossary');
const store = require('../memory/store');
const codebaseMemoryClient = require('../mcp/codebaseMemoryClient');
const { writeHooksFile } = require('./hooks');
const { validate: validateAgentPack } = require('./agentPack');
const { suggestServers } = require('./mcpProfiles');

const DEFAULT_CTX_GATE_JS_PATH = require.resolve(path.join('..', '..', 'bin', 'ctx-gate.js'));

/**
 * @param {string} repoRoot
 * @param {Object} [opts]
 * @param {{ input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream }} [opts.streams]
 *   readline streams for the standing questions — defaults to process.stdin/stdout.
 * @param {string} [opts.ctxGateJsPath] - absolute path to the running bin/ctx-gate.js,
 *   embedded into the hooks file written to the target repo. Defaults to this
 *   package's own bin/ctx-gate.js (correct for both a global npm install and a
 *   version-pinned copy made by install.ps1/install.sh, since each runs its own
 *   physical bin/ctx-gate.js).
 * @returns {Promise<{ manifest: Object, standing: Object, glossary: Object, learned: Object, mcpAvailable: boolean, mcpGuidance: string|null, mcpIndexResult: {success: boolean, message: string}|null, hooksPath: string, mcpServerSuggestions: string[] }>}
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
  const isFreshInit = !standing;
  if (!standing) {
    standing = emptyStanding();
    standing.entries = await buildStandingEntries(repoRoot, opts.streams);
    store.writeStanding(repoRoot, standing);
  }

  let glossary = store.readGlossary(repoRoot);
  if (!glossary) {
    const candidates = seedCandidateTerms(repoRoot, manifest);
    glossary = emptyGlossary();
    glossary.terms = await buildGlossaryTermsFromCandidates(candidates, opts.streams);
    store.writeGlossary(repoRoot, glossary);
  }

  // Committed from the start (per the target-repo commit tree) even
  // though it stays empty until ctx-gate learn promotes a first pattern.
  let learned = store.readLearned(repoRoot);
  if (!learned) {
    learned = emptyLearned();
    store.writeLearned(repoRoot, learned);
  }

  const { team } = store.readConfig(repoRoot);
  if (!team) {
    store.writeTeamConfig(repoRoot, defaultTeamConfig());
  }

  store.ensureGitignoreEntries(repoRoot, [
    '.context-ops/memory/answers.jsonl',
    '.context-ops/config.local.yml',
    '.context-ops/logs/',
    '.context-ops/state/',
  ]);

  const mcpAvailable = codebaseMemoryClient.isAvailable();
  const mcpGuidance = mcpAvailable ? null : codebaseMemoryClient.guidanceText();
  // Only auto-build the index on a genuinely fresh init -- after that the
  // binary's own background watcher keeps it current, and `ctx-gate
  // mcp-check` is there for a manual rebuild. Re-running `init` on an
  // already-set-up repo must stay fast and must not re-spawn the binary.
  const mcpIndexResult = mcpAvailable && isFreshInit
    ? await codebaseMemoryClient.runIndexBuildAndConfirm(repoRoot, opts.mcp)
    : null;

  const hooksPath = writeHooksFile(repoRoot, opts.ctxGateJsPath || DEFAULT_CTX_GATE_JS_PATH);

  // Non-fatal: any *.agent.md files already in the repo get a validation
  // pass, but a broken agent file must never stop init from completing.
  let agentPackReport = null;
  try {
    agentPackReport = validateAgentPack(repoRoot);
  } catch {
    agentPackReport = null;
  }

  const mcpServerSuggestions = suggestServers(manifest);

  return {
    manifest,
    standing,
    glossary,
    learned,
    mcpAvailable,
    mcpGuidance,
    mcpIndexResult,
    hooksPath,
    agentPackReport,
    mcpServerSuggestions,
  };
}

module.exports = { init };
