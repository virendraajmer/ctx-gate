# Prompt for Claude Code (VS Code) — Build "ctx-gate": Company-Wide Context Optimizer + Requirement Gate

This is a build prompt, not a one-shot request. Paste the whole thing into
Claude Code inside VS Code, at the root of a **new, empty repo** you will
publish internally (e.g. `yourcompany/ctx-gate`). Claude Code should work
through the phases in order and stop for confirmation between phases marked
"STOP" — do not let it run all phases unattended in one go.

---

## PROMPT START

You are building a shared internal developer tool called **ctx-gate**. It
will be installed by developers across many repos in a company (stacks:
TypeScript/React frontends, Python backends, .NET backends — often React +
.NET together in the same repo). One tool, published from this repo, used
everywhere. Each repo that installs it keeps its own private memory —
memory is never shared across repos, only within a repo's own team via git.

### What ctx-gate does (two capabilities in one tool)

**A. Context Optimizer** — scans a target repo and writes token-optimized
context files that GitHub Copilot loads automatically: `AGENTS.md` (always
loaded), `.github/instructions/*.instructions.md` (loaded only when the
edited file path matches the `applyTo` glob), and `.github/skills/*/SKILL.md`
(loaded only when the task matches the skill description). Run rarely
(monthly), on-demand via `ctx-gate optimize`.

**B. Requirement Gate** — a set of local, zero-token scripts wired into
Copilot's agent hooks (`.github/hooks/*.json`). When a developer types a
request in Copilot Chat, a hook fires a local script *before* Copilot
starts working. The script checks whether the request is clear enough,
using only local data (no LLM calls), and if not, tells Copilot what
clarifying questions to ask. It gets smarter over time by recording answers
and promoting repeated patterns into permanent memory.

### Non-negotiable design constraints

- **No fabricated numbers anywhere.** Never have any part of this tool
  claim a token count without actually computing it (use a real tokenizer
  library, e.g. `tiktoken` equivalent for Node, or `gpt-tokenizer` npm
  package). If a count can't be computed, say "not measured," never guess.
- **Zero LLM calls in the Requirement Gate.** Everything in `gate.js`,
  `learn.js`, and `enforce.js` must be deterministic: regex, word lists,
  file lookups, JSON reads, git diff parsing. If you find yourself wanting
  to call a model to decide something, stop — redesign it as a rule.
- **The tool is language-agnostic. The memory is per-repo.** Never build
  a central database of learned patterns. All memory lives inside the
  target repo, in files that get committed to that repo's own git history.
- **Never overwrite silently.** Every file the Context Optimizer writes
  must be diffed against any existing version and shown as a diff, never
  force-overwritten.
- **Budget limits are enforced, not suggested.** `AGENTS.md` ≤ ~1500
  tokens, each `.instructions.md` ≤ ~800 tokens, each `SKILL.md` ≤ ~1000
  tokens. If content doesn't fit, split it or fail loudly — don't silently
  exceed the budget.
- **Citations use paths and symbol names, never line numbers** (e.g.
  `src/api/order.ts#createOrder`, not `src/api/order.ts:142`) — line
  numbers rot within days.

---

## Phase 0 — Repo scaffold

Create this structure:

```
ctx-gate/
├── install.sh
├── install.ps1
├── VERSION
├── README.md
├── bin/
│   └── ctx-gate.js            # CLI entrypoint, dispatches subcommands
├── src/
│   ├── detectors/
│   │   ├── node.js
│   │   ├── python.js
│   │   ├── dotnet.js
│   │   └── react.js
│   ├── core/
│   │   ├── init.js            # `ctx-gate init`
│   │   ├── gate.js            # `ctx-gate check`  (userPromptSubmitted hook)
│   │   ├── learn.js           # `ctx-gate learn`  (postToolUse hook)
│   │   ├── enforce.js         # `ctx-gate enforce` (preToolUse hook, off by default)
│   │   └── optimize.js        # `ctx-gate optimize` (Context Optimizer)
│   ├── mcp/
│   │   └── codebaseMemoryClient.js   # talks to codebase-memory-mcp over stdio JSON-RPC
│   ├── memory/
│   │   ├── schema.js          # shape of manifest.json / standing.yml / learned.yml
│   │   └── store.js           # read/write helpers, all local file I/O
│   └── tokenBudget.js         # real tokenizer-based counting + budget checks
├── hook-templates/
│   └── hooks.json
└── tests/
    └── (unit tests per module, use Node's built-in test runner)
```

Use Node.js (works cross-platform, already present wherever VS Code/Copilot
runs). Set up `package.json` with a bin entry so `ctx-gate` resolves as a
CLI. Add a minimal test runner setup. **STOP here and show me the scaffold
before writing logic.**

