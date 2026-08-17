'use strict';

// `ctx-gate review` — manual command (not a hook). Lists learned.yml
// entries unused for 90+ days and standing.yml entries whose evidence
// paths no longer exist, for the developer to confirm or delete.
// Never auto-deletes anything.

/**
 * @param {string} repoRoot
 * @returns {{ stalePatterns: Object[], staleStandingEntries: Object[] }}
 */
function review(repoRoot) {
  throw new Error('not implemented');
}

module.exports = { review };
