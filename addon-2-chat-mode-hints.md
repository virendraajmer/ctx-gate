# Add-On Prompt 2 for Claude Code — Chat Mode Hints (ships DISABLED by default)

Paste into Claude Code at the root of your existing `ctx-gate` repo. This is
an addition to work already in progress — do not regenerate existing files.

Build this one **after** Add-On 1, and do not enable it in your first
release. Reasoning is in the prompt below.

---

## PROMPT START

You are adding an optional, off-by-default feature to the existing
`ctx-gate` tool in this repo. Read the current code first and fit into its
existing structure — do not restructure anything or change existing
behaviour.

### Why this feature exists, and why it ships off

In VS Code, Agent mode is the most expensive chat mode — it runs many turns
and reads many files. Many developers use it for everything out of habit,
including simple questions that Ask mode would answer far more cheaply.

But this feature carries a real risk: a hint that is wrong twice a week
teaches developers to ignore all injected context, including the
session-cost warnings that are actually reliable. So it ships disabled, gets
piloted by one team, and is only enabled company-wide if measured accuracy
is good. **Do not enable it by default under any circumstances.**

### Step 0 — Investigate before building

Inspect the actual `userPromptSubmitted` hook input payload and determine
whether the current chat mode is available in it. Write your finding as a
comment at the top of the new module, and tell me the answer in your
response.

- **If mode IS available**: only emit a hint when the suggested mode differs
  from the current one. Silence otherwise.
- **If mode is NOT available**: the hint is blind. Phrase it as a neutral
  note about which mode suits this kind of request. Never write "switch from
  X to Y", because you don't know what X is.

### What to build

**1. A new pure module, e.g. `src/core/modeHints.js`**

One exported function: `classify(promptText) -> { mode, confidence } | null`.
Returning `null` (no hint) must be the common case.

Deterministic rules only — no LLM, no heuristic scoring that can't be
explained in one line:

| Signal | Suggests |
|---|---|
| Opens with what/why/how/where/explain/does, AND contains no action verb | Ask mode |
| Contains add/create/fix/change/refactor/implement/build/write | Agent mode is appropriate → emit nothing |
| Names exactly one file plus one small localized change | Edit mode |
| Anything ambiguous | **return `null`** |

Ambiguity is the critical case. "What is the best way to fix this bug?"
contains question words AND an action verb — it looks like a question but
needs Agent mode. Any prompt matching signals from more than one row returns
`null`. **Silence is the correct output whenever confidence is not high.**

**2. Wire into `src/core/gate.js`**

Call `classify()` only when `modeHints` is enabled. Append at most one short
line to the injected context. Never let a mode hint displace or dilute the
Phase 4 clarifying questions — those are the primary output; this is a
footnote.

**3. Config**

Add `modeHints: false` to the generated `.context-ops/config.yml`, with a
comment in the generated file explaining that it is experimental, may
misfire, and should be piloted before wider use.

**4. Accuracy measurement (required, not optional)**

When a hint is emitted, log it to `.context-ops/logs/mode-hints.jsonl` with
the prompt text and the suggestion. Extend `ctx-gate stats` to report how
many hints were emitted. This is what lets a pilot team judge whether it
misfires — without it there is no basis for deciding to enable it.

### Constraints

- Zero LLM calls.
- Adds no measurable time to the hook path.
- Test table of **at least 15 prompts**, deliberately including ambiguous
  ones like "what is the best way to fix this bug", "how should I refactor
  this", "explain and then fix the sorting". Assert that every ambiguous
  case returns `null`. The test suite should have more negative cases than
  positive ones.

### Deliverables

- [ ] Finding reported on whether current mode is in the hook payload
- [ ] `modeHints: false` in generated config; feature fully inert when off
- [ ] 15+ prompt test table, ambiguous cases all return `null`
- [ ] Hints logged for later accuracy review
- [ ] Confirmation that mode hints never replace clarifying questions

## PROMPT END
