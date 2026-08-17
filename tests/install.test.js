'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Readable, Writable } = require('node:stream');

const { init } = require('../src/core/init');
const { fakeMcpClient } = require('./helpers/fakeMcpClient');

const REPO_ROOT = path.join(__dirname, '..');

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

test(
  'install.ps1 installs to a fake USERPROFILE and writes .github/hooks/ctx-gate.json into an already-init\'d target repo',
  { skip: process.platform !== 'win32' ? 'install.ps1 only runs on Windows' : false },
  async () => {
    const targetRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-gate-install-target-'));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-gate-fake-home-'));
    try {
      // Pre-init in-process (paced fake streams) so install.ps1's own
      // `ctx-gate init` call hits the idempotent no-prompt path — avoids
      // the known readline burst-consumption issue with piped/closed
      // stdin three processes deep (bash test runner -> powershell.exe -> node).
      await init(targetRepo, { streams: silentStreams(), mcp: { client: fakeMcpClient() } });
      const standingBefore = fs.readFileSync(path.join(targetRepo, '.context-ops', 'memory', 'standing.yml'), 'utf8');

      const version = fs.readFileSync(path.join(REPO_ROOT, 'VERSION'), 'utf8').trim();

      const result = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(REPO_ROOT, 'install.ps1')],
        {
          cwd: targetRepo,
          env: { ...process.env, USERPROFILE: fakeHome },
          input: '',
          encoding: 'utf8',
          timeout: 60000,
        }
      );

      assert.equal(result.status, 0, `install.ps1 failed:\nSTDOUT: ${result.stdout}\nSTDERR: ${result.stderr}`);

      // .context-ops was already fully initialized and must not be re-prompted.
      const standingAfter = fs.readFileSync(path.join(targetRepo, '.context-ops', 'memory', 'standing.yml'), 'utf8');
      assert.equal(standingAfter, standingBefore);

      // Installed into the fake USERPROFILE, not the real one.
      const versionDir = path.join(fakeHome, '.ctx-gate', version);
      assert.ok(fs.existsSync(path.join(versionDir, 'bin', 'ctx-gate.js')));
      assert.ok(fs.existsSync(path.join(versionDir, 'src')));
      assert.equal(fs.readFileSync(path.join(fakeHome, '.ctx-gate', 'current.txt'), 'utf8').trim(), version);

      // hooks.json landed with the powershell entries resolved to the real install path.
      const hooksPath = path.join(targetRepo, '.github', 'hooks', 'ctx-gate.json');
      assert.ok(fs.existsSync(hooksPath));
      const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
      const resolvedVersionDir = versionDir.replace(/\\/g, '/');
      assert.match(hooks.hooks.userPromptSubmitted[0].powershell, new RegExp(`^${resolvedVersionDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/bin/ctx-gate\\.ps1 check$`));
      assert.equal(hooks.hooks.preToolUse[0].powershell, `${resolvedVersionDir}/bin/ctx-gate.ps1 enforce`);
      // bash entries are left as the ~/.ctx-gate/current template — only meaningful under install.sh.
      assert.equal(hooks.hooks.postToolUse[0].bash, '~/.ctx-gate/current/bin/ctx-gate learn');
    } finally {
      fs.rmSync(targetRepo, { recursive: true, force: true });
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  }
);

test('install.sh has valid bash syntax (best-effort only — not executed on real Linux/macOS here)', () => {
  const result = spawnSync('bash', ['-n', path.join(REPO_ROOT, 'install.sh')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
