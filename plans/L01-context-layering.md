# L01 — Context layering for agent documentation

**Status:** implemented 2026-07-27.

## Problem

The repository had no `CLAUDE.md`. Every agent session started by re-deriving the same
facts from five READMEs (606 lines) and the source tree: which package manager to use,
why cross-package imports resolve to sibling source, that migrations do not run on boot.
That work was repeated, slow, and occasionally wrong.

The naive fix — one large `CLAUDE.md` holding everything — fails for a different reason.
The root file is loaded into **every** session, so its cost is paid whether or not the
task needs it, and a long file drowns its own rules in noise. Adherence degrades before
the context window does.

## Approach

Match each kind of knowledge to the cheapest mechanism that can deliver it on time.

| Mechanism | Carrier | Start-up cost |
|---|---|---|
| Eager | root `CLAUDE.md` | paid every session → hard cap **100 lines** |
| Automatic | `<module>/CLAUDE.md`, loaded on touching that folder | none |
| Conditional | READMEs, `docs/`, `specs/`, `INSIGHTS.md` behind pointers | none |
| Lazy | `.claude/skills/*` — already in place | description only |
| Explicit | slash commands — deliberately deferred to L06 | none |

**No `@import`.** Imports are eager, which defeats the point. Pointers only.

### Rules

1. The root file carries what an agent cannot infer from the code: stack versions,
   non-obvious commands, conventions that contradict the framework default, gotchas, and
   do-not-touch zones.
2. Module conventions live in that module's `CLAUDE.md` and are **never** duplicated at
   the root.
3. Pointers are phrased as instructions — "Read X before doing Y" — not as footnotes. A
   footnote is advisory and gets skipped; an instruction is followed.
4. Nothing is copied out of a README or `docs/` page. Those stay the source of truth and
   get linked.
5. The line test decides every line: *if I delete this, will the agent start making
   mistakes?* If no, delete it.

### Layout

```
CLAUDE.md · INSIGHTS.md · docs/ · specs/
server/         CLAUDE.md · INSIGHTS.md · docs/ · specs/
client/         CLAUDE.md · INSIGHTS.md · docs/ · specs/
reviewer-core/  CLAUDE.md · INSIGHTS.md · docs/ · specs/
e2e/            CLAUDE.md · INSIGHTS.md · docs/
```

`e2e/` gets no docs-spec folder: `e2e/specs/` already holds live `*.flow.json` browser
scenarios, and overloading the name would be worse than the asymmetry.

## Decisions and their alternatives

**`INSIGHTS.md`, not `LEARNINGS.md`.** The course slide for this lesson says
`LEARNINGS.md`. `INSIGHTS.md` was chosen because the file holds both "why it is built
this way" and "what I tripped over", and the broader name invites both.

**Seeded, not empty.** Placeholder folders decay into noise. Every `INSIGHTS.md` in this
change ships with real entries found while surveying the repo, so the format is
demonstrated rather than described.

**Symmetry accepted despite its cost.** Fifteen new files will drift from the code if
nobody maintains them. They cost no start-up tokens, so the risk is staleness, not
budget. L06 should add a hook that prompts an `INSIGHTS.md` update after a module's
tests fail.

## Known weakness

Automatic loading of subdirectory `CLAUDE.md` files is not reliable in every editor
(`anthropics/claude-code#24987`). The root file therefore names `<module>/CLAUDE.md`
explicitly in its pointer list, so the knowledge is reachable even when the automatic
mechanism does not fire.

## Acceptance

- Root `CLAUDE.md` ≤ 100 lines; each module file ≤ 50.
- Every path referenced in a pointer exists.
- A fresh session answering "how do I run the server's integration tests?" cites
  `CLAUDE.md` instead of reading `package.json`.
- No Cyrillic in any committed file.
