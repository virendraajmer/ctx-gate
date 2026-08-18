'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const store = require('../../src/memory/store');

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-gate-store-'));
}

test('readStanding returns null before writeStanding is ever called', () => {
  const dir = tmpRepo();
  try {
    assert.equal(store.readStanding(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeStanding/readStanding round-trip through YAML', () => {
  const dir = tmpRepo();
  try {
    const standing = {
      version: 1,
      entries: [
        {
          id: 'done-means',
          slot: 'acceptance',
          value: 'tests pass + CI green',
          status: 'confirmed',
          hits: 0,
          created_at: '2026-08-17T00:00:00.000Z',
          last_seen: null,
        },
      ],
    };
    store.writeStanding(dir, standing);

    const onDisk = fs.readFileSync(path.join(dir, '.context-ops', 'memory', 'standing.yml'), 'utf8');
    assert.match(onDisk, /id: done-means/);

    assert.deepEqual(store.readStanding(dir), standing);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeGlossary/readGlossary round-trip through YAML', () => {
  const dir = tmpRepo();
  try {
    const glossary = {
      version: 1,
      terms: [{ term: 'orders', aka: [], definition: 'Placed customer orders.', paths: ['src/features/orders'], status: 'confirmed', hits: 0 }],
    };
    store.writeGlossary(dir, glossary);

    assert.deepEqual(store.readGlossary(dir), glossary);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readGlossary returns null before writeGlossary is ever called', () => {
  const dir = tmpRepo();
  try {
    assert.equal(store.readGlossary(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeLearned/readLearned round-trip through YAML', () => {
  const dir = tmpRepo();
  try {
    const learned = {
      version: 1,
      patterns: [
        {
          id: 'sorting-defaults-to-orders',
          trigger: { keywords: ['sorting'], noScreenNamed: true },
          suggestion: { screen: 'Orders' },
          confidence: 'learned',
          occurrences: 3,
          last_seen: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    store.writeLearned(dir, learned);
    assert.deepEqual(store.readLearned(dir), learned);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readLearned returns null before writeLearned is ever called', () => {
  const dir = tmpRepo();
  try {
    assert.equal(store.readLearned(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('appendAnswerLine/readAnswersLog round-trip newline-delimited JSON', () => {
  const dir = tmpRepo();
  try {
    assert.deepEqual(store.readAnswersLog(dir), []);
    store.appendAnswerLine(dir, { timestamp: 't1', sessionId: 's1' });
    store.appendAnswerLine(dir, { timestamp: 't2', sessionId: 's2' });
    assert.deepEqual(store.readAnswersLog(dir), [
      { timestamp: 't1', sessionId: 's1' },
      { timestamp: 't2', sessionId: 's2' },
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeSessionCache/readSessionCache round-trip through JSON', () => {
  const dir = tmpRepo();
  try {
    assert.deepEqual(store.readSessionCache(dir), {});
    const cache = { s1: { checked: true, prompt: 'add validation' } };
    store.writeSessionCache(dir, cache);
    assert.deepEqual(store.readSessionCache(dir), cache);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readConfig returns nulls before any config is written', () => {
  const dir = tmpRepo();
  try {
    assert.deepEqual(store.readConfig(dir), { team: null, local: null });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeTeamConfig/writeLocalConfig round-trip independently through readConfig', () => {
  const dir = tmpRepo();
  try {
    store.writeTeamConfig(dir, { version: 1, enforcement: 'off', adapters: { active: 'copilot' } });
    store.writeLocalConfig(dir, { version: 1, enforcement: 'block' });
    const { team, local } = store.readConfig(dir);
    assert.equal(team.enforcement, 'off');
    assert.equal(local.enforcement, 'block');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ensureGitignoreEntries creates .gitignore with the given entries when absent', () => {
  const dir = tmpRepo();
  try {
    store.ensureGitignoreEntries(dir, ['.context-ops/config.local.yml', '.context-ops/logs/']);
    const contents = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    assert.match(contents, /\.context-ops\/config\.local\.yml/);
    assert.match(contents, /\.context-ops\/logs\//);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readSessionState returns null before writeSessionState is ever called', () => {
  const dir = tmpRepo();
  try {
    assert.equal(store.readSessionState(dir, 's1'), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeSessionState/readSessionState round-trip through JSON', () => {
  const dir = tmpRepo();
  try {
    const state = {
      sessionId: 's1',
      turnCount: 3,
      filesRead: ['src/a.js'],
      fileReadCounts: { 'src/a.js': 3 },
      estimatedBytesRead: 1500,
      warningsEmitted: 0,
      startedAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:10:00.000Z',
    };
    store.writeSessionState(dir, 's1', state);
    assert.deepEqual(store.readSessionState(dir, 's1'), state);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readSessionState throws on a corrupt state file so the hook-path caller can log and continue', () => {
  const dir = tmpRepo();
  try {
    fs.mkdirSync(path.join(dir, '.context-ops', 'state'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.context-ops', 'state', 's1.json'), '{ not valid json', 'utf8');
    assert.throws(() => store.readSessionState(dir, 's1'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('listSessionStates skips corrupt state files instead of throwing', () => {
  const dir = tmpRepo();
  try {
    store.writeSessionState(dir, 's1', { sessionId: 's1', turnCount: 1 });
    fs.writeFileSync(path.join(dir, '.context-ops', 'state', 's2.json'), '{ not valid json', 'utf8');
    const entries = store.listSessionStates(dir);
    assert.deepEqual(
      entries.map((e) => e.sessionId),
      ['s1']
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('listSessionStates returns [] when the state directory does not exist', () => {
  const dir = tmpRepo();
  try {
    assert.deepEqual(store.listSessionStates(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deleteSessionStateFile removes the file and is a no-op if already gone', () => {
  const dir = tmpRepo();
  try {
    store.writeSessionState(dir, 's1', { sessionId: 's1', turnCount: 1 });
    store.deleteSessionStateFile(dir, 's1');
    assert.equal(store.readSessionState(dir, 's1'), null);
    assert.doesNotThrow(() => store.deleteSessionStateFile(dir, 's1'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeTeamConfig annotates the session-warning keys with explanatory comments', () => {
  const dir = tmpRepo();
  try {
    const schema = require('../../src/memory/schema');
    store.writeTeamConfig(dir, schema.defaultTeamConfig());
    const onDisk = fs.readFileSync(path.join(dir, '.context-ops', 'config.yml'), 'utf8');
    assert.match(onDisk, /# Soft long-session warning threshold[\s\S]*sessionWarnAt:/);
    assert.match(onDisk, /# Set to false to disable the long-session cost warning entirely\.\nsessionWarnings:/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readUnknownTerms returns {} before writeUnknownTerms is ever called', () => {
  const dir = tmpRepo();
  try {
    assert.deepEqual(store.readUnknownTerms(dir), {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeUnknownTerms/readUnknownTerms round-trip through JSON', () => {
  const dir = tmpRepo();
  try {
    const state = { reconciliation: { term: 'reconciliation', sessions: ['s1', 's2'], firstSeen: 't1', lastSeen: 't2' } };
    store.writeUnknownTerms(dir, state);
    assert.deepEqual(store.readUnknownTerms(dir), state);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ensureGitignoreEntries is idempotent and preserves existing lines', () => {
  const dir = tmpRepo();
  try {
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n', 'utf8');
    store.ensureGitignoreEntries(dir, ['.context-ops/config.local.yml']);
    store.ensureGitignoreEntries(dir, ['.context-ops/config.local.yml']);
    const lines = fs
      .readFileSync(path.join(dir, '.gitignore'), 'utf8')
      .split('\n')
      .filter(Boolean);
    assert.deepEqual(lines, ['node_modules/', '.context-ops/config.local.yml']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
