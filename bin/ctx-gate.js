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
      const { manifest, standing, features, learned, mcpAvailable, mcpGuidance } = await init(repoRoot);
      process.stdout.write('ctx-gate: wrote .context-ops/manifest.json\n');
      process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
      process.stdout.write('ctx-gate: wrote .context-ops/memory/standing.yml\n');
      process.stdout.write(`${JSON.stringify(standing, null, 2)}\n`);
      process.stdout.write('ctx-gate: wrote .context-ops/memory/features.yml\n');
      process.stdout.write(`${JSON.stringify(features, null, 2)}\n`);
      process.stdout.write('ctx-gate: wrote .context-ops/memory/learned.yml\n');
      process.stdout.write(`${JSON.stringify(learned, null, 2)}\n`);
      if (mcpAvailable) {
        process.stdout.write('ctx-gate: codebase-memory-mcp found on PATH.\n');
      } else {
        process.stdout.write(`ctx-gate: ${mcpGuidance}\n`);
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
    case 'check': {
      // Non-blocking-safe: a broken gate must never stop a developer's
      // normal Copilot usage, so every failure here is logged and
      // swallowed rather than surfaced as a process error / exit code.
      const repoRoot = process.cwd();
      try {
        const store = require('../src/memory/store');
        const { resolveAdapter } = require('../src/adapters');
        const { runCheck } = require('../src/core/gate');
        const codebaseMemoryClient = require('../src/mcp/codebaseMemoryClient');
        const textSearchFallback = require('../src/mcp/textSearchFallback');

        const stdinJson = await readStdin();
        const adapter = resolveAdapter(resolveAdapterName());
        const request = adapter.parseCheckInput(stdinJson);

        const manifest = store.readManifest(repoRoot);
        const standing = store.readStanding(repoRoot);
        const features = store.readFeatures(repoRoot);
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
        const sessionConfig = {
          sessionWarnAt: (team && team.sessionWarnAt) ?? schema.DEFAULT_SESSION_WARN_AT,
          sessionWarnHardAt: (team && team.sessionWarnHardAt) ?? schema.DEFAULT_SESSION_WARN_HARD_AT,
          sessionWarnings: team && typeof team.sessionWarnings === 'boolean' ? team.sessionWarnings : true,
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

        const response = await runCheck(request, {
          manifest,
          standing: standing || { entries: [] },
          learned: learned || { patterns: [] },
          features: features || { mappings: [] },
          searchCode,
          sessionCache,
          sessionState,
          config: sessionConfig,
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
        }

        if (response.sessionWarning && sessionState) {
          sessionState.warningsEmitted = response.sessionWarning.warningsEmittedAfter;
          try {
            store.writeSessionState(repoRoot, request.sessionId, sessionState);
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

        const { answerEntry, learnedPatch } = recordAndPromote(request, { answersLog, sessionCache, manifest });
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
