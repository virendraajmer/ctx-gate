# Add-On Prompt 3 for Claude Code — Fixed Efficiency Rules Block in Generated `AGENTS.md`

Paste into Claude Code at the root of your existing `ctx-gate` repo. This is
an addition to work already in progress — do not regenerate existing files.

This is the smallest change of the three and the safest to ship first.

---

## PROMPT START

You are extending the Context Optimizer (`src/core/optimize.js`) in the
existing `ctx-gate` tool. Read the current code first and fit into its
existing structure — do not restructure anything or change how the optimizer
generates repo-specific content.

### Why this feature exists

The largest share of token cost is exploration — the agent reading files,
dumping command output into chat, and rewriting whole files for small edits.
These behaviours are the same in every repo, so the rules against them are
identical everywhere and belong in `AGENTS.md`, which Copilot loads on every
task.

### What to build

**1. A fixed block, written verbatim into every generated `AGENTS.md`**

Place it near the top, after the project summary and before the routing
list. Substitute only the genuinely repo-specific values (the test command,
and any extra ignore paths detected for that repo's stack):

```markdown
## Running commands
- Pipe long output to a file, then read only what matters:
  `<testCommand> > /tmp/out.log 2>&1; grep -A5 "FAIL\|Error" /tmp/out.log`
- Never run a command whose output exceeds ~100 lines directly into chat.
- For builds, surface only error lines, not the full log.

## Reading files
- Search first, read after. Never read a full file to locate one symbol.
- Read only the needed line range.
- If a file was already read this session, do not read it again.
- Never read: node_modules/, dist/, build/, *.lock, *.min.js, generated/,
  migrations/, test fixtures, sample data.

## Editing files
- Change only the lines that need changing. Never rewrite a whole file for
  a small edit.
- Do not print the full file back after editing it.

## Response style
- No preamble. Do not restate the request.
- Do not summarise what you did unless asked.
```

The ignore list should be extended per stack from the existing detectors —
e.g. `bin/`, `obj/`, `packages/` for .NET; `__pycache__/`, `.venv/`,
`*.egg-info/` for Python. Extend, don't replace, the baseline list above.

**2. Byte-stability — this is the important constraint**

A stable, unchanged prefix can be cached and becomes nearly free. Text that
gets reworded on every optimizer run is paid for in full every time.

- Store the block as a versioned constant in the codebase, not as text the
  optimizer composes freshly each run.
- Two consecutive `ctx-gate optimize` runs against an unchanged repo must
  produce a **byte-identical** `AGENTS.md`. Write a test asserting this.
- If the block itself is ever revised in a future `ctx-gate` release, bump a
  version marker so the diff shown to the developer is deliberate and
  explainable, not incidental churn.

**3. Budget accounting — count it, don't treat it as free**

The block is roughly 200-250 tokens. `src/tokenBudget.js` must include it
when checking `AGENTS.md` against the ~1500 token budget, leaving roughly
1250 for repo-specific content. If repo-specific content would push the file
over budget, the existing split-or-fail behaviour applies to the
repo-specific part — never trim the fixed block to make room, and never
silently exceed the budget.

Report the actual measured token count of the generated block in the
optimizer's output, computed with the real tokenizer. Do not estimate it.

### Constraints

- Do not reword the block to suit a particular repo's tone. Uniformity
  across repos is the point.
- Existing diff-not-overwrite behaviour applies: if `AGENTS.md` already
  exists, show the diff rather than overwriting.

### Deliverables

- [ ] Block present verbatim in generated `AGENTS.md`, with only the test
      command and stack ignore paths substituted
- [ ] Two consecutive `optimize` runs on an unchanged repo produce a
      byte-identical file (test asserts this)
- [ ] Block counted against the `AGENTS.md` budget, with its real measured
      token count reported
- [ ] Stack-specific ignore paths extend rather than replace the baseline

## PROMPT END
