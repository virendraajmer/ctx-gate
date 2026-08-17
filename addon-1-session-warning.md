# Add-On Prompt 1 for Claude Code — Long-Session Cost Warning + `ctx-gate stats`

Paste into Claude Code at the root of your existing `ctx-gate` repo. This is
an addition to work already in progress — do not regenerate existing files.

---

## PROMPT START

You are adding a feature to the existing `ctx-gate` tool in this repo. Read
the current code first and fit into its existing structure and conventions —
do not restructure anything, do not rewrite existing modules, and do not
change any existing behaviour.

### Why this feature exists

Copilot resends the entire conversation history on every turn. So a long
chat session costs non-linearly: turn 30 pays for turns 1-29 again. Starting
a new chat per task is the single largest everyday saving available, but
developers don't notice a session getting expensive. This feature makes it
visible.

### What to build

**1. Session cost tracking (in `src/core/learn.js`, the `postToolUse` hook)**

Maintain `.context-ops/state/<sessionId>.json`:

```json
{
  "sessionId": "...",
  "turnCount": 0,
  "filesRead": [],
  "estimatedBytesRead": 0,
  "warningsEmitted": 0,
  "startedAt": "<iso>",
  "lastSeenAt": "<iso>"
}
```

- Update on every `learn` invocation.
- `filesRead` is a de-duplicated list — also useful for spotting re-reads.
- On each run, delete state files whose `lastSeenAt` is older than 7 days so
  the folder doesn't grow forever.
- Add `.context-ops/state/` to the target repo's `.gitignore` during `init`
  (extend the existing gitignore logic in `init.js`, don't duplicate it).

**2. The warning (in `src/core/gate.js`, the `userPromptSubmitted` hook)**

Important: do NOT use the `sessionStart` hook for this. At session start
there are zero turns, so it cannot know the session will get long. The
counting happens in `learn.js`, the warning is emitted from `gate.js`, which
fires on every prompt.

Logic:
- Read the current session's state file. If absent, do nothing.
- Compute a cost estimate from `turnCount` and `estimatedBytesRead`
  together — not turn count alone. Five turns that read large files cost
  more than fifteen short exchanges, so a pure turn threshold misfires in
  both directions.
- Emit **at most two warnings per session**: one soft, one firmer. Track
  this via `warningsEmitted`. A warning shown on every turn gets ignored,
  and an ignored warning is worse than none.
- Soft warning text should state the actual mechanism, not just "this is
  long" — e.g. that each new message now resends the prior conversation,
  and suggest starting a fresh chat for the next task.
- The hook can only advise. It cannot open, close, or clear a chat. Do not
  write text implying it can.

**3. Config (extend the existing `.context-ops/config.yml` schema)**

Add, with sensible defaults, documented in the generated config file:
- `sessionWarnAt` — soft threshold
- `sessionWarnHardAt` — firm threshold
- `sessionWarnings: true` — allow a team to turn the feature off entirely

**4. `ctx-gate stats` (new manual command, not a hook)**

Reads the session state files and reports locally-computed numbers:
- Median and max turns per session this week
- Sessions that crossed each threshold
- Files most frequently re-read across sessions (a signal that the
  optimizer or the gate is missing context those tasks needed)

Use the real tokenizer already wired into `src/tokenBudget.js` for any token
figure. Never print an estimated number that was not actually computed — if
something can't be measured, print "not measured".

### Constraints

- Zero LLM calls. All of this is file reads, counters, and arithmetic.
- `gate.js` must stay under ~2 seconds; reading one small JSON file is fine,
  but do not scan the whole state directory on the hook path — only in
  `ctx-gate stats`.
- If the state file is missing or corrupt, log to `.context-ops/logs/` and
  exit 0. This feature must never break someone's normal Copilot usage.
- Unit tests: threshold arithmetic, the two-warning cap, the 7-day cleanup,
  and corrupt-state-file handling.

### Deliverables

- [ ] State file written and updated correctly across simulated turns
- [ ] Warning fires on cost estimate, capped at two per session
- [ ] `sessionWarnings: false` fully disables it
- [ ] `ctx-gate stats` reports only computed numbers
- [ ] `.context-ops/state/` gitignored by `init`

## PROMPT END
