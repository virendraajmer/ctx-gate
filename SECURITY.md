# Security

> **Status: stub.** This will be expanded once the Requirement Gate and
> install scripts (Phases 3, 6, 8 of the build plan) are implemented.

ctx-gate installs local shell hooks that execute on every developer
prompt inside repos that adopt it, and its optional `codebase-memory-mcp`
integration reads full source-tree contents (though it always stays
local — no network calls, no data leaves the machine). Because of this:

- **Before company-wide rollout**, this tool — and specifically the
  `.github/hooks/*.json` hook scripts and the `codebase-memory-mcp`
  integration — should go through internal security review.
- `codebase-memory-mcp` is never installed automatically by ctx-gate, on
  any OS, at any point (see `src/core/init.js`). ctx-gate only prints
  manual installation guidance and checks whether the binary is already
  present.
- All Requirement Gate logic (`gate.js`, `learn.js`, `enforce.js`) is
  fully deterministic — no LLM calls, no network calls. Everything reads
  from and writes to local files inside the target repo only.
- If a hook script errors, it fails silently from the developer's point
  of view (logs to `.context-ops/logs/`, exits 0) — a broken gate must
  never block normal Copilot usage.

Report suspected security issues to your internal security team per your
organization's standard process before this tool is used outside of a
trusted pilot repo.
