'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { init } = require('../../src/core/init');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

function copyFixture(name) {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-gate-'));
  fs.cpSync(path.join(FIXTURES, name), dest, { recursive: true });
  return dest;
}

test('init detects node+react and writes manifest.json', async () => {
  const dir = copyFixture('node-react-basic');
  try {
    const manifest = await init(dir);
    assert.equal(manifest.stacks.node.detected, true);
    assert.equal(manifest.stacks.node.packageManager, 'pnpm');
    assert.equal(manifest.stacks.react.detected, true);
    assert.equal(manifest.stacks.react.router, 'react-router');
    assert.equal(manifest.stacks.react.screens.length, 2);

    const onDisk = JSON.parse(
      fs.readFileSync(path.join(dir, '.context-ops', 'manifest.json'), 'utf8')
    );
    assert.equal(onDisk.stacks.node.packageManager, 'pnpm');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('init detects python fastapi and lifts endpoints to manifest.endpoints', async () => {
  const dir = copyFixture('python-fastapi-basic');
  try {
    const manifest = await init(dir);
    assert.equal(manifest.stacks.python.detected, true);
    assert.equal(manifest.stacks.python.framework, 'fastapi');
    assert.equal(manifest.stacks.python.endpoints, undefined);
    assert.equal(manifest.endpoints.length, 2);
    assert.ok(
      manifest.endpoints.some((e) => e.method === 'GET' && e.route === '/api/orders')
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('init detects a dotnet project', async () => {
  const dir = copyFixture('dotnet-basic');
  try {
    const manifest = await init(dir);
    assert.equal(manifest.stacks.dotnet.detected, true);
    assert.equal(manifest.stacks.dotnet.projects.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('init on an empty repo detects nothing but still writes a manifest', async () => {
  const dir = copyFixture('empty-repo');
  try {
    const manifest = await init(dir);
    assert.equal(manifest.stacks.node.detected, false);
    assert.equal(manifest.stacks.react.detected, false);
    assert.equal(manifest.stacks.python.detected, false);
    assert.equal(manifest.stacks.dotnet.detected, false);
    assert.equal(manifest.endpoints.length, 0);
    assert.ok(fs.existsSync(path.join(dir, '.context-ops', 'manifest.json')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
