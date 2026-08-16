---
name: engineering-insights
description: "Use when work in this repo surfaces something non-obvious — a failure that cost real time, a convention that contradicts the framework default, a dependency quirk, a decision with a rejected alternative, or a question left unresolved. Also use at the end of any substantial task, before reporting it complete."
---

# Engineering Insights

Record what a session learned into the `INSIGHTS.md` of the module the work touched, so the
next session in that module starts with it instead of rediscovering it.

## When to write

- **As you go** — the moment something costs you time or surprises you. Waiting until the
  end is how it gets forgotten.
- **At wrap-up** — before reporting a task complete, review the session for anything worth
  keeping.

Skip trivial config edits and routine changes. Signal quality matters; volume does not.

## Which file

| Work touched | Write to |
|---|---|
| `server/**` | `server/INSIGHTS.md` |
| `client/**` | `client/INSIGHTS.md` |
| `reviewer-core/**` | `reviewer-core/INSIGHTS.md` |
| `e2e/**` | `e2e/INSIGHTS.md` |
| Two or more modules, or `scripts/` `docs/` `.github/` | root `INSIGHTS.md` |

A cross-package lesson goes to the root even when you edited only one package. Vendored
`shared/` drift is the standard case: found in one package, but the lesson is about the pair.

## Which section

Every file carries these seven, in this order. Append under the one that fits; never
invent a new one.

| Section | Holds |
|---|---|
| What Works | An approach that succeeded and should be reused |
| What Doesn't Work | A dead end or antipattern — the most valuable section, and the most skipped |
| Codebase Patterns | A convention or architectural decision, including deliberate ones that look like bugs |
| Tool & Library Notes | A quirk of a dependency, package manager, or toolchain |
| Recurring Errors & Fixes | An error that will happen again, with its fix |
| Session Notes | Dated summary of a session worth recalling |
| Open Questions | Something left unresolved |

## The quality gate

**If this would be obvious to anyone reading the code, do not write it.**

An entry must be actionable cold: a fresh agent reads it and knows what to do without
chasing anything down. Name the file, the command, the number.

> **Bad.** "Vendored copies can drift." Noise, not a lesson.

> **Good.** `client/src/vendor/shared/` drifted from the server copy on 2026-07-27 and
> nothing failed until runtime, because each package typechecks against its own copy.
> Verify with `diff -r server/src/vendor/shared client/src/vendor/shared`.

Writing nothing is a valid outcome. An empty section beats a platitude in it.

## An insight is a record, not a rule

`INSIGHTS.md` says *this happened, here is what it cost, here is what to check*. `AGENTS.md`, a
skill and a dependency-cruiser rule say *always do this*. **Promoting one to the other is a
separate, deliberate act, and it is not yours to make while writing the entry.**

The difference is what a reader may skip. An insight is advice a future agent weighs against its
own situation; a rule is a constraint it obeys without weighing. Turn every observation into a
rule and the rules stop being read, because most of them will not apply — and the one that
mattered is now buried among forty that did not.

Two tests before you even suggest a promotion, and both must hold:

- **It recurred.** Once is an anecdote; a dated correction under an existing entry is the honest
  home for the second occurrence. A rule earns its place on the third.
- **Obeying it blindly is right every time.** If the answer is "it depends on the module", it is
  an insight. Rules that need a judgement call are worse than no rule, because they get followed
  where they do not fit.

When both hold, say so in your report as a recommendation with the file it belongs in — and leave
the entry in `INSIGHTS.md` where it is. Whoever owns that rule file decides.

## Entry format

Section headings are `##`. Each entry is `###` beneath one of them.

```markdown
### A short claim, stated as what you observe

**Symptom.** What you see.
**Cause.** Why it happens.
**Fix.** What to do.
```

`Symptom / Cause / Fix` is required in Recurring Errors & Fixes, optional elsewhere — use
plain prose where it does not fit. Cite evidence as `path/to/file.ts:42` and write dates as
`YYYY-MM-DD` inline. Session Notes entries are `### YYYY-MM-DD` plus bullets; Open Questions
are bullets, not headings.

## Append only

Add entries; never rewrite or delete one. A rewrite mid-session erases someone else's lesson
and causes merge conflicts on a shared file. If an entry is now wrong, append a dated
correction beneath it and leave the original standing. Pruning is a separate, deliberate
human pass — not your job during a session.

## Limits

This skill fires on its description or on `/engineering-insights`. That is model-invoked and
so not guaranteed; if a session is ending without a capture, invoke it by hand. A `Stop` hook
would make it automatic — that is lesson L06, and it does not exist yet. Everything committed
to this repo is English, entries included.
