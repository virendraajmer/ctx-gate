'use strict';

// `ctx-gate configure` — lets a developer answer (or re-answer) one of the
// `ctx-gate init` standing questions, or add a feature-word mapping,
// without re-running init or hand-editing YAML. Read-modify-write over the
// same standing.yml/features.yml files init writes, so `check` picks up
// the change immediately.

const store = require('../memory/store');
const { STANDING_QUESTION_DEFS } = require('./standingQuestions');
const { emptyStanding, emptyFeatures } = require('../memory/schema');

/**
 * @param {string} repoRoot
 * @returns {{ standing: Array<{id: string, prompt: string, value: string, status: string}>, features: Array<{word: string, paths: string[]}> }}
 */
function listConfigurable(repoRoot) {
  const standing = store.readStanding(repoRoot);
  const byId = Object.fromEntries(((standing && standing.entries) || []).map((e) => [e.id, e]));

  const standingRows = STANDING_QUESTION_DEFS.map((q) => {
    const entry = byId[q.id];
    if (entry) {
      return { id: q.id, prompt: q.prompt, value: entry.value || '', status: entry.status };
    }
    const def = q.defaultValue ? q.defaultValue(repoRoot) : '';
    return { id: q.id, prompt: q.prompt, value: def || '', status: 'default' };
  });

  const features = store.readFeatures(repoRoot);
  const featureRows = ((features && features.mappings) || []).map((m) => ({ word: m.word, paths: m.paths }));

  return { standing: standingRows, features: featureRows };
}

/**
 * @param {string} repoRoot
 * @param {string} id - a STANDING_QUESTION_DEFS id, e.g. "logging-convention"
 * @param {string} value
 * @returns {{ id: string, slot: string, value: string, status: string }}
 * @throws {Error} if id isn't a known standing question id
 */
function setStandingAnswer(repoRoot, id, value) {
  const def = STANDING_QUESTION_DEFS.find((q) => q.id === id);
  if (!def) {
    const known = STANDING_QUESTION_DEFS.map((q) => q.id).join(', ');
    throw new Error(`Unknown id "${id}". Known ids: ${known}`);
  }

  const standing = store.readStanding(repoRoot) || emptyStanding();
  const now = new Date().toISOString();
  const existing = standing.entries.find((e) => e.id === id);
  const entry = { id, slot: def.slot, value, status: 'confirmed', hits: existing ? existing.hits : 0, created_at: existing ? existing.created_at : now, last_seen: now };

  if (existing) {
    Object.assign(existing, entry);
  } else {
    standing.entries.push(entry);
  }
  store.writeStanding(repoRoot, standing);
  return entry;
}

/**
 * @param {string} repoRoot
 * @param {string} word
 * @param {string} folderPath
 * @returns {{ word: string, paths: string[] }}
 */
function setFeatureMapping(repoRoot, word, folderPath) {
  const features = store.readFeatures(repoRoot) || emptyFeatures();
  const existing = features.mappings.find((m) => m.word === word);
  if (existing) {
    if (!existing.paths.includes(folderPath)) existing.paths.push(folderPath);
  } else {
    features.mappings.push({ word, paths: [folderPath] });
  }
  store.writeFeatures(repoRoot, features);
  return features.mappings.find((m) => m.word === word);
}

module.exports = { listConfigurable, setStandingAnswer, setFeatureMapping };
