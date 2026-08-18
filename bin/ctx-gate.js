#!/usr/bin/env node
'use strict';

// CLI entrypoint. Dispatches subcommands. For hook-driven subcommands
// (check/learn/enforce) this is also where the active adapter is
// resolved and where stdin JSON is translated to/from the normalized
// CheckRequest/LearnRequest/EnforceRequest shapes — src/core/*.js never
// sees a hook-specific payload directly.
//
// Per the non-blocking-safe requirement, hook subcommands must never
// throw to the caller: failures are logged to .context-ops/logs/ and the
// process exits 0 regardless.

const fs = require('fs');
const path = require('path');

const VERSION_FILE = path.join(__dirname, '..', 'VERSION');

function printVersion() {
  const version = fs.readFileSync(VERSION_FILE, 'utf8').trim();
  process.stdout.write(`ctx-gate ${version}\n`);
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('{}');
      return;
    }
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data || '{}'));
    process.stdin.on('error', () => resolve('{}'));
  });
}

function logHookError(repoRoot, command, err) {
  try {
    const dir = path.join(repoRoot, '.context-ops', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, 'ctx-gate.log'),
      `${new Date().toISOString()} [${command}] ${err && err.stack ? err.stack : err}\n`
    );
  } catch {
    // logging is best-effort only, must never throw from inside a hook
  }
}

// Best-effort byte-size estimate for the session cost tracker (see
// src/core/learn.js#updateSessionState) — missing/unreadable files simply
// contribute 0, never throw.
function sumFileSizes(repoRoot, filesTouched) {
  let total = 0;
  for (const file of filesTouched || []) {
    try {
      total += fs.statSync(path.join(repoRoot, file)).size;
    } catch {
      // best-effort only
    }
  }
  return total;
}

// Offers to write ctx-gate init's suggested MCP servers into
// .vscode/mcp.json, same confirm-then-write pattern as `mcp-trim`
// (bin/ctx-gate.js's mcp-trim case / src/mcp/mcpAudit.js#buildTrimDiff).
// Only ever proposes the config entry — never installs the underlying
// binary, preserving the SECURITY.md guarantee for codebase-memory-mcp.
async function maybeWriteMcpJsonEntries(repoRoot, suggestedNames) {
  const mcpAudit = require('../src/mcp/mcpAudit');
  const mcpProfiles = require('../src/core/mcpProfiles');

  const mcpJson = mcpAudit.readMcpJson(repoRoot);
  if (!mcpJson.ok && mcpJson.reason === 'malformed') {
    process.stdout.write('ctx-gate: .vscode/mcp.json is malformed — fix it before ctx-gate can add entries to it.\n');
    return;
  }

  const proposal = mcpProfiles.buildAddProposal(mcpJson, suggestedNames);
  if (proposal.alreadyDeclared.length > 0) {
    process.stdout.write(
      `ctx-gate: already declared in .vscode/mcp.json, skipping: ${proposal.alreadyDeclared.join(', ')}\n`
    );
  }
  if (proposal.noKnownConfig.length > 0) {
    process.stdout.write(
      `ctx-gate: no known mcp.json entry for: ${proposal.noKnownConfig.join(', ')} — add those yourself.\n`
    );
  }
  if (proposal.added.length === 0) {
    return;
  }

  process.stdout.write('\nProposed addition to .vscode/mcp.json:\n\n');
  process.stdout.write(`${proposal.diffText}\n`);

  const readline = require('readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  let answer;
  try {
    answer = (await rl.question(`Add ${proposal.added.join(', ')} to .vscode/mcp.json? [y/N] `)).trim().toLowerCase();
  } finally {
    rl.close();
  }
  if (answer !== 'y' && answer !== 'yes') {
    process.stdout.write('ctx-gate: not added.\n');
    return;
  }

  const mcpDir = path.join(repoRoot, '.vscode');
  fs.mkdirSync(mcpDir, { recursive: true });
  fs.writeFileSync(path.join(mcpDir, 'mcp.json'), proposal.nextText, 'utf8');
  process.stdout.write(
    'ctx-gate: wrote .vscode/mcp.json. This was not committed — commit it yourself when ready.\n' +
      'Note: this only writes the config entry — install each server\'s own binary yourself ' +
      '(see the guidance above for codebase-memory-mcp).\n'
  );
}

function resolveAdapterName() {
  // --agent flag > CTX_GATE_AGENT env > config.yml#adapters.active > default
  const flagIndex = process.argv.indexOf('--agent');
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) {
    return process.argv[flagIndex + 1];
  }
  if (process.env.CTX_GATE_AGENT) {
    return process.env.CTX_GATE_AGENT;
  }
  // TODO: once src/memory/store.js#readConfig is implemented, read
  // config.yml#adapters.active here before falling back to the default.
  return 'copilot';
}

