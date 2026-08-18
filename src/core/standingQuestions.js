'use strict';

// The 6 standing questions asked by `ctx-gate init` (readline/promises, no
// new dependency), seeding standing.yml. glossary.yml is seeded separately
// — see src/core/glossary.js#buildGlossaryTermsFromCandidates. A slot is
// skipped entirely (status: 'detected') only when a sniffer already found
// real signal for it — otherwise the developer is always asked, with a
// suggested default they can accept (Enter) or edit.

const readline = require('readline/promises');

const { sniffErrorHandling, deriveRiskPathsFromCodeowners } = require('./standingSniffers');

const STANDING_QUESTION_DEFS = [
  {
    id: 'done-means',
    slot: 'acceptance',
    prompt: 'What does "done" mean here?',
    defaultValue: () => 'tests pass + CI green',
  },
  {
    id: 'high-risk-paths',
    slot: 'riskPaths',
    prompt: 'Which paths are high-risk / need extra care?',
    defaultValue: (repoRoot) => deriveRiskPathsFromCodeowners(repoRoot).join(', '),
  },
  {
    id: 'error-handling',
    slot: 'errorHandling',
    prompt: "What's the error-handling convention? (do services throw, or return a Result/Either type?)",
    detect: (repoRoot) => sniffErrorHandling(repoRoot),
  },
  {
    id: 'naming-convention',
    slot: 'naming',
    prompt: 'Any naming convention worth stating? (e.g. suffixes for services, reducers, controllers)',
    defaultValue: () => '',
  },
  {
    id: 'performance-target',
    slot: 'performance',
    prompt: 'What does "performance" mean quantitatively here, if ever mentioned?',
    defaultValue: () => 'not measured',
  },
  {
    id: 'logging-convention',
    slot: 'logging',
    prompt: 'Logging convention?',
    defaultValue: () => '',
  },
];

function resolveStreams(streams) {
  return {
    input: (streams && streams.input) || process.stdin,
    output: (streams && streams.output) || process.stdout,
  };
}

/**
 * Asks (or auto-fills, when a sniffer already has signal) the 6 standing
 * questions and returns standing.yml entry objects.
 *
 * @param {string} repoRoot
 * @param {{ input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream }} [streams]
 * @returns {Promise<Object[]>}
 */
async function buildStandingEntries(repoRoot, streams) {
  const { input, output } = resolveStreams(streams);
  const rl = readline.createInterface({ input, output, terminal: false });
  const now = new Date().toISOString();
  const entries = [];
  try {
    for (const q of STANDING_QUESTION_DEFS) {
      if (q.detect) {
        const detected = q.detect(repoRoot);
        if (detected) {
          entries.push({
            id: q.id,
            slot: q.slot,
            value: detected,
            status: 'detected',
            hits: 0,
            created_at: now,
            last_seen: null,
          });
          continue;
        }
      }

      const def = q.defaultValue ? q.defaultValue(repoRoot) : '';
      const suffix = def ? ` [${def}]` : '';
      const raw = (await rl.question(`${q.prompt}${suffix}\n> `)).trim();
      const value = raw || def;
      const status = raw ? 'confirmed' : 'default';
      entries.push({ id: q.id, slot: q.slot, value, status, hits: 0, created_at: now, last_seen: null });
    }
  } finally {
    rl.close();
  }
  return entries;
}

module.exports = { STANDING_QUESTION_DEFS, buildStandingEntries };
