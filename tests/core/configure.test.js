'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const store = require('../../src/memory/store');
const { listConfigurable, setStandingAnswer } = require('../../src/core/configure');

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-gate-configure-'));
}

test('listConfigurable falls back to each question def default when standing.yml does not exist yet', () => {
  const dir = tmpRepo();
  try {
    const { standing } = listConfigurable(dir);
    const acceptance = standing.find((r) => r.id === 'done-means');
    assert.equal(acceptance.value, 'tests pass + CI green');
    assert.equal(acceptance.status, 'default');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('listConfigurable reflects an already-answered entry from standing.yml', () => {
  const dir = tmpRepo();
  try {
    store.writeStanding(dir, {
      version: 1,
      entries: [{ id: 'logging-convention', slot: 'logging', value: 'pino, one JSON line per request', status: 'confirmed', hits: 0 }],
    });
    const { standing } = listConfigurable(dir);
    const logging = standing.find((r) => r.id === 'logging-convention');
    assert.equal(logging.value, 'pino, one JSON line per request');
    assert.equal(logging.status, 'confirmed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('setStandingAnswer creates standing.yml from scratch when it does not exist', () => {
  const dir = tmpRepo();
  try {
    const entry = setStandingAnswer(dir, 'done-means', 'shipped behind a flag + smoke-tested');
    assert.equal(entry.status, 'confirmed');
    assert.equal(entry.slot, 'acceptance');

    const onDisk = store.readStanding(dir);
    assert.equal(onDisk.entries.length, 1);
    assert.equal(onDisk.entries[0].value, 'shipped behind a flag + smoke-tested');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('setStandingAnswer overwrites an existing entry for the same id, preserving hits/created_at', () => {
  const dir = tmpRepo();
  try {
    store.writeStanding(dir, {
      version: 1,
      entries: [{ id: 'logging-convention', slot: 'logging', value: 'old value', status: 'default', hits: 4, created_at: '2020-01-01T00:00:00.000Z' }],
    });
    const entry = setStandingAnswer(dir, 'logging-convention', 'new value');
    assert.equal(entry.value, 'new value');
    assert.equal(entry.hits, 4);
    assert.equal(entry.created_at, '2020-01-01T00:00:00.000Z');

    const onDisk = store.readStanding(dir);
    assert.equal(onDisk.entries.length, 1);
    assert.equal(onDisk.entries[0].value, 'new value');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('setStandingAnswer rejects an unknown id', () => {
  const dir = tmpRepo();
  try {
    assert.throws(() => setStandingAnswer(dir, 'not-a-real-id', 'x'), /Unknown id "not-a-real-id"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