async function main(argv) {
  const [, , command, ...rest] = argv;

  if (!command || command === '--version' || command === '-v') {
    printVersion();
    return;
  }

  switch (command) {
    case 'init': {
      const { init } = require('../src/core/init');
      const repoRoot = process.cwd();
      const {
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
      } = await init(repoRoot, { ctxGateJsPath: __filename });
      process.stdout.write('ctx-gate: wrote .context-ops/manifest.json\n');
      process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
      process.stdout.write('ctx-gate: wrote .context-ops/memory/standing.yml\n');
      process.stdout.write(`${JSON.stringify(standing, null, 2)}\n`);
      process.stdout.write('ctx-gate: wrote .context-ops/memory/glossary.yml\n');
      process.stdout.write(`${JSON.stringify(glossary, null, 2)}\n`);
      process.stdout.write('ctx-gate: wrote .context-ops/memory/learned.yml\n');
      process.stdout.write(`${JSON.stringify(learned, null, 2)}\n`);
      process.stdout.write(`ctx-gate: wrote ${path.relative(repoRoot, hooksPath).replace(/\\/g, '/')}\n`);
      if (mcpAvailable) {
        const mcpMessage = mcpIndexResult ? mcpIndexResult.message : 'index already built — background watcher keeps it fresh.';
        process.stdout.write(`ctx-gate: codebase-memory-mcp found on PATH — ${mcpMessage}\n`);
      } else {
        process.stdout.write(`ctx-gate: ${mcpGuidance}\n`);
      }
      if (agentPackReport && agentPackReport.files.length > 0 && agentPackReport.errorCount > 0) {
        process.stdout.write(
          `ctx-gate: ${agentPackReport.errorCount} error(s) found in existing *.agent.md files — run \`ctx-gate agents validate\` for details.\n`
        );
      }
      if (mcpServerSuggestions && mcpServerSuggestions.length > 0) {
        process.stdout.write(
          `ctx-gate: suggested MCP servers for this stack: ${mcpServerSuggestions.join(', ')} ` +
            '(not installed — only the config entry can be written, and only if you say yes below)\n'
        );
        await maybeWriteMcpJsonEntries(repoRoot, mcpServerSuggestions);
      }
      return;
    }
    case 'mcp-check': {
      const { runIndexBuildAndConfirm } = require('../src/mcp/codebaseMemoryClient');
      const repoRoot = process.cwd();
      const { success, message } = await runIndexBuildAndConfirm(repoRoot);
      process.stdout.write(`${message}\n`);
      process.exitCode = success ? 0 : 1;
      return;
    }
    case 'mcp-audit': {
      // Manual command, not a hook — starts every declared server, so it
      // may take several seconds. Must never run on a hook path.
      const store = require('../src/memory/store');
      const mcpAudit = require('../src/mcp/mcpAudit');
      const repoRoot = process.cwd();

      const mcpJson = mcpAudit.readMcpJson(repoRoot);
      if (!mcpJson.ok) {
        process.stdout.write(
          mcpJson.reason === 'absent'
            ? 'ctx-gate: no .vscode/mcp.json found in this repo — nothing to audit.\n'
            : 'ctx-gate: .vscode/mcp.json is malformed — fix it and re-run.\n'
        );
        return;
      }
      const serverNames = Object.keys(mcpJson.servers);
      if (serverNames.length === 0) {
        process.stdout.write('ctx-gate: .vscode/mcp.json declares no servers.\n');
        return;
      }

      const { team } = store.readConfig(repoRoot);
      const mcpConfig = (team && team.mcp) || {};

      process.stdout.write('ctx-gate: measuring declared MCP servers (starts each one — may take a few seconds)...\n\n');
      const measurements = await mcpAudit.measureAllServers(mcpJson.servers);

      const now = new Date();
      let usage = store.readMcpUsage(repoRoot);
      const stubResult = mcpAudit.ensureUsageStubs(usage, serverNames, now.toISOString());
      if (stubResult.changed) {
        store.writeMcpUsage(repoRoot, stubResult.usage);
      }
      usage = stubResult.usage;

      const report = mcpAudit.buildAuditReport(measurements, usage, mcpConfig, now);
      const unusedAfterDays = mcpConfig.unusedAfterDays ?? mcpAudit.DEFAULT_MCP_UNUSED_AFTER_DAYS;

      process.stdout.write('Workspace servers (.vscode/mcp.json)\n\n');
      const header = `  ${'Server'.padEnd(20)}${'Tools'.padEnd(15)}${'Tokens/request'.padEnd(17)}Used (${unusedAfterDays}d)`;
      process.stdout.write(`${header}\n`);
      process.stdout.write(`  ${'-'.repeat(Math.max(header.length - 2, 10))}\n`);
      for (const row of report.rows) {
        const toolsCell = row.measured ? String(row.toolCount) : 'not measured';
        const tokensCell = row.measured ? row.tokens.toLocaleString() : 'not measured';
        const usedCell = row.measured ? `${row.calls} calls` : 'not measured';
        process.stdout.write(`  ${row.name.padEnd(20)}${toolsCell.padEnd(15)}${tokensCell.padEnd(17)}${usedCell}\n`);
      }
      process.stdout.write(`  ${'-'.repeat(Math.max(header.length - 2, 10))}\n`);
      process.stdout.write(`  ${'Total'.padEnd(20)}${String(report.totalTools).padEnd(15)}${report.totalTokens.toLocaleString()}\n\n`);
      process.stdout.write(
        `  Every request in this workspace carries ${report.totalTokens.toLocaleString()} tokens of tool\n` +
          '  definitions before you type anything.\n\n'
      );

      if (report.unused.length > 0) {
        for (const u of report.unused) {
          process.stdout.write(`  Unused in ${unusedAfterDays} days: ${u.name}  ->  ${u.tokens.toLocaleString()} tokens/request\n`);
        }
        process.stdout.write('  Run `ctx-gate mcp-trim` to see a proposed change.\n\n');
      }

      process.stdout.write(
        '  Note: this covers repo-declared servers only. Servers enabled in your\n' +
          '  personal VS Code profile load in every workspace and cannot be read or\n' +
          '  changed by ctx-gate.\n'
      );

      if (report.exceedsWarn) {
        process.stdout.write(
          `\nctx-gate: warning — workspace MCP tool definitions total ${report.totalTokens.toLocaleString()} tokens, ` +
            `above the configured warnAboveTokens (${report.warnAboveTokens.toLocaleString()}).\n`
        );
      }
      return;
    }
    case 'mcp-add': {
      // Manual command, not a hook. Same confirm-then-write flow `init`
      // offers inline, but callable any time later — e.g. if the developer
      // said no during init, or the stack changed since then.
      const repoRoot = process.cwd();
      let names = rest.filter((arg) => !arg.startsWith('--'));

      if (names.length === 0) {
        const { suggestServers } = require('../src/core/mcpProfiles');
        const store = require('../src/memory/store');
        let manifest;
        try {
          manifest = store.readManifest(repoRoot);
        } catch {
          process.stdout.write(
            'ctx-gate: no .context-ops/manifest.json found — run `ctx-gate init` first, ' +
              'or pass server names directly: `ctx-gate mcp-add <name...>`.\n'
          );
          return;
        }
        names = suggestServers(manifest);
        if (names.length === 0) {
          process.stdout.write('ctx-gate: no suggested MCP servers for this stack.\n');
          return;
        }
      }

      await maybeWriteMcpJsonEntries(repoRoot, names);
      return;
    }
    case 'mcp-trim': {
      // Manual command, not a hook. Proposes a diff, requires explicit
      // confirmation, never commits on the developer's behalf.
      const store = require('../src/memory/store');
      const mcpAudit = require('../src/mcp/mcpAudit');
      const repoRoot = process.cwd();

      const mcpJson = mcpAudit.readMcpJson(repoRoot);
      if (!mcpJson.ok) {
        process.stdout.write(
          mcpJson.reason === 'absent'
            ? 'ctx-gate: no .vscode/mcp.json found in this repo — nothing to trim.\n'
            : 'ctx-gate: .vscode/mcp.json is malformed — fix it and re-run.\n'
        );
        return;
      }
      const serverNames = Object.keys(mcpJson.servers);
      if (serverNames.length === 0) {
        process.stdout.write('ctx-gate: .vscode/mcp.json declares no servers.\n');
        return;
      }

      const { team } = store.readConfig(repoRoot);
      const mcpConfig = (team && team.mcp) || {};

      process.stdout.write('ctx-gate: measuring declared MCP servers (starts each one — may take a few seconds)...\n\n');
      const measurements = await mcpAudit.measureAllServers(mcpJson.servers);

      const now = new Date();
      let usage = store.readMcpUsage(repoRoot);
      const stubResult = mcpAudit.ensureUsageStubs(usage, serverNames, now.toISOString());
      if (stubResult.changed) {
        store.writeMcpUsage(repoRoot, stubResult.usage);
      }
      usage = stubResult.usage;

      const report = mcpAudit.buildAuditReport(measurements, usage, mcpConfig, now);
      const proposal = mcpAudit.buildTrimProposal(report.rows, mcpConfig);

      for (const w of proposal.insufficientWindow) {
        process.stdout.write(
          `ctx-gate: ${w.name} — only ${w.daysCovered} of ${w.neededDays} days of usage data so far, ` +
            'refusing to recommend removal yet.\n'
        );
      }
      for (const s of proposal.notMeasuredSkipped) {
        process.stdout.write(
          `ctx-gate: ${s.name} — not measured, never proposed for removal (absence of a measurement ` +
            'is not evidence it is unused).\n'
        );
      }

      if (proposal.candidates.length === 0) {
        process.stdout.write('ctx-gate: no servers currently qualify for removal.\n');
        return;
      }

      const names = proposal.candidates.map((c) => c.name);
      const { diffText, nextText } = mcpAudit.buildTrimDiff(mcpJson, names);
      const totalSaved = proposal.candidates.reduce((sum, c) => sum + (c.tokens || 0), 0);

      process.stdout.write('\nProposed change to .vscode/mcp.json:\n\n');
      process.stdout.write(`${diffText}\n`);
      for (const c of proposal.candidates) {
        process.stdout.write(`  - ${c.name}: saves ${c.tokens.toLocaleString()} tokens/request\n`);
      }
      process.stdout.write(`  Total: ${totalSaved.toLocaleString()} tokens/request\n\n`);

      const readline = require('readline/promises');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
      let answer;
      try {
        answer = (await rl.question('Apply this change to .vscode/mcp.json? [y/N] ')).trim().toLowerCase();
      } finally {
        rl.close();
      }
      if (answer !== 'y' && answer !== 'yes') {
        process.stdout.write('ctx-gate: not applied.\n');
        return;
      }

      const mcpJsonPath = path.join(repoRoot, '.vscode', 'mcp.json');
      fs.writeFileSync(mcpJsonPath, nextText, 'utf8');
      process.stdout.write('ctx-gate: wrote .vscode/mcp.json. This was not committed — commit it yourself when ready.\n');
      return;
    }
    case 'check': {
      // Non-blocking-safe: a broken gate must never stop a developer's
      // normal Copilot usage, so every failure here is logged and
      // swallowed rather than surfaced as a process error / exit code.
      const repoRoot = process.cwd();
      try {
        const store = require('../src/memory/store');
        const { resolveAdapter } = require('../src/adapters');
        const { runCheck, extractCandidateJargonTerms } = require('../src/core/gate');
        const { collectRepoSymbolNames } = require('../src/core/glossary');
        const codebaseMemoryClient = require('../src/mcp/codebaseMemoryClient');
        const textSearchFallback = require('../src/mcp/textSearchFallback');

        const stdinJson = await readStdin();
        const adapter = resolveAdapter(resolveAdapterName());
        const request = adapter.parseCheckInput(stdinJson);

        const manifest = store.readManifest(repoRoot);
        const standing = store.readStanding(repoRoot);
        const glossary = store.readGlossary(repoRoot);
        let learned;
        try {
          learned = store.readLearned(repoRoot);
        } catch {
          learned = { patterns: [] };
        }

        const useMcp = codebaseMemoryClient.isAvailable();
        const searchCode = (query) =>
          useMcp ? codebaseMemoryClient.searchCode(query) : textSearchFallback.searchCode(repoRoot, query);

        const sessionCache = store.readSessionCache(repoRoot);

        const { team } = store.readConfig(repoRoot);
        const schema = require('../src/memory/schema');
        const { isHandoffInstalled } = require('../src/core/agentPack');
        const sessionConfig = {
          sessionWarnAt: (team && team.sessionWarnAt) ?? schema.DEFAULT_SESSION_WARN_AT,
          sessionWarnHardAt: (team && team.sessionWarnHardAt) ?? schema.DEFAULT_SESSION_WARN_HARD_AT,
          sessionWarnings: team && typeof team.sessionWarnings === 'boolean' ? team.sessionWarnings : true,
          handoffInstalled: isHandoffInstalled(repoRoot),
        };

        // A corrupt session-state file must never break the rest of the
        // check — log it and proceed as if no session state exists.
        let sessionState = null;
        try {
          sessionState = store.readSessionState(repoRoot, request.sessionId);
        } catch (err) {
          logHookError(repoRoot, 'check', err);
          sessionState = null;
        }

        // Only walked when this prompt actually contains candidate jargon —
        // the vast majority of prompts don't, and this hook must stay fast.
        const jargonCandidates = extractCandidateJargonTerms(request.prompt);
        const knownSymbolNames = jargonCandidates.length > 0 ? collectRepoSymbolNames(repoRoot) : new Set();
        const unknownTermsState = store.readUnknownTerms(repoRoot);
        const now = new Date().toISOString();

        const response = await runCheck(request, {
          manifest,
          standing: standing || { entries: [] },
          learned: learned || { patterns: [] },
          glossary: glossary || { terms: [] },
          searchCode,
          sessionCache,
          sessionState,
          config: sessionConfig,
          knownSymbolNames,
          unknownTermsState,
          now,
        });

        if (!response.skipped) {
          sessionCache[request.sessionId] = {
            checked: true,
            prompt: request.prompt,
            timestamp: new Date().toISOString(),
            unknownSlots: response.unknownSlots,
            vagueTermsFound: response.vagueTermsFound,
            matches: response.matches,
          };
          store.writeSessionCache(repoRoot, sessionCache);
          try {
            store.writeUnknownTerms(repoRoot, response.unknownTermsStateAfter);
          } catch (err) {
            logHookError(repoRoot, 'check', err);
          }
        }

        if (response.sessionWarning && sessionState) {
          sessionState.warningsEmitted = response.sessionWarning.warningsEmittedAfter;
          try {
            store.writeSessionState(repoRoot, request.sessionId, sessionState);
          } catch (err) {
            logHookError(repoRoot, 'check', err);
          }
        }

        // Tracked separately from turnCount (which learn.js advances on
        // postToolUse) so `ctx-gate stats` can report pipeline-orchestrated
        // sub-agent turns without folding them into normal session medians.
        if (response.skipped && response.skipReason === 'pipeline') {
          try {
            const state = sessionState || schema.emptySessionState(request.sessionId, new Date().toISOString());
            state.pipelineTurns = (state.pipelineTurns || 0) + 1;
            store.writeSessionState(repoRoot, request.sessionId, state);
          } catch (err) {
            logHookError(repoRoot, 'check', err);
          }
        }

        process.stdout.write(`${JSON.stringify(adapter.formatCheckOutput(response))}\n`);
      } catch (err) {
        logHookError(repoRoot, 'check', err);
        process.stdout.write(`${JSON.stringify({ additionalContext: '' })}\n`);
      }
      return;
    }
    case 'learn': {
      const repoRoot = process.cwd();
      try {
        const store = require('../src/memory/store');
        const { resolveAdapter } = require('../src/adapters');
        const { recordAndPromote } = require('../src/core/learn');

        const stdinJson = await readStdin();
        const adapter = resolveAdapter(resolveAdapterName());
        const request = adapter.parseLearnInput(stdinJson);

        const answersLog = store.readAnswersLog(repoRoot);
        const sessionCache = store.readSessionCache(repoRoot);
        let manifest;
        try {
          manifest = store.readManifest(repoRoot);
        } catch {
          manifest = { stacks: {}, endpoints: [] };
        }

        const { answerEntry, learnedPatch, glossaryPatch } = recordAndPromote(request, { answersLog, sessionCache, manifest });
        store.appendAnswerLine(repoRoot, answerEntry);

        if (learnedPatch) {
          const learned = store.readLearned(repoRoot) || { version: 1, patterns: [] };
          const idx = learned.patterns.findIndex((p) => p.id === learnedPatch.id);
          if (idx === -1) {
            learned.patterns.push(learnedPatch);
          } else {
            learned.patterns[idx] = learnedPatch;
          }
          store.writeLearned(repoRoot, learned);
        }

        // Never overwrites a term the developer already confirmed or is
        // still deciding on — this promotion only ever adds a brand-new
        // candidate, matching the addon-6 "developer confirms it" contract.
        if (glossaryPatch) {
          try {
            const glossary = store.readGlossary(repoRoot) || { version: 1, terms: [] };
            const exists = glossary.terms.some((t) => t.term.toLowerCase() === glossaryPatch.term.toLowerCase());
            if (!exists) {
              glossary.terms.push(glossaryPatch);
              store.writeGlossary(repoRoot, glossary);
            }
          } catch (err) {
            logHookError(repoRoot, 'learn', err);
          }
        }

        // Session cost tracking. Isolated in its own try/catch so a
        // corrupt state file logs and is skipped without undoing the
        // answers.jsonl/learned.yml writes above.
        try {
          const { updateSessionState, findStaleSessionStates } = require('../src/core/learn');

          let existingState = null;
          try {
            existingState = store.readSessionState(repoRoot, request.sessionId);
          } catch (err) {
            logHookError(repoRoot, 'learn', err);
            existingState = null;
          }

          const bytesRead = sumFileSizes(repoRoot, request.filesTouched);
          const newState = updateSessionState(existingState, {
            sessionId: request.sessionId,
            timestamp: request.timestamp,
            filesTouched: request.filesTouched,
            bytesRead,
          });
          store.writeSessionState(repoRoot, request.sessionId, newState);

          const allStates = store.listSessionStates(repoRoot);
          const staleIds = findStaleSessionStates(allStates, new Date(request.timestamp));
          for (const staleId of staleIds) {
            store.deleteSessionStateFile(repoRoot, staleId);
          }
        } catch (err) {
          logHookError(repoRoot, 'learn', err);
        }

        // MCP per-server usage counting for `ctx-gate mcp-audit`/`mcp-trim`.
        // Isolated in its own try/catch for the same reason as session cost
        // tracking above — a corrupt mcp-usage.json must not undo the
        // answers.jsonl/learned.yml writes already made.
        try {
          const { recordMcpUsage } = require('../src/core/learn');
          const usage = store.readMcpUsage(repoRoot);
          const updatedUsage = recordMcpUsage(usage, request.toolName, request.timestamp);
          if (updatedUsage !== usage) {
            store.writeMcpUsage(repoRoot, updatedUsage);
          }
        } catch (err) {
          logHookError(repoRoot, 'learn', err);
        }
      } catch (err) {
        logHookError(repoRoot, 'learn', err);
      }
      return;
    }
    case 'review': {
      const { review } = require('../src/core/review');
      const store = require('../src/memory/store');
      const repoRoot = process.cwd();
      const learned = store.readLearned(repoRoot) || { patterns: [] };
      const standing = store.readStanding(repoRoot) || { entries: [] };
      const { stalePatterns, staleStandingEntries } = review(repoRoot, { learned, standing });

      if (stalePatterns.length === 0 && staleStandingEntries.length === 0) {
        process.stdout.write('ctx-gate review: nothing stale found.\n');
        return;
      }
      if (stalePatterns.length > 0) {
        process.stdout.write(`Learned patterns unused for ${require('../src/core/review').STALE_LEARNED_DAYS}+ days:\n`);
        for (const p of stalePatterns) {
          process.stdout.write(`  - ${p.id} (last seen ${p.last_seen})\n`);
        }
      }
      if (staleStandingEntries.length > 0) {
        process.stdout.write('standing.yml entries with missing risk-path evidence:\n');
        for (const e of staleStandingEntries) {
          process.stdout.write(`  - ${e.id}: ${e.value}\n`);
        }
      }
      process.stdout.write('Nothing was deleted — review and edit these files by hand.\n');
      return;
    }
    case 'configure': {
      const { listConfigurable, setStandingAnswer } = require('../src/core/configure');
      const repoRoot = process.cwd();

      if (rest.length === 0) {
        const { standing } = listConfigurable(repoRoot);
        process.stdout.write('ctx-gate: configurable answers for this repo (.context-ops/memory/standing.yml)\n\n');
        for (const row of standing) {
          const value = row.value || '(blank)';
          process.stdout.write(`  ${row.id.padEnd(22)} ${value.padEnd(35)} [${row.status}]\n`);
        }
        process.stdout.write('\nUsage: ctx-gate configure <id> <value>\n');
        process.stdout.write('Example: ctx-gate configure logging-convention "use pino, one JSON line per request"\n');
        process.stdout.write('\nFor shared vocabulary, see `ctx-gate glossary add|list|review` instead.\n');
        return;
      }

      const [id, ...valueParts] = rest;
      const value = valueParts.join(' ');
      if (!value) {
        process.stderr.write('Usage: ctx-gate configure <id> <value>\nRun `ctx-gate configure` with no arguments to see valid ids.\n');
        process.exitCode = 1;
        return;
      }
      try {
        const entry = setStandingAnswer(repoRoot, id, value);
        process.stdout.write(`ctx-gate: set "${entry.id}" -> ${entry.value}\n`);
      } catch (err) {
        process.stderr.write(`${err.message}\n`);
        process.exitCode = 1;
      }
      return;
    }
    case 'glossary': {
      const { addTerm, listTerms, reviewTerms } = require('../src/core/glossary');
      const repoRoot = process.cwd();
      const sub = rest[0];

      if (sub === 'add') {
        const [, term, ...definitionParts] = rest;
        const definition = definitionParts.join(' ');
        if (!term || !definition) {
          process.stderr.write('Usage: ctx-gate glossary add <term> <definition>\n');
          process.exitCode = 1;
          return;
        }
        const entry = addTerm(repoRoot, term, definition);
        process.stdout.write(`ctx-gate: defined "${entry.term}" — confirmed\n`);
        return;
      }

      if (sub === 'list' || !sub) {
        const terms = listTerms(repoRoot);
        if (terms.length === 0) {
          process.stdout.write('ctx-gate: glossary.yml has no terms yet — run `ctx-gate init` or `ctx-gate glossary add <term> <definition>`.\n');
          return;
        }
        process.stdout.write('ctx-gate: glossary (.context-ops/memory/glossary.yml)\n\n');
        for (const t of terms) {
          const def = t.definition || '(no definition yet)';
          process.stdout.write(`  ${t.term.padEnd(28)} [${t.status}]  ${def}\n`);
        }
        return;
      }

      if (sub === 'review') {
        const { candidateTerms, unresolvedUnknownTerms } = reviewTerms(repoRoot);
        if (candidateTerms.length === 0 && unresolvedUnknownTerms.length === 0) {
          process.stdout.write('ctx-gate glossary review: nothing to review.\n');
          return;
        }
        if (candidateTerms.length > 0) {
          process.stdout.write('Candidate terms awaiting a definition:\n');
          for (const t of candidateTerms) {
            process.stdout.write(`  - ${t.term}${t.paths.length ? ` (${t.paths.join(', ')})` : ''}\n`);
          }
        }
        if (unresolvedUnknownTerms.length > 0) {
          process.stdout.write('Undefined terms seen across 3+ sessions, not yet in the glossary:\n');
          for (const t of unresolvedUnknownTerms) {
            process.stdout.write(`  - ${t.term} (${t.sessions} sessions)\n`);
          }
        }
        process.stdout.write('Run `ctx-gate glossary add <term> <definition>` to confirm one, or edit glossary.yml by hand.\n');
        return;
      }

      process.stderr.write(`Unknown "ctx-gate glossary" subcommand: ${sub}\nUsage: ctx-gate glossary add <term> <definition> | list | review\n`);
      process.exitCode = 1;
      return;
    }
    case 'enforce': {
      const repoRoot = process.cwd();
      const levelArg = rest[0];
      if (levelArg && ['off', 'warn', 'block'].includes(levelArg)) {
        const { setLocalOverride } = require('../src/core/enforce');
        setLocalOverride(repoRoot, levelArg);
        process.stdout.write(`ctx-gate: wrote .context-ops/config.local.yml (enforcement: ${levelArg})\n`);
        process.stdout.write('This file is gitignored — it is never committed on your behalf.\n');
        return;
      }

      // Hook invocation (preToolUse): non-blocking-safe — any internal
      // failure here must default to 'allow', never accidentally deny.
      try {
        const store = require('../src/memory/store');
        const { resolveAdapter } = require('../src/adapters');
        const { computeEffectiveLevel, assertNoDowngrade, decide } = require('../src/core/enforce');

        const stdinJson = await readStdin();
        const adapter = resolveAdapter(resolveAdapterName());
        const request = adapter.parseEnforceInput(stdinJson);

        const { team, local } = store.readConfig(repoRoot);
        const teamLevel = (team && team.enforcement) || 'off';
        let localLevel = local && local.enforcement;
        try {
          assertNoDowngrade(teamLevel, localLevel);
        } catch (err) {
          logHookError(repoRoot, 'enforce', err);
          localLevel = null; // ignore the misconfigured override, fall back to team level
        }
        const effectiveLevel = computeEffectiveLevel(teamLevel, localLevel);

        const sessionCache = store.readSessionCache(repoRoot);
        const answersLog = store.readAnswersLog(repoRoot);

        const decision = decide(request, { effectiveLevel, sessionCache, answersLog });
        process.stdout.write(`${JSON.stringify(adapter.formatEnforceOutput(decision))}\n`);
      } catch (err) {
        logHookError(repoRoot, 'enforce', err);
        process.stdout.write(`${JSON.stringify({ decision: 'allow' })}\n`);
      }
      return;
    }
    case 'agents': {
      const repoRoot = process.cwd();
      const sub = rest[0];

      if (sub === 'install') {
        const { install } = require('../src/core/agentPack');
        const withGuidelines = rest.includes('--with-guidelines');
        const { results } = install(repoRoot, { withGuidelines });
        let hadConflict = false;
        for (const r of results) {
          if (r.status === 'conflict') {
            hadConflict = true;
            process.stdout.write(`ctx-gate: ${r.file} — CONFLICT, not overwritten (edit or delete it, then re-run)\n`);
            process.stdout.write(`${r.diffText}\n`);
            continue;
          }
          const tokenSuffix = r.tokenCount != null ? ` — ${r.tokenCount} tokens (measured)` : '';
          process.stdout.write(`ctx-gate: ${r.file} — ${r.status}${tokenSuffix}\n`);
        }
        if (!withGuidelines) {
          process.stdout.write('ctx-gate: authoring guidelines not installed — re-run with --with-guidelines to add .github/instructions/agents.instructions.md\n');
        }
        process.exitCode = hadConflict ? 1 : 0;
        return;
      }

      if (sub === 'update') {
        const { update } = require('../src/core/agentPack');
        const { results } = update(repoRoot);
        for (const r of results) {
          process.stdout.write(`ctx-gate: ${r.file} — ${r.status}\n`);
          if (r.diffText) {
            process.stdout.write(`${r.diffText}\n`);
          }
        }
        return;
      }

      if (sub === 'validate' || !sub) {
        const { validate } = require('../src/core/agentPack');
        const report = validate(repoRoot);
        if (report.files.length === 0) {
          process.stdout.write('ctx-gate: no *.agent.md files found in this repo\n');
          return;
        }
        for (const f of report.files) {
          const rel = path.relative(repoRoot, f.file).replace(/\\/g, '/');
          for (const e of f.errors) {
            process.stdout.write(`ctx-gate: ${rel} — ERROR: ${e}\n`);
          }
          for (const w of f.warnings) {
            process.stdout.write(`ctx-gate: ${rel} — warning: ${w}\n`);
          }
          if (f.errors.length === 0 && f.warnings.length === 0) {
            process.stdout.write(`ctx-gate: ${rel} — ok\n`);
          }
        }
        process.stdout.write(`ctx-gate: ${report.errorCount} error(s), ${report.warningCount} warning(s) across ${report.files.length} file(s)\n`);
        process.exitCode = report.errorCount > 0 ? 1 : 0;
        return;
      }

      process.stderr.write(`Unknown "ctx-gate agents" subcommand: ${sub}\nUsage: ctx-gate agents install [--with-guidelines] | update | validate\n`);
      process.exitCode = 1;
      return;
    }
    case 'optimize': {
      const { optimize } = require('../src/core/optimize');
      const repoRoot = process.cwd();
      const write = rest.includes('--write');
      const result = await optimize(repoRoot, { write });

      process.stdout.write(`ctx-gate: efficiency block — ${result.efficiencyBlockTokens} tokens (measured)\n`);
      for (const d of result.diffs) {
        if (!d.changed) {
          process.stdout.write(`ctx-gate: ${d.path} — no change\n`);
          continue;
        }
        process.stdout.write(`ctx-gate: ${d.path} — ${write ? 'written' : 'would change'}\n`);
        process.stdout.write(`${d.diffText}\n`);
      }
      if (!write) {
        process.stdout.write('ctx-gate: diff-preview only — re-run with --write to apply.\n');
      }
      return;
    }
    case 'stats': {
      // Manual command, not a hook — safe to scan the whole state
      // directory here (unlike gate.js/learn.js on the hook path).
      const store = require('../src/memory/store');
      const { countTokens } = require('../src/tokenBudget');
      const { STATS_WINDOW_DAYS, computeSessionStats } = require('../src/core/stats');
      const repoRoot = process.cwd();

      const states = store.listSessionStates(repoRoot).map((entry) => entry.state);
      const report = computeSessionStats(states);

      process.stdout.write(`ctx-gate stats — last ${STATS_WINDOW_DAYS} days\n`);
      process.stdout.write(`Sessions: ${report.sessionsThisWeek}\n`);
      process.stdout.write(`Median turns: ${report.medianTurns === null ? 'not measured' : report.medianTurns}\n`);
      process.stdout.write(`Max turns: ${report.maxTurns === null ? 'not measured' : report.maxTurns}\n`);
      process.stdout.write(`Sessions that crossed the soft warning threshold: ${report.sessionsCrossedSoft}\n`);
      process.stdout.write(`Sessions that crossed the firm warning threshold: ${report.sessionsCrossedHard}\n`);
      process.stdout.write(`Pipeline-orchestrated turns (agent-pack sub-agent prompts, excluded from turn medians above): ${report.pipelineTurns}\n`);
      process.stdout.write(`Session handoffs written (.agentflow/handoffs/): ${report.handoffsWritten}\n`);
      process.stdout.write('Most re-read files:\n');
      if (report.mostReread.length === 0) {
        process.stdout.write('  (none)\n');
      }
      for (const entry of report.mostReread) {
        let tokenLabel = 'not measured';
        try {
          const content = fs.readFileSync(path.join(repoRoot, entry.file), 'utf8');
          tokenLabel = `${countTokens(content)} tokens (current file content, measured)`;
        } catch {
          tokenLabel = 'not measured';
        }
        process.stdout.write(`  - ${entry.file} — read ${entry.totalReads}x — ${tokenLabel}\n`);
      }
      return;
    }
    default:
      process.stderr.write(`Unknown command: ${command}\n`);
      process.exitCode = 1;
  }
}

main(process.argv).catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exitCode = 1;
});
