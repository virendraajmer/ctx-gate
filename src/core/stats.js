'use strict';

// `ctx-gate stats` — manual command, not a hook. Reads the session state
// snapshots already written by learn.js and reports locally-computed
// numbers only. Zero LLM calls. Pure aggregation here; bin/ctx-gate.js
// does the file listing (store.listSessionStates) and any real-tokenizer
// lookups (src/tokenBudget.js) before/after calling this.

const STATS_WINDOW_DAYS = 7;
const MOST_REREAD_TOP_N = 5;

/**
 * @param {number[]} nums
 * @returns {number|null} null if nums is empty
 */
function median(nums) {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function withinWindow(state, now, windowDays) {
  if (!state || !state.lastSeenAt) return false;
  const ageDays = (now - new Date(state.lastSeenAt)) / (1000 * 60 * 60 * 24);
  return ageDays >= 0 && ageDays <= windowDays;
}

/**
 * @param {Object[]} states - session state objects (already parsed, e.g. store.listSessionStates(...).map(e => e.state))
 * @param {Date} [now]
 * @returns {Object} computed report, no I/O
 */
function computeSessionStats(states, now = new Date()) {
  const weekly = states.filter((s) => withinWindow(s, now, STATS_WINDOW_DAYS));
  const turnCounts = weekly.map((s) => s.turnCount || 0);

  let sessionsCrossedSoft = 0;
  let sessionsCrossedHard = 0;
  for (const s of weekly) {
    const emitted = s.warningsEmitted || 0;
    if (emitted >= 1) sessionsCrossedSoft += 1;
    if (emitted >= 2) sessionsCrossedHard += 1;
  }

  const rereadCounts = {};
  for (const s of states) {
    const counts = (s && s.fileReadCounts) || {};
    for (const [file, count] of Object.entries(counts)) {
      rereadCounts[file] = (rereadCounts[file] || 0) + count;
    }
  }
  const mostReread = Object.entries(rereadCounts)
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MOST_REREAD_TOP_N)
    .map(([file, totalReads]) => ({ file, totalReads }));

  return {
    sessionsThisWeek: weekly.length,
    medianTurns: median(turnCounts),
    maxTurns: turnCounts.length ? Math.max(...turnCounts) : null,
    sessionsCrossedSoft,
    sessionsCrossedHard,
    mostReread,
  };
}

module.exports = { STATS_WINDOW_DAYS, MOST_REREAD_TOP_N, median, computeSessionStats };
