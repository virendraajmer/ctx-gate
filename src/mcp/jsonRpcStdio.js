'use strict';

// Shared newline-delimited JSON-RPC-over-stdio transport, used by
// src/mcp/codebaseMemoryClient.js (talks to the codebase-memory-mcp binary
// specifically) and src/mcp/mcpAudit.js (talks to any server declared in a
// target repo's .vscode/mcp.json). Extracted here per the addon-5 spec's
// own instruction not to write a second JSON-RPC implementation.

const { spawn: nodeSpawn } = require('child_process');

/**
 * Spawns `command` with `args`/`env` and wires up newline-delimited
 * JSON-RPC framing over stdio.
 *
 * @param {Object} opts
 * @param {string} opts.command
 * @param {string[]} [opts.args]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string} [opts.cwd]
 * @param {Function} [opts.spawn] injectable replacement for child_process.spawn (tests)
 * @param {(chunk: string) => void} [opts.onStderr]
 * @returns {{ proc: import('child_process').ChildProcess, request: (method: string, params?: Object) => Promise<Object> }}
 */
function spawnJsonRpcClient(opts = {}) {
  const spawnFn = opts.spawn || nodeSpawn;
  const spawnOpts = { stdio: ['pipe', 'pipe', 'pipe'] };
  if (opts.env) spawnOpts.env = opts.env;
  if (opts.cwd) spawnOpts.cwd = opts.cwd;
  const proc = spawnFn(opts.command, opts.args || [], spawnOpts);

  let buffer = '';
  const pending = new Map();
  let nextId = 1;

  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx = buffer.indexOf('\n');
    while (idx !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      idx = buffer.indexOf('\n');
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const resolver = pending.get(msg.id);
      if (resolver) {
        pending.delete(msg.id);
        resolver(msg);
      }
    }
  });

  if (proc.stderr && opts.onStderr) {
    proc.stderr.on('data', (chunk) => opts.onStderr(chunk.toString('utf8')));
  }

  function request(method, params) {
    const id = nextId;
    nextId += 1;
    const payload = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      proc.stdin.write(payload);
    });
  }

  return { proc, request };
}

/**
 * Kills the underlying process, but only if this call spawned it itself
 * (never kills an injected test/stub client).
 *
 * @param {{ proc: Object }} client
 * @param {{ client?: Object }} opts
 */
function killIfOwned(client, opts) {
  if (!opts.client && client.proc && !client.proc.killed) {
    client.proc.kill();
  }
}

module.exports = { spawnJsonRpcClient, killIfOwned };
