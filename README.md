# ctx-gate

Company-wide context optimizer and zero-LLM requirement gate for AI
coding agents (GitHub Copilot in VS Code today; designed to support
other agent CLIs later — see [Architecture](#architecture)).

ctx-gate has two capabilities in one tool:

- **Context Optimizer** (`ctx-gate optimize`) scans a target repo and
  writes token-budgeted context files that GitHub Copilot loads
  automatically: `AGENTS.md`, `.github/instructions/*.instructions.md`,
  and `.github/skills/*/SKILL.md`. Run rarely (e.g. monthly), on demand.
- **Requirement Gate** (`ctx-gate check` / `learn` / `enforce`) is a set
  of local, deterministic scripts — no LLM calls, ever — wired into
  Copilot's agent hooks. Before an agent starts working on a prompt, a
  hook runs `ctx-gate check`, which flags underspecified requests
  (missing scope, missing acceptance criteria, vague wording) using only
  local data, and suggests clarifying questions. `ctx-gate learn` records
  answers over time and promotes repeated patterns into permanent
  per-repo memory. `ctx-gate enforce` can optionally block write actions
  on badly underspecified requests once a team opts in.

Each repo that installs ctx-gate keeps its own private memory under
`.context-ops/` — memory is never shared across repos, only within a
repo's own team via git.

## Install

**Windows (PowerShell):**

```powershell
cd path\to\your-repo
& \path\to\ctx-gate\install.ps1
```

**macOS/Linux/WSL2 (bash):**

```bash
cd path/to/your-repo
/path/to/ctx-gate/install.sh
```

> `install.sh` is written best-effort and has not been executed on real
> Linux/macOS (this repo was built and tested on Windows) — verify it via
> WSL2 or CI before relying on it in production.

Both scripts: copy `ctx-gate` to a version-pinned location
(`~/.ctx-gate/<version>/` on macOS/Linux, `%USERPROFILE%\.ctx-gate\<version>\`
on Windows), run `ctx-gate init` in the repo you ran the installer from,
and write `.github/hooks/ctx-gate.json` pointing at the installed binary.

## Usage

### `ctx-gate init`

Run once per repo (the installer does this for you). Detects your stack
(Node/React, Python, .NET — a repo can match more than one), asks a
handful of standing questions the detectors couldn't answer on their own
(what does "done" mean here, which paths are high-risk, naming/logging
conventions, etc.), and writes everything under `.context-ops/`. Safe to
re-run — it never re-prompts for anything it already has an answer for.

### `ctx-gate check` / `learn` / `enforce` (the Requirement Gate)

These are wired into Copilot's agent hooks by `install.ps1`/`install.sh`
and normally run automatically — you shouldn't need to invoke them by
hand. `check` runs before Copilot starts on a prompt and injects context
(matched screens/endpoints, standing conventions, clarifying questions
for anything underspecified). `learn` runs after a tool call and quietly
tracks whether the same kind of clarification keeps coming up, promoting
it into permanent memory after 3 occurrences. `enforce` (off by default)
can block a write when a request is badly underspecified — see
[Enforcement levels](#enforcement-levels).

### `ctx-gate review`

Manual command. Lists `learned.yml` patterns unused for 90+ days and
`standing.yml` risk-path entries whose paths no longer exist in the repo,
so you can confirm or delete them by hand. Never deletes anything itself.

### `ctx-gate optimize [--write]`

Manual command, run occasionally (e.g. monthly, or after a big refactor).
Scans the repo and prints a diff of what `AGENTS.md`, the
`.github/instructions/*.instructions.md` files, and the
`.github/skills/*/SKILL.md` files would become. Every claim in the
generated content cites a real file (never a fabricated fact, never a
line number, since those rot). Nothing is written unless you pass
`--write`.

### `ctx-gate mcp-check`

ctx-gate can optionally use [`codebase-memory-mcp`](#codebase-memory-mcp)
for smarter semantic search inside `check`. This binary is **never**
installed automatically. `ctx-gate init` only prints manual install
instructions if it isn't found. Once you've installed it yourself, run
`ctx-gate mcp-check` to confirm it's detected and build its initial
index — after that its background watcher keeps itself fresh.

### `ctx-gate enforce <off|warn|block>`

Sets your own personal override in `.context-ops/config.local.yml`
(gitignored, never committed on your behalf). See below.

## Enforcement levels

Enforcement has three levels: `off` < `warn` < `block`. The **team
level** lives in `.context-ops/config.yml` (committed, defaults to
`off`) — change it via a normal, reviewable PR. You can also set a
**personal level** locally via `ctx-gate enforce <level>`; the effective
level is always `max(team, local)`, so your local file can only raise
enforcement for yourself, never quietly lower what the team agreed to.
Read-only tool calls are always allowed regardless of level. `block`
only denies a write when a request was flagged as missing **both** scope
and acceptance criteria, and nothing has been clarified since.

## Memory files

Everything below lives under `.context-ops/` inside the target repo —
never centralized, never shared across repos.

| File | Committed? | What it holds |
|---|---|---|
| `manifest.json` | yes | Detected facts about the repo (stacks, screens, API endpoints) — regenerated fresh on every `ctx-gate init`. |
| `memory/standing.yml` | yes | Answers to the standing questions (what "done" means, high-risk paths, error-handling/naming/logging conventions) — confirmed by a human, or auto-detected where possible. |
| `memory/features.yml` | yes | Business words your team uses mapped to specific folders (e.g. "sorting" → `src/utils/sort.js`), so `check` can resolve vague requests. |
| `memory/learned.yml` | yes | Patterns promoted by `ctx-gate learn` once the same clarification has come up 3 times — starts empty. |
| `config.yml` | yes | Team enforcement level + which agent adapter is active. |
| `memory/answers.jsonl` | no (gitignored) | Raw append-only log every `learn` call writes to, used to compute promotion — not curated, so not committed. |
| `config.local.yml` | no (gitignored) | Your personal enforcement override, written by `ctx-gate enforce <level>`. |
| `logs/` | no (gitignored) | `ctx-gate.log` (hook errors) and `session-cache.json` (short-lived per-session state shared between `check`/`learn`/`enforce`, since each hook fires as a separate process) — ephemeral, derived, never curated memory. |

## Architecture

Hook-format translation is isolated in `src/adapters/` so the core gate
logic stays agent-agnostic. `src/adapters/copilot.js` is the only
adapter shipped today; it translates GitHub Copilot's hook JSON to/from
a normalized internal shape defined in `src/adapters/types.js`. Adding
support for another agent CLI later means writing a new file under
`src/adapters/` with the same four functions and registering it in
`src/adapters/index.js` — no changes to `src/core/*.js`.

GitHub Copilot's agent hooks are in preview; every place ctx-gate guesses
at a specific hook field name is marked with a `TODO(hooks-preview)`
comment in `src/adapters/copilot.js` — check there (and
`hook-templates/hooks.json.README.md`) before relying on this in
production.

## codebase-memory-mcp

An optional, separately-installed binary that gives `ctx-gate check`
better semantic search over the codebase. ctx-gate never installs it for
you, on any OS — see `SECURITY.md` for why, and run `ctx-gate mcp-check`
after installing it yourself. Without it, `check` falls back to a plain
substring search over `git ls-files` — less precise, but the gate works
fully without this binary either way.

## Development

```bash
npm install
npm test
```
