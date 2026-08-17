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

test('writeFeatures/readFeatures round-trip through YAML', () => {
  const dir = tmpRepo();
  try {
    const features = { version: 1, mappings: [{ word: 'orders', paths: ['src/features/orders'] }] };
    store.writeFeatures(dir, features);

    assert.deepEqual(store.readFeatures(dir), features);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readFeatures returns null before writeFeatures is ever called', () => {
  const dir = tmpRepo();
  try {
    assert.equal(store.readFeatures(dir), null);
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
