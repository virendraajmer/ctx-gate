#!/usr/bin/env node
'use strict';

// CLI entrypoint. Dispatches subcommands. For hook-driven subcommands
// (check/learn/enforce) this is also where the active adapter is
// resolved and where stdin JSON is translated to/from the normalized
// CheckRequest/LearnRequest/EnforceRequest shapes — src/core/*.js never
// sees a hook-specific payload directly.
//
// Per the non-blocking-safe requirement, hook subcommands must never
// throw to the caller: failures are logged to .context-ops/logs/ and the
// process exits 0 regardless.

const fs = require('fs');
const path = require('path');

const VERSION_FILE = path.join(__dirname, '..', 'VERSION');

function printVersion() {
  const version = fs.readFileSync(VERSION_FILE, 'utf8').trim();
  process.stdout.write(`ctx-gate ${version}\n`);
}

function resolveAdapterName() {
  // --agent flag > CTX_GATE_AGENT env > config.yml#adapters.active > default
  const flagIndex = process.argv.indexOf('--agent');
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) {
    return process.argv[flagIndex + 1];
  }
  if (process.env.CTX_GATE_AGENT) {
    return process.env.CTX_GATE_AGENT;
  }
  // TODO: once src/memory/store.js#readConfig is implemented, read
  // config.yml#adapters.active here before falling back to the default.
  return 'copilot';
}

async function main(argv) {
  const [, , command, ...rest] = argv;

  if (!command || command === '--version' || command === '-v') {
    printVersion();
    return;
  }

  switch (command) {
    case 'init': {
      const { init } = require('../src/core/init');
      const repoRoot = process.cwd();
      const { manifest, standing, features } = await init(repoRoot);
      process.stdout.write('ctx-gate: wrote .context-ops/manifest.json\n');
      process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
      process.stdout.write('ctx-gate: wrote .context-ops/memory/standing.yml\n');
      process.stdout.write(`${JSON.stringify(standing, null, 2)}\n`);
      process.stdout.write('ctx-gate: wrote .context-ops/memory/features.yml\n');
      process.stdout.write(`${JSON.stringify(features, null, 2)}\n`);
      return;
    }
    case 'check':
    case 'learn':
    case 'enforce':
    case 'optimize':
    case 'review':
    case 'mcp-check':
      throw new Error(`'${command}' is not implemented yet`);
    default:
      process.stderr.write(`Unknown command: ${command}\n`);
      process.exitCode = 1;
  }
}

main(process.argv).catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exitCode = 1;
});
