'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');

const { init } = require('../../src/core/init');
const { fakeMcpClient } = require('../helpers/fakeMcpClient');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

function copyFixture(name) {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-gate-'));
  fs.cpSync(path.join(FIXTURES, name), dest, { recursive: true });
  return dest;
}

// Scripts blank-line answers so the standing/feature readline prompts
// resolve with their defaults instead of blocking on real stdin during
// tests. Lines are pushed one per macrotask (setImmediate) rather than
// all at once, since readline drops any lines that arrive before the
// matching `.question()` call is listening and closes prematurely once
// the input stream ends.
function silentStreams(blankLines = 10) {
  let remaining = blankLines;
  const input = new Readable({
    read() {
      setImmediate(() => {
        if (remaining <= 0) {
          this.push(null);
        } else {
          remaining -= 1;
          this.push('\n');
        }
      });
    },
  });
  const output = new Writable({
    write(chunk, enc, cb) {
      cb();
    },
  });
  return { input, output };
}

test('init detects node+react and writes manifest.json', async () => {
  const dir = copyFixture('node-react-basic');
  try {
    const { manifest, standing, glossary, learned, mcpAvailable, mcpGuidance } = await init(dir, { streams: silentStreams(), mcp: { client: fakeMcpClient() } });
    assert.equal(manifest.stacks.node.detected, true);
    assert.equal(manifest.stacks.node.packageManager, 'pnpm');
    assert.equal(manifest.stacks.react.detected, true);
    assert.equal(manifest.stacks.react.router, 'react-router');
    assert.equal(manifest.stacks.react.screens.length, 2);
    assert.equal(standing.entries.length, 6);
    assert.deepEqual(learned, { version: 1, patterns: [] });
    assert.equal(fs.existsSync(path.join(dir, '.context-ops', 'memory', 'learned.yml')), true);
    assert.equal(typeof mcpAvailable, 'boolean');
    assert.equal(mcpGuidance, mcpAvailable ? null : mcpGuidance);
    if (!mcpAvailable) {
      assert.match(mcpGuidance, /codebase-memory-mcp not found on PATH/);
    }

    assert.equal(glossary.version, 1);
    assert.ok(glossary.terms.length > 0);
    // Every seeded candidate stays 'candidate' when the developer answers
    // blank (silentStreams) — nothing is ever auto-confirmed on their behalf.
    assert.ok(glossary.terms.every((t) => t.status === 'candidate'));
    assert.equal(fs.existsSync(path.join(dir, '.context-ops', 'memory', 'glossary.yml')), true);

    const onDisk = JSON.parse(
      fs.readFileSync(path.join(dir, '.context-ops', 'manifest.json'), 'utf8')
    );
    assert.equal(onDisk.stacks.node.packageManager, 'pnpm');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('init re-run does not re-seed glossary.yml once it already exists', async () => {
  const dir = copyFixture('node-react-basic');
  try {
    await init(dir, { streams: silentStreams(), mcp: { client: fakeMcpClient() } });
    const store = require('../../src/memory/store');
    const glossary = store.readGlossary(dir);
    glossary.terms.push({ term: 'custom', aka: [], definition: 'developer-added', paths: [], status: 'confirmed', hits: 0 });
    store.writeGlossary(dir, glossary);

    await init(dir, { streams: silentStreams(), mcp: { client: fakeMcpClient() } });
    const onDisk = store.readGlossary(dir);
    assert.ok(onDisk.terms.some((t) => t.term === 'custom'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('init detects python fastapi and lifts endpoints to manifest.endpoints', async () => {
  const dir = copyFixture('python-fastapi-basic');
  try {
    const { manifest } = await init(dir, { streams: silentStreams(), mcp: { client: fakeMcpClient() } });
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
    const { manifest } = await init(dir, { streams: silentStreams(), mcp: { client: fakeMcpClient() } });
    assert.equal(manifest.stacks.dotnet.detected, true);
    assert.equal(manifest.stacks.dotnet.projects.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('init on an empty repo detects nothing but still writes a manifest', async () => {
  const dir = copyFixture('empty-repo');
  try {
    const { manifest } = await init(dir, { streams: silentStreams(), mcp: { client: fakeMcpClient() } });
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
