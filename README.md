# ctx-gate

Company-wide context optimizer and zero-LLM requirement gate for AI
coding agents (GitHub Copilot in VS Code today; designed to support
other agent CLIs later — see [Architecture](#architecture)).

> **Status: under construction.** This README will be expanded with full
> install/init/usage instructions as each phase of the build lands (see
> `claude-code-build-ctx-gate-prompt.md` for the full build plan). Right
> now this repo contains the scaffold only — no commands are functional
> yet.

## What it does

**Context Optimizer** (`ctx-gate optimize`) scans a target repo and
writes token-budgeted context files that GitHub Copilot loads
automatically: `AGENTS.md`, `.github/instructions/*.instructions.md`,
and `.github/skills/*/SKILL.md`. Run rarely (e.g. monthly), on demand.

**Requirement Gate** (`ctx-gate check` / `learn` / `enforce`) is a set of
local, deterministic scripts — no LLM calls — wired into Copilot's agent
hooks. Before an agent starts working on a prompt, a hook runs
`ctx-gate check`, which flags underspecified requests (missing scope,
missing acceptance criteria, vague wording) using only local data, and
suggests clarifying questions. `ctx-gate learn` records answers over
time and promotes repeated patterns into permanent per-repo memory.
`ctx-gate enforce` can optionally block write actions on badly
underspecified requests once a team opts in.

Each repo that installs ctx-gate keeps its own private memory under
`.context-ops/` — memory is never shared across repos, only within a
repo's own team via git.

## Architecture

Hook-format translation is isolated in `src/adapters/` so the core gate
logic stays agent-agnostic. `src/adapters/copilot.js` is the only
adapter shipped today; it translates GitHub Copilot's hook JSON to/from
a normalized internal shape defined in `src/adapters/types.js`. Adding
support for another agent CLI later means writing a new file under
`src/adapters/` with the same four functions — no changes to
`src/core/*.js`.

## Install

Not yet available — see `install.ps1` / `install.sh` (stubs, Phase 8 of
the build plan).

## Memory files

Once `ctx-gate init` is implemented, each target repo will get a
`.context-ops/` directory holding `manifest.json` (detected facts about
the repo), `memory/standing.yml` (confirmed team conventions),
`memory/learned.yml` (patterns learned from repeated developer answers),
`memory/features.yml` (business-word → path mapping), and
`config.yml`/`config.local.yml` (enforcement level settings). Details
will be documented here as each file's format lands.