---

## Phase 1 — Detectors (start with Node/React, most common stack)

Each detector is a pure function: given a repo root path, return a JSON
object of detected facts, or `null` if it doesn't apply. A repo can match
more than one detector (e.g. React frontend + .NET backend together).

**`node.js`** — detect via `package.json`. Extract: package manager
(npm/pnpm/yarn from lockfile presence), test command, build command,
lint/format config, dependency list.

**`react.js`** — only runs if `node.js` detected React as a dependency.
Parse React Router route definitions (or Next.js file-based routes) to
build a list of `{ name, route, path }` "screens." Best-effort: if routing
can't be statically resolved, fall back to folder names under
`src/screens/`, `src/pages/`, or similar conventional locations — flag
these as `"confidence": "low"` in the manifest rather than guessing
silently.

**`python.js`** — detect via `requirements.txt`, `pyproject.toml`, or
`Pipfile`. Extract: package manager, test command (pytest), framework
(FastAPI/Django/Flask — detect from imports), route/endpoint list if
FastAPI or Django (parse decorators/urls.py).

**`dotnet.js`** — detect via `*.csproj`/`*.sln`. Extract: test command
(`dotnet test`), controllers and `[Route]` attributes as an "endpoints"
list.

All detectors write into one combined `manifest.json` — see schema below.
Write unit tests for each detector against a small fixture repo (create
tiny fixture folders under `tests/fixtures/`, don't rely on a real repo).

**STOP here and let me run `ctx-gate init` against a real Node/React repo
to sanity check before continuing.**

---

## Phase 2 — Standing questions (`ctx-gate init`, interactive part)

After detectors run, ask the developer these questions in the terminal
(readline or `enquirer`/`prompts` package), only for slots the detectors
couldn't fill:

1. What does "done" mean here? (default suggestion: "tests pass + CI green")
2. Which paths are high-risk / need extra care? (suggest CODEOWNERS-derived
   list, let them edit)
3. What's the error-handling convention? (try to detect: do services throw,
   or return a Result/Either type? Ask to confirm.)
4. Any naming convention worth stating? (e.g. suffixes for services,
   reducers, controllers)
5. What does "performance" mean quantitatively here, if ever mentioned?
6. Logging convention?
7. Any words your team uses that map to specific folders? (seed
   `features.yml` — see Phase 4)

Write answers to `.context-ops/memory/standing.yml` with this shape:

```yaml
entries:
  - id: done-means
    slot: acceptance
    value: "..."
    status: confirmed
    hits: 0
    created_at: <iso date>
```

**STOP here, show me a real `standing.yml` from a test run.**

---

## Phase 3 — codebase-memory-mcp integration (guide only, never auto-install)

Write `src/mcp/codebaseMemoryClient.js`: spawns the `codebase-memory-mcp`
binary as a child process, speaks MCP JSON-RPC over stdio (send on stdin,
read newline-delimited JSON on stdout, errors to stderr only — never let
debug output touch stdout). Expose one function:
`searchCode(query) -> [{ symbol, path, kind }]`.

**Never install this binary automatically, at any point, on any OS.** It
reads the full source tree and is a third-party dependency — installing it
without a conscious decision is not acceptable, even inside `ctx-gate
init`. Instead:

1. During `ctx-gate init`, check whether `codebase-memory-mcp` is already
   on PATH.
2. If not found, print clear, OS-aware manual instructions and stop there
   — do not prompt "install now? y/n", just show the steps:
   - macOS/Linux: the exact `curl`/install command and a note that it
     needs a C compiler (Xcode CLT / `build-essential`) for tree-sitter.
   - Windows: a note that native support is unclear/limited and the
     recommended path is WSL2 — point to the Linux instructions inside
     WSL2, don't attempt anything on native Windows.
   - A one-line note to get this binary approved by internal security
     before installing on a company machine, since it reads full repo
     contents (even though it stays local).
3. Continue `ctx-gate init` regardless — the gate must be fully usable
   without this binary, just less precise (falls back to plain-text/ripgrep
   search over tracked files, see below).
4. Provide a separate command, `ctx-gate mcp-check`, the developer can run
   any time after installing it manually — this detects the binary, runs
   the initial index build, confirms the background watcher started, and
   reports success/failure. This is the only place indexing is triggered
   automatically — once the binary is present and confirmed, no further
   manual step is needed; the watcher keeps the index fresh on its own.

