---
name: handoff
description: Write a session handoff document before starting a fresh chat, so the next session can pick up without losing context.
---

<!-- Concept credit: session-handoff idea adapted from mattpocock/skills
     (https://github.com/mattpocock/skills, MIT). Wording and structure
     below are original to this repo, not copied from that source. -->

# Session handoff

Use this when asked to hand off, or when ctx-gate's long-session warning
suggests running it before starting a new chat. A handoff closes the gap
that starting fresh opens: the next session gets a compact record instead
of nothing.

Write `.agentflow/handoffs/<ISO-8601 timestamp>.md` with these sections,
in this order, each only when it has something to say:

1. **Goal** — one or two sentences: what this session is trying to accomplish.
2. **Decisions made** — each decision plus the one-line reason behind it.
   Skip anything that was never actually in question.
3. **Files touched** — `path#symbol` references only. No line numbers, no
   pasted content. Group by file.
4. **Status** — what's done, then what's next.
5. **Dead ends** — approaches already tried and ruled out, and why, so the
   next session doesn't repeat them.

Keep the whole document under roughly 500 words. Reference paths and
symbols instead of pasting file contents; a function signature is fine, a
function body is not. Leave out a section entirely rather than writing
"N/A" for it.

When done, tell the developer the handoff file's path and that a new chat
can now start from it.
