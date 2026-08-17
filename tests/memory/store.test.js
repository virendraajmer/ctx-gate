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