If the binary isn't installed, `gate.js` must fail gracefully every time:
log once per session ("codebase-memory-mcp not found — using plain text
search over tracked files, results will be less precise") and fall back to
a simple ripgrep-based text search. Never crash or block `ctx-gate check`
for this reason — the gate must be non-blocking-safe by default regardless
of whether this binary is present.

---

## Phase 4 — The Gate itself (`ctx-gate check`, the userPromptSubmitted hook)

Input: JSON on stdin matching the hook's payload (prompt text, session id,
cwd). Output: JSON on stdout that the agent uses as extra context (confirm
exact field name against the current hooks reference before finalizing —
note this explicitly as a TODO comment in the code since hooks are in
preview and the schema may shift).

Logic, in order:

1. **Skip short follow-ups.** If the prompt is very short (e.g. "yes",
   "continue", under ~4 words) or the session already had a check this
   session, skip full analysis — return empty context.
2. **Extract mentioned entities.** Compare words in the prompt against
   `manifest.json` screens/endpoints/entities. Also call
   `searchCode(prompt)` for semantic matches.
3. **Check `.context-ops/memory/features.yml`** (business-word → path
   mapping, seeded in Phase 2, grown over time) for a match on vague terms
   ("orders", "sorting", "the report page").
4. **Check `learned.yml`** for a prior pattern matching this request shape
   (see schema below) — if found, note it as a *suggested default*, not a
   silent assumption.
5. **Identify unknown slots**: scope (no path/screen found), acceptance
   criteria (no condition/number/test word found), and any vague word from
   a fixed list (`properly`, `handle it`, `as needed`, `optimize`, `etc`,
   `some`, `better`).
6. **Compose output**: list of matched paths/screens with confidence,
   relevant `standing.yml` rules, relevant `learned.yml` suggestions, and
   explicit questions Copilot should ask for each unknown slot.

Write this as pure functions with unit tests — this is the highest-value
module, test it thoroughly with a table of example prompts and expected
output.

---

## Phase 5 — Learning (`ctx-gate learn`, the postToolUse hook)

Input: JSON on stdin with tool name and file paths touched (from the
hook's `tool_input`). Steps:

1. Append `{ timestamp, sessionId, filesTouched }` to
   `.context-ops/memory/answers.jsonl`.
2. If the session's gate output (Phase 4) included questions and this is
   the first tool call after they were likely answered, also try to
   capture the answer text if available in the transcript — best effort,
   don't fail if not available.
3. **Promotion logic**: count occurrences of the same
   `(triggerPattern → answer)` pair in `answers.jsonl`. At 3 occurrences,
   write/update an entry in `learned.yml`:

```yaml
patterns:
  - id: sorting-defaults-to-orders
    trigger: { keywords: [sorting, sort order], noScreenNamed: true }
    suggestion: { screen: "Orders" }
    confidence: learned
    occurrences: 3
    last_seen: <iso date>
```

4. **Decay helper**: implement `ctx-gate review` (manual command, not a
   hook) that lists `learned.yml` entries unused for 90+ days and
   `standing.yml` entries whose evidence paths no longer exist, for the
   developer to confirm or delete. Do not auto-delete.

---

## Phase 6 — Enforcement (`ctx-gate enforce`, preToolUse hook) — three levels, team-owned setting, personal opt-in to tighten only

Only `preToolUse` can actually block. Build three levels, not just on/off:

- `off` — Phase 4 checks still run and inject context, but nothing blocks.
- `warn` — same as off, but a visible warning is added to the injected
  context ("this request looks underspecified — proceeding anyway") so the
  agent surfaces it without stopping. Good default for a team's first few
  weeks.
- `block` — if the Phase 4 check for this session flagged missing scope
  AND missing acceptance criteria (both, not either — stay conservative),
  and no answer was recorded since, return a deny decision for
  `editFiles`/write-type tools only — never deny read-only tools. Confirm
  the exact deny/allow field name in the current hooks reference before
  wiring this up (note as TODO, hooks are in preview).

**Two config files, two levels of authority:**

1. `.context-ops/config.yml` — the **team setting**, committed to git,
   default `enforcement: off`. Changed only by editing this file and
   opening a normal PR — so a change to blocking behavior is visible and
   reviewable like any other code change, and no CLI command should
   silently rewrite it. Add `ctx-gate enforce <off|warn|block>` as a
   convenience that just edits this file locally, ready for the developer
   to commit — it must never commit on their behalf.

2. `.context-ops/config.local.yml` — an optional **personal override**,
   added to `.gitignore` during `init`. Rule: this file may only raise the
   effective level, never lower it. Compute effective level as
   `max(teamLevel, localLevel)` on a fixed ordering `off < warn < block`.
   So a developer can turn blocking on just for themselves even if the
   team hasn't, but nobody can use a local file to quietly weaken a level
   the team committed. Validate this ordering with a unit test that tries
   to lower the effective level and asserts it's rejected.

Ship with team default `enforcement: off` in the generated `config.yml`,
so every repo starts advisory-only until the repo owner deliberately opts
in via a reviewed PR.

---

## Phase 7 — Context Optimizer (`ctx-gate optimize`)

Separate concern from the gate — reads `manifest.json` plus a fresh
broader scan of the repo (naming patterns, architecture, error-handling
style actually observed in code, not just declared in `standing.yml`), and
writes/diffs:

- `AGENTS.md` — 2-3 sentence summary + always-true bullets + a routing
  list pointing to the instructions/skills files below.
- `.github/instructions/*.instructions.md` — one per path-scoped concern
  found, each with `applyTo` frontmatter.
- `.github/skills/*/SKILL.md` — one per task-scoped concern.

Every claim must cite `path` or `path#symbol` evidence gathered from
actual code, never invented. Use `tokenBudget.js` to enforce size limits
and refuse to write a file over budget — split it instead.

---

## Phase 8 — `install.sh` / `install.ps1` and hook templates

`install.sh`:
1. Pin to a specific tagged version (read from `VERSION` file in this
   repo at release time, not `main`).
2. Download/copy the `bin/` + `src/` tree to `~/.ctx-gate/<version>/`.
3. Run `ctx-gate init` inside the developer's current repo (the one they
   ran the installer from).
