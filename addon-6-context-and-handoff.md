# Add-On Prompt 6 for Claude Code — Shared Language (`CONTEXT.md`), Agent-Writing Discipline, and Session Handoff

Paste into Claude Code at the root of your existing `ctx-gate` repo. This is
an addition to work already in progress — do not regenerate existing files.

Three related changes, adapted from ideas in
[mattpocock/skills](https://github.com/mattpocock/skills) (MIT). **Part 1 is
the important one and changes an existing design.** Each part is
self-contained — paste the whole file, or one part at a time.

Build order: **Part 1 → Part 2 → Part 3.**

---

## PROMPT START

You are making three changes to the existing `ctx-gate` tool in this repo.
Read the current code first and fit into its existing structure and
conventions — do not restructure anything unrelated, and do not change
existing behaviour beyond what is specified here.

---

# PART 1 — Replace `features.yml` with a glossary that renders `CONTEXT.md`

### Why this change

The current design has `features.yml` mapping business words to file paths,
so the Requirement Gate can ask better clarifying questions. That is the
wrong ceiling. A shared project vocabulary doesn't just make questions
better — it makes many of them **unnecessary**, because a developer who says
a defined term has already specified what they mean.

It also compounds: a shared language means shorter prompts, less agent
exploration, more consistent naming in the code itself, and fewer thinking
tokens because the agent has a more concise vocabulary to reason in.

So `features.yml` becomes the machine half of a richer thing, and gains a
human half.

### The single-source-two-outputs design

Follow the pattern already used for `standing.yml` → `AGENTS.md`: one source
of truth in memory, rendered into the artifact the agent reads.

```
.context-ops/memory/glossary.yml     ← single source of truth, committed
        │
        ├─ rendered by optimize.js ─→ CONTEXT.md  (repo root, committed)
        │                              read by the agent
        └─ read directly by gate.js
                                       paths used for local resolution;
                                       never rendered, never sent to a model
```

`glossary.yml` replaces `features.yml` entirely. Remove `features.yml` from
the design, along with any code, fixtures, or config that reads or writes
it. No compatibility shim is needed.

### `glossary.yml` entry shape

```yaml
terms:
  - term: "Orders screen"
    aka: ["order list", "orders page"]
    definition: "The customer-facing list of placed orders, with sort and
                 filter controls. Not the admin order queue."
    paths: ["src/screens/OrderList/**"]
    status: confirmed        # confirmed | inferred | candidate
    hits: 0
    last_used: <iso date>
```

- `definition` is what renders into `CONTEXT.md`. Required for `confirmed`.
- `paths` is what `gate.js` uses to resolve a vague request locally. Optional
  — a term can be pure vocabulary with no single home in the code.
- `status` behaves as it already does elsewhere: `confirmed` and `inferred`
  are used automatically, `candidate` is only ever suggested.

### `CONTEXT.md` rendering rules

- Renders at the **repo root**, committed, from `confirmed` and `inferred`
  entries only. Never render `candidate` entries.
- Sorted by `hits` descending, so the most-used vocabulary is first.
- `AGENTS.md` gets a one-line pointer to it, not a copy of it.
- Budget it like any other artifact: cap at ~1000 tokens, measured with the
  real tokenizer in `src/tokenBudget.js`. If the glossary exceeds the cap,
  render the top entries by `hits` and note in `CONTEXT.md` how many terms
  were omitted — never silently truncate.
- Byte-stability applies, same as `AGENTS.md`: two consecutive `optimize`
  runs on an unchanged glossary must produce a byte-identical `CONTEXT.md`.
  Add a test.

### Bootstrap during `ctx-gate init`

Seed `candidate` entries automatically from what the detectors already found
— route names, screen folders, controller names, top-level module names.
These are `candidate` with empty definitions. Then ask the developer to
define **at most 8** of them during init, prioritised by how often the term
appears across the codebase. Do not make them define everything; the rest
fill in over time.

### New learning signal — undefined jargon detection

This is the highest-value addition and it needs no AI.

In `gate.js`, extract candidate domain terms from each request: multi-word
noun phrases and capitalised or unusual single words. For each, check
whether it appears in (a) `glossary.yml`, (b) the repo's symbol/file names.
If it appears in **neither**, count it in
`.context-ops/state/unknown-terms.json`.

When a term crosses 3 uses across different sessions, surface it:

```
"reconciliation" has appeared in 4 requests but is not defined
anywhere in the glossary or the codebase.
Run `ctx-gate glossary add reconciliation` to define it.
```

That is a real vocabulary gap, detected by counting. Add
`ctx-gate glossary add|list|review` as manual commands, following the
existing `ctx-gate review` conventions for decay and confirmation.

### Promotion from the existing answer memory

The repetition-promotion logic in `learn.js` currently promotes repeated
answers into `learned.yml`. Extend it: when a promoted pattern is a
term-to-path mapping (e.g. "sorting" resolving to the Orders screen three
times), write it as a `candidate` glossary entry rather than only a
`learned.yml` pattern. The developer confirms it and supplies a definition.

### Part 1 deliverables

- [ ] `features.yml` removed from the codebase; `glossary.yml` in its place
- [ ] `CONTEXT.md` rendered at repo root, budgeted, byte-stable across runs
- [ ] `AGENTS.md` points to it rather than duplicating it
- [ ] `init` seeds candidates and asks for at most 8 definitions
- [ ] Undefined-jargon counting works and surfaces at 3 uses
- [ ] `ctx-gate glossary add|list|review` implemented
- [ ] Zero LLM calls anywhere in the gate path for all of the above

---

# PART 2 — Apply `writing-for-agents` principles to the Context Optimizer

### What to do

Fetch and read this skill:
`https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL.md`

It is specifically about writing documents that agents read — skills,
`AGENTS.md`, and any doc reached by a pointer. That is exactly what
`src/core/optimize.js` produces.

Then:

1. Review the generation logic in `optimize.js` and the `CONTEXT.md`
   renderer from Part 1 against those principles.
2. Apply the ones that fit.
3. **Report back to me a short list**: which principles you applied, what
   changed as a result, and any principle you deliberately did not apply and
   why.

### Constraints

- Do not adopt anything that conflicts with rules already established in
  this repo — specifically the token budgets, the byte-stability
  requirement, the diff-not-overwrite rule, and the ban on `path:line`
  citations in favour of `path#symbol`. If a principle conflicts, flag it
  and leave the existing rule in place.
- Do not copy text from the skill into this repo. Apply the ideas, write our
  own words.

---

# PART 3 — Session handoff skill

### Why

Add-On 1 warns when a session is getting expensive and suggests starting a
new chat. That advice has an obvious cost: starting fresh loses context. A
handoff document closes the gap — it compacts the current conversation into
a file the next session can pick up from.

### The constraint that determines the design

`ctx-gate` is a local script with **no access to the conversation**. It
cannot compact anything. Only the agent can do that.

So this ships as a **Copilot skill**, not a CLI command. Add it to the
existing agent-pack install machinery from Add-On 4.

### What to build

**1. `agent-pack/handoff/SKILL.md`**

Write it yourself, in Copilot's skill format
(`.github/skills/<name>/SKILL.md`). Do not copy the upstream file — the
format differs and our conventions differ. Credit the source repo in a
comment.

The skill instructs the agent to write `.agentflow/handoffs/<timestamp>.md`
containing: the goal in one or two sentences, decisions already made and why,
files touched so far with `path#symbol` references, what is done, what is
next, and any dead ends already ruled out so the next session doesn't repeat
them.

Apply the same context-budget discipline the agent pack already uses: cap
the document, reference paths rather than pasting file contents, no code
blocks except signatures.

**2. Wire into the existing install flow**

Install alongside the four agents in `ctx-gate agents install`, with the same
hash tracking, diff-on-conflict, and `agents validate` checks.

**3. Update the long-session warning from Add-On 1**

The warning currently suggests starting a new chat. Change it to suggest
running the handoff skill first, then starting fresh — but only when the
handoff skill is actually installed in this repo. Check before referencing
it; a warning pointing at something that doesn't exist is worse than no
warning.

**4. Record handoffs in the session state**

When `.agentflow/handoffs/` gains a file, record it in the session state so
`ctx-gate stats` can report how often sessions run long enough to need one.
That number tells you whether the session problem is getting better.

**5. Gitignore**

Handoff documents live under `.agentflow/`, which `init` already gitignores.
No new entry is needed.

### Licensing

The source repo is MIT. We are writing our own implementation of the
concept, not copying files, so attribution in a comment is sufficient. If
any text does end up copied verbatim, include the MIT notice in
`agent-pack/`. Flag it to me either way — this goes into an enterprise repo.

### Part 3 deliverables

- [ ] `handoff/SKILL.md` written in Copilot skill format, our own words,
      source credited
- [ ] Installs through the existing agent-pack flow with hash tracking
- [ ] Long-session warning references it only when installed
- [ ] Handoffs counted in `ctx-gate stats`

## PROMPT END
