'use strict';

// Injectable stand-in for codebaseMemoryClient's real spawned process, so
// tests exercise init()'s auto-index-on-init path without spawning a real
// codebase-memory-mcp subprocess (slow, and only present on some machines).

function fakeMcpClient() {
  return {
    proc: null,
    request: async () => ({ result: { ok: true } }),
  };
}

module.exports = { fakeMcpClient };
