# ctx-gate

[![npm version](https://img.shields.io/npm/v/ctx-gate.svg)](https://www.npmjs.com/package/ctx-gate)

Context optimizer and zero-LLM requirement gate for AI coding agents
(GitHub Copilot in VS Code today; designed to support other agent CLIs
later — see [Architecture](#architecture)).

ctx-gate has three capabilities in one tool:

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
- **Agent Pack** (`ctx-gate agents install` / `update` / `validate`)
  bundles a reviewed plan → implement → review multi-agent workflow
  (`.github/agents/{planner,implementer,reviewer,pipeline}.agent.md`) so
  each phase of a task runs in its own fresh, small context instead of
  one long, expensive chat session. See
  [Agent Pack](#agent-pack) below.

Each repo that installs ctx-gate keeps its own private memory under
`.context-ops/` — memory is never shared across repos, only within a
repo's own team via git.

## Install

**From npm (recommended):**

```bash
npm install -g ctx-gate
cd path/to/your-repo
ctx-gate init
```

Or without a global install, via `npx`:

```bash
cd path/to/your-repo
npx ctx-gate init
```

`ctx-gate init` writes `.github/hooks/ctx-gate.json` itself (pointing at
wherever `ctx-gate.js` actually is, so this works the same whether you
installed globally via npm or via one of the scripts below) — the npm
path above is self-sufficient on its own.

**Version-pinned install with hooks wired up (Windows, PowerShell):**

```powershell
cd path\to\your-repo
& \path\to\ctx-gate\install.ps1
```

**Version-pinned install with hooks wired up (macOS/Linux/WSL2, bash):**

```bash
cd path/to/your-repo
/path/to/ctx-gate/install.sh
```

> `install.sh` is written best-effort and has not been executed on real
> Linux/macOS (this repo was built and tested on Windows) — verify it via
> WSL2 or CI before relying on it in production.

Both scripts expect a local clone of this repo (they copy `ctx-gate` from
`path/to/ctx-gate`, not from the npm registry) to a version-pinned location
(`~/.ctx-gate/<version>/` on macOS/Linux, `%USERPROFILE%\.ctx-gate\<version>\`
on Windows), run `ctx-gate init` in the repo you ran the installer from, and
re-point `.github/hooks/ctx-gate.json` at that version-pinned copy (`init`
already wrote a working version of this file pointed at the copy the
installer just made; the installer's own write is only there to be
explicit about the version-pinned path and to keep the `~/.ctx-gate/current`
symlink indirection meaningful for install.sh).

## Usage

### `ctx-gate init`

Run once per repo (the installer does this for you, or run it yourself
after `npm install -g ctx-gate`). Detects your stack (Node/React, Python,
.NET — a repo can match more than one), asks a handful of standing
questions the detectors couldn't answer on their own (what does "done"
mean here, which paths are high-risk, naming/logging conventions, etc.),
writes everything under `.context-ops/`, and writes
`.github/hooks/ctx-gate.json`. Safe to re-run — it never re-prompts for
anything it already has an answer for, and re-running after an upgrade
re-points the hooks file at the new install path.

None of the standing questions are required to finish `init` — every one
has a sensible default (shown in brackets; press Enter to accept it, or
leave it blank), and one (`error-handling`) is skipped entirely when a
sniffer already detects it from real code. They're pure enrichment: `check`
uses whatever's answered to add optional context notes for the agent
(e.g. a "high-risk path — review carefully" note), and a blank/default
answer just means that note never fires — nothing about `init` completing
or the gate working depends on them being filled in. Answer (or change)
one later at any time with `ctx-gate configure`, without re-running `init`.

If `codebase-memory-mcp` is already on PATH, a fresh `init` also builds its
initial index for this repo (its own background watcher keeps it fresh
after that — re-running `init` later doesn't rebuild it again). If it
isn't on PATH, `init` prints manual install instructions and the command
to index the repo yourself afterward — see
[codebase-memory-mcp](#codebase-memory-mcp) below.

### `ctx-gate configure [id] [value]`

Manual command for answering (or re-answering) one of `init`'s standing
questions later, or adding a feature-word mapping, without re-running
`init` or hand-editing YAML.

Run with no arguments to see what's configurable and its current value:

```console
$ ctx-gate configure
ctx-gate: configurable answers for this repo (.context-ops/memory/standing.yml)

  done-means             tests pass + CI green            [default]
  high-risk-paths        (blank)                          [default]
  error-handling         throws (Result/Either not seen)  [detected]
  naming-convention      (blank)                          [default]
  performance-target     not measured                     [default]
  logging-convention     (blank)                          [default]

ctx-gate: feature-word mappings (.context-ops/memory/features.yml)

  (none mapped)

Usage: ctx-gate configure <id> <value>
       ctx-gate configure feature <word> <path>
```

Then set one:

```bash
ctx-gate configure logging-convention "use pino, one JSON line per request"
ctx-gate configure feature sorting src/utils/sort.js
```

`ctx-gate configure <id> <value>` overwrites that standing.yml entry and
marks it `confirmed` (works even for `error-handling` — a manual answer
overrides the sniffer's guess). `ctx-gate configure feature <word> <path>`
adds a folder mapping to features.yml, appending to an existing word rather
than replacing it. Both are just YAML writes — `.context-ops/memory/standing.yml`
and `features.yml` are plain, git-committed files, so hand-editing them
works too; this command is just the friendlier path.

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
`--write`. If `codebase-memory-mcp` is detected on PATH, the generated
`AGENTS.md` also gets a fixed "Code search" block telling the agent to
prefer its graph tools (`search_graph`, `trace_path`, `get_code_snippet`,
`query_graph`, `get_architecture`) over grep or full-file reads for
structural questions — omitted entirely when the binary isn't available.

### `ctx-gate mcp-check`

ctx-gate can optionally use [`codebase-memory-mcp`](#codebase-memory-mcp)
for smarter semantic search inside `check`. This binary is **never**
installed automatically. `ctx-gate init` only prints manual install
instructions if it isn't found, and only auto-builds the index on a
genuinely fresh `init` if it is found. Run `ctx-gate mcp-check` any time
afterward to confirm it's still detected or to force a rebuild — its
background watcher otherwise keeps the index fresh on its own.

### `ctx-gate enforce <off|warn|block>`

Sets your own personal override in `.context-ops/config.local.yml`
(gitignored, never committed on your behalf). See below.

### `ctx-gate stats`

Manual command. Copilot resends the whole conversation on every turn, so
a long chat session costs non-linearly — `check` nudges you about this in
context (see [Long-session cost warning](#long-session-cost-warning)
below), and `stats` reports the numbers behind it: median/max turns per
session this week, how many sessions crossed each warning threshold, and
which files get re-read most often across sessions (a signal that `check`
or the optimizer's generated context is missing something those tasks
needed). Every number is either read directly from local state or run
through the real tokenizer in `src/tokenBudget.js` — anything that can't
be measured prints `not measured`, never a guess. Also reports pipeline-
orchestrated turns (sub-agent prompts from the [Agent Pack](#agent-pack)'s
pipeline orchestrator) separately, since those are excluded from the
median/max turn counts above — see [Agent Pack](#agent-pack).

### `ctx-gate agents install [--with-guidelines]`

Installs the four [Agent Pack](#agent-pack) files
(`planner`/`implementer`/`reviewer`/`pipeline.agent.md`) into
`.github/agents/`. For each file: writes it if missing, reports
`unchanged` and skips if it already matches what would be installed, or
reports a `CONFLICT` with a diff and **never overwrites** it if it exists
with different content — same diff-not-overwrite rule as `optimize`.
Records installed file hashes in `.context-ops/agent-pack.json` so a
later `update` can tell "you edited this locally" apart from "the pack
version changed". Also adds `.agentflow/` (the pipeline's per-task run
artifacts — `plan.md`, `changes.md`, `review.md`, `run.md`) to
`.gitignore`, unless `agentPack.commitArtifacts: true` in
`.context-ops/config.yml`. Pass `--with-guidelines` to also install the
~1000-line agent-authoring guidelines file to
`.github/instructions/agents.instructions.md` (opt-in only — it's large,
though cheap in practice since it's path-scoped to `**/*.agent.md` and
most teams never author their own agents); its real measured token count
(via `src/tokenBudget.js`) is printed either way.

### `ctx-gate agents update`

Compares `.context-ops/agent-pack.json` against the bundled pack's
current version. For each file, reports one of `unchanged`, `safe to
apply` (only the pack changed — applied automatically after showing the
diff), `locally modified`, or `manual merge needed` (both changed) — the
latter two are reported but never written to, so a local edit is never
silently clobbered.

### `ctx-gate agents validate`

Validates every `*.agent.md` file found in the repo against the rules in
`agent-pack/agents.instructions.md`: required/well-formed `description`,
filename convention, the 30,000-character size budget, dangling
`handoffs[].agent` targets (these are silently ignored at runtime
otherwise — easy to miss without this check), a present-and-non-empty
`tools` list, and `model`/`handoffs` set without `target: 'vscode'`
(unsupported on GitHub.com's coding agent). Runs automatically as a
non-fatal check at the end of `ctx-gate init` if any `*.agent.md` files
already exist in the repo; run it standalone any time otherwise.

## Long-session cost warning

`learn` tracks a per-session cost snapshot in `.context-ops/state/` (turn
count, files read, estimated bytes read) — gitignored, pruned after 7
days. `check` reads it on every prompt and, at most twice per session,
adds a note explaining that each new message is now resending the whole
prior conversation and suggesting you start a fresh chat for your next
task. It can only advise — nothing in ctx-gate can open, close, or clear
a chat for you. Tune or disable it via `sessionWarnAt` / `sessionWarnHardAt`
/ `sessionWarnings` in `.context-ops/config.yml` (documented inline where
they're generated).

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

## Agent Pack

`ctx-gate agents install` bundles a reviewed, generic plan → implement →
review multi-agent workflow into `.github/agents/`:

- **`planner.agent.md`** turns a request into a minimal, file-scoped
  `plan.md` — the File Map it writes is the contract every later phase
  reads instead of re-exploring the codebase.
- **`implementer.agent.md`** executes that plan into working code plus a
  short `changes.md` change log.
- **`reviewer.agent.md`** judges the implementation against the plan for
  correctness, scope, security, and test coverage, writing `review.md`
  with an APPROVED / CHANGES REQUIRED / REPLAN verdict.
- **`pipeline.agent.md`** orchestrates all three end to end with no
  manual handoff clicks, capped fix/replan cycles, and a running
  `run.md` log — invoke it directly for a hands-off run, or invoke
  `planner`/`implementer`/`reviewer` individually to drive each phase by
  hand.

Each phase runs in its own fresh, small context instead of one long
chat session growing more expensive with every turn — the same
motivation as the Context Optimizer, applied to how a task itself gets
worked rather than to standing repo context. Per-task run artifacts
(`plan.md`, `changes.md`, `review.md`, `run.md`) are written under
`.agentflow/<taskId>/`, gitignored by default (see
[`ctx-gate agents install`](#ctx-gate-agents-install---with-guidelines)).

The pack is deliberately generic and only substitutes two things per
repo: the `model` frontmatter value (from `agentPack.model` in
`.context-ops/config.yml`, defaulting to the value the pack ships with)
and, in `planner.agent.md` only, a Verification-section hint using the
test command already detected in `manifest.json`. Everything else is
installed byte-for-byte from the reviewed pack — see
[`ctx-gate agents update`](#ctx-gate-agents-update) for how local edits
are protected when the pack itself changes, and
[`ctx-gate agents validate`](#ctx-gate-agents-validate) for checking any
custom agent files you add later.

The `userPromptSubmitted` hook detects the pipeline's own sub-agent
invocation prompts (its fixed `Act as the agent "<NAME>" defined in
"<SPEC_PATH>"` template, or any prompt referencing a `.agentflow/*/`
artifact) and skips full Requirement Gate analysis on them — they're
already fully specified, and injecting clarifying questions into a
handoff prompt would interfere with the workflow. The gate still runs
normally on the human's original request to the planner, since that's
exactly where a vague request would otherwise cost tokens across all
three phases. These skipped turns are tracked separately and reported by
[`ctx-gate stats`](#ctx-gate-stats) rather than folded into normal
session turn counts.

## Memory files

Everything below lives under `.context-ops/` inside the target repo —
never centralized, never shared across repos.

| File | Committed? | What it holds |
|---|---|---|
| `manifest.json` | yes | Detected facts about the repo (stacks, screens, API endpoints) — regenerated fresh on every `ctx-gate init`. |
| `memory/standing.yml` | yes | Answers to the standing questions (what "done" means, high-risk paths, error-handling/naming/logging conventions) — confirmed by a human, or auto-detected where possible. |
| `memory/features.yml` | yes | Business words your team uses mapped to specific folders (e.g. "sorting" → `src/utils/sort.js`), so `check` can resolve vague requests. |
| `memory/learned.yml` | yes | Patterns promoted by `ctx-gate learn` once the same clarification has come up 3 times — starts empty. |
| `config.yml` | yes | Team enforcement level + which agent adapter is active + session-warning thresholds + `agentPack.model`/`agentPack.commitArtifacts`. |
| `agent-pack.json` | yes | Hashes of the currently-installed Agent Pack files, written by `ctx-gate agents install`/`update` — lets `update` tell a local edit apart from a pack version change. |
| `memory/answers.jsonl` | no (gitignored) | Raw append-only log every `learn` call writes to, used to compute promotion — not curated, so not committed. |
| `config.local.yml` | no (gitignored) | Your personal enforcement override, written by `ctx-gate enforce <level>`. |
| `logs/` | no (gitignored) | `ctx-gate.log` (hook errors) and `session-cache.json` (short-lived per-session state shared between `check`/`learn`/`enforce`, since each hook fires as a separate process) — ephemeral, derived, never curated memory. |
| `state/<sessionId>.json` | no (gitignored) | Per-session cost snapshot (turn count, files read, estimated bytes read) written by `learn`, read by `check` for the [long-session warning](#long-session-cost-warning) and by `ctx-gate stats`. Pruned after 7 days. |

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
better semantic search over the codebase, and — when detected — gets a
routing block in the generated `AGENTS.md` telling coding agents to prefer
its graph tools over grep/full-file reads for structural questions. ctx-gate
never installs it for you, on any OS — see `SECURITY.md` for why.

- **Not installed yet:** `ctx-gate init` prints manual install/approval
  instructions (get it approved by internal security first — it reads full
  repo contents, even though it stays local). Once installed, run
  `ctx-gate mcp-check` to confirm it's detected and build its initial index.
- **Already installed:** a genuinely fresh `ctx-gate init` builds the
  initial index for you automatically; re-running `init` later doesn't
  rebuild it again (its own background watcher keeps it current). Run
  `ctx-gate mcp-check` any time to confirm it's still detected or force a
  rebuild.

Without it, `check` falls back to a plain substring search over
`git ls-files` — less precise, but the gate works fully without this
binary either way.

## Development

```bash
npm install
npm test
```
