# L02 — engineering-insights, a capture skill

**Status:** implemented 2026-07-27.

## Problem

L01 shipped five `INSIGHTS.md` files seeded with eighteen entries and no way to grow them.
An agent that discovers something non-obvious mid-session has no instruction to record it,
so the knowledge dies with the context window and the next session rediscovers it. The
files also had no internal structure — an agent with something to add had no slot to put it
in, and "append somewhere sensible" produces drift.

## Approach

A skill supplies the judgement (is this worth recording, and where); the files supply the
structure (fixed sections to append into); `CLAUDE.md` supplies the pointer that makes it
fire.

### The skill

`.claude/skills/engineering-insights/SKILL.md`, locally authored, not pinned in
`skills-lock.json`. It carries seven things and nothing else:

| Part | Why it is there |
|---|---|
| Routing table | Which module's file receives the entry |
| The seven sections | Where inside that file it goes |
| Quality gate | What is worth recording at all |
| Entry format | So entries stay diff-able and greppable |
| Two triggers | Capture as you go, and again at wrap-up |
| append-only | Protects a shared file from mid-session rewrites |
| Stated limit | The skill is model-invoked, so firing is not guaranteed |

### File structure

Every `INSIGHTS.md` carries the same seven `##` sections in the same order — What Works ·
What Doesn't Work · Codebase Patterns · Tool & Library Notes · Recurring Errors & Fixes ·
Session Notes · Open Questions. Entries are `###` beneath them. Empty sections keep a
placeholder line, because a section the agent cannot see is a section it will not use.

### Routing

The module a change touched decides the file. Work spanning two or more modules, or in
`scripts/` `docs/` `.github/`, goes to the root file. Vendored `shared/` drift is the case
that proves the rule: it is found inside one package, but the lesson is about the pair.

## Decisions and their alternatives

**`INSIGHTS.md`, not `LEARNINGS.md`.** The lesson slides say `LEARNINGS.md`. L01 already
settled this the other way and the repo has five files under the existing name; a rename
would have been churn for nothing. Confirmed with the author as a slide typo.

**Real module names.** The slides route to `apps/client`, `apps/server`,
`packages/reviewer-core` and `packages/repo-intel`. None of those paths exist here. The
routing table names `client/`, `server/`, `reviewer-core/` and `e2e/`, and adds the root
rule the slides have no equivalent for.

**Longer than the slide's "5–8 lines".** That figure describes the artifact written live
during the lesson. The routing table and seven section names alone exceed it. The shipped
file is ~100 lines, well inside Anthropic's 500-line guidance.

**append-only, resolving a contradiction.** The root file previously said "delete an entry
when the underlying cause is fixed"; the slides say never overwrite. Split by actor — the
agent only appends, and a human prunes in a separate deliberate pass. A rewrite mid-session
erases another contributor's lesson and conflicts on merge.

**No hook.** A `Stop` hook would make capture unconditional, and the honest reading is that
a model-invoked skill will sometimes not fire. L06 owns that; L01 already deferred hooks.
The skill says so in its own text rather than implying a guarantee it cannot keep.

**Description carries triggers only.** The frontmatter description names the conditions
under which the skill applies and deliberately does not summarise its workflow — a
description that summarises becomes a shortcut the agent follows instead of reading the body.

## Known weakness

Firing is not guaranteed. Between the description, the `CLAUDE.md` pointer and manual
`/engineering-insights`, there are three ways in, and none is the system calling it.
Measuring how often capture actually happens is the input L06 needs.

Seven sections across five files means thirty-five headings, most of them empty at the
start. That is the cost of giving the agent a slot to find; if a section is still empty
after several lessons, it is evidence to drop it, not to keep waiting.

## Acceptance

- All five `INSIGHTS.md` carry the same seven sections in the same order.
- The eighteen L01 entries survive the restructure unchanged in wording.
- `SKILL.md` ≤ 100 lines; root `CLAUDE.md` still ≤ 100 lines.
- No Cyrillic in any committed file.
- Given "vendored shared/ disagrees between packages", a fresh session writes to the root
  file, not to the package it was working in.
- Given a platitude ("async can be tricky here"), a fresh session declines to write it.