4. Copy `hook-templates/hooks.json` into the target repo's
   `.github/hooks/ctx-gate.json`, pointing at the installed binary path.

`install.ps1` — same steps, Windows PowerShell.

`hooks.json` template:

```json
{
  "version": 1,
  "hooks": {
    "userPromptSubmitted": [
      { "type": "command", "bash": "~/.ctx-gate/current/bin/ctx-gate check",
        "powershell": "~/.ctx-gate/current/bin/ctx-gate.ps1 check", "timeout": 10 }
    ],
    "postToolUse": [
      { "type": "command", "bash": "~/.ctx-gate/current/bin/ctx-gate learn",
        "powershell": "~/.ctx-gate/current/bin/ctx-gate.ps1 learn", "timeout": 10 }
    ]
  }
}
```

(`preToolUse` entry added only if a repo's `config.yml` has
`enforcement: true` — `init` should conditionally include it.)

---

## Phase 9 — What gets committed inside each *target* repo after `init`

```
target-repo/
├── .github/hooks/ctx-gate.json     ← committed
└── .context-ops/
    ├── config.yml                  ← committed (team setting, enforcement: off by default)
    ├── config.local.yml            ← gitignored (personal override, can only tighten)
    ├── manifest.json               ← committed
    └── memory/
        ├── standing.yml            ← committed
        ├── learned.yml             ← committed
        ├── features.yml            ← committed
        └── answers.jsonl           ← gitignored (personal-ish raw log, not curated)
```

Add these exact `.gitignore` entries during `init`:
```
.context-ops/memory/answers.jsonl
.context-ops/config.local.yml
```

---

## Constraints (apply to every phase)

- Every module gets unit tests before moving to the next phase.
- No network calls except the optional codebase-memory-mcp install step —
  everything else must work fully offline once installed.
- Keep every hook script's own execution time under ~2 seconds on a
  mid-size repo — this runs on every prompt, it must feel instant.
- If a hook script errors, it must fail silently from the developer's
  point of view (log to `.context-ops/logs/`, exit 0) — a broken gate must
  never block someone's normal Copilot usage.
- Comment every place where you're relying on the hooks JSON schema, since
  hooks are in preview and field names may change — make these easy to
  find and patch later.

## Deliverable checklist at the end

- [ ] Working `ctx-gate init` on a fixture Node/React repo, fixture Python
      repo, and fixture .NET repo
- [ ] `ctx-gate check` producing sensible output against 10 example
      prompts you write as a test table (include the "change sorting
      order" and "add validation" examples)
- [ ] `ctx-gate learn` correctly promoting a pattern to `learned.yml`
      after 3 simulated occurrences
- [ ] `ctx-gate optimize` producing `AGENTS.md` under budget with real
      citations
- [ ] `ctx-gate enforce` correctly computing `max(team, local)` and
      rejecting any attempt for the local file to lower the team level
- [ ] `ctx-gate init` never installs codebase-memory-mcp automatically on
      any OS — only prints guidance; `ctx-gate mcp-check` correctly detects
      the binary and builds the index only after it's manually installed
- [ ] README.md explaining install, init, and what each memory file means,
      written for a developer who has never seen this tool before
- [ ] A short SECURITY.md noting this executes local shell commands via
      hooks and reads full repo contents — flag for internal security
      review before company-wide rollout

## PROMPT END
