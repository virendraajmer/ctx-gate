'use strict';

// `ctx-gate review` — manual command (not a hook). Lists learned.yml
// entries unused for 90+ days and standing.yml risk-path entries whose
// paths no longer exist, for the developer to confirm or delete. Never
// auto-deletes anything.

const fs = require('fs');
const path = require('path');

const STALE_LEARNED_DAYS = 90;

/**
 * @param {string} repoRoot
 * @param {Object} deps - { learned, standing, now }
 * @returns {{ stalePatterns: Object[], staleStandingEntries: Object[] }}
 */
function review(repoRoot, deps = {}) {
  const { learned, standing, now = new Date() } = deps;

  const stalePatterns = ((learned && learned.patterns) || []).filter((p) => {
    if (!p.last_seen) return false;
    const ageDays = (now - new Date(p.last_seen)) / (1000 * 60 * 60 * 24);
    return ageDays >= STALE_LEARNED_DAYS;
  });

  const staleStandingEntries = ((standing && standing.entries) || []).filter((entry) => {
    if (entry.slot !== 'riskPaths' || !entry.value) return false;
    const paths = String(entry.value)
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    return paths.some((p) => !fs.existsSync(path.join(repoRoot, p)));
  });

  return { stalePatterns, staleStandingEntries };
}

module.exports = { STALE_LEARNED_DAYS, review };
