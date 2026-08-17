# hooks.json field names — unverified against preview schema

GitHub Copilot's agent hooks are in preview as of when this template was
written. The event names (`userPromptSubmitted`, `postToolUse`,
`preToolUse`), the command entry shape (`type`/`bash`/`powershell`/
`timeout`), and the stdin/stdout payload fields are all best-effort
guesses based on the available documentation at the time.

Before relying on this in production:

1. Verify these field names against the current VS Code Copilot agent
   hooks reference.
2. Check the `TODO(hooks-preview)` comments in `src/adapters/copilot.js`
   — that is the only file that needs to change if the schema has moved.

The `preToolUse` entry is always included (see `src/core/enforce.js`
design notes) — enforcement level is decided at runtime by `ctx-gate
enforce`, not by whether this entry is present in the file, so it's safe
to ship even when a repo's enforcement level is `off`.
