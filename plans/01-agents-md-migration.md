# 01 — `AGENTS.md` as the canonical instruction file

**Status:** implemented 2026-08-01. Supersedes the file naming in
[`L01-context-layering.md`](L01-context-layering.md); the layering itself is unchanged.

## Problem

The L01 context layer worked, but its carrier was named after one vendor. Codex, Cursor,
Gemini CLI, Jules and the rest of the `AGENTS.md` ecosystem open this repository and find
nothing: no stack table, no package-manager rule, no do-not-touch zones. Every one of
them re-derives the same facts L01 exists to prevent re-deriving.

Renaming is not free, because **Claude Code does not discover `AGENTS.md`**. Verified
against 2.1.220: the memory loader reads exactly `<dir>/CLAUDE.md`, `<dir>/.claude/CLAUDE.md`,
`<dir>/CLAUDE.local.md` and `<dir>/.claude/rules/`, and nested module files are filtered
by basename against `["CLAUDE.md", "CLAUDE.local.md"]`. The binary's only other mention of
`AGENTS.md` is the Codex-config importer, which *copies* `AGENTS.md` into `CLAUDE.md`. A
plain rename would have switched the whole layer off for Claude Code, silently — no error,
no warning, just an agent that no longer knows the rules.

## Approach

`AGENTS.md` is the real file in all five directories. `CLAUDE.md` beside it is a
git-tracked symlink (mode `120000`, relative target `AGENTS.md`).

```
AGENTS.md · CLAUDE.md -> AGENTS.md · INSIGHTS.md · docs/ · specs/
server/         AGENTS.md · CLAUDE.md -> AGENTS.md · …
client/         AGENTS.md · CLAUDE.md -> AGENTS.md · …
reviewer-core/  AGENTS.md · CLAUDE.md -> AGENTS.md · …
e2e/            AGENTS.md · CLAUDE.md -> AGENTS.md · …
```

One file per directory, so the two names cannot drift. No extra eager tokens: Claude Code
loads `CLAUDE.md` and gets `AGENTS.md`'s bytes; every other tool reads `AGENTS.md`
directly. A skill or `/init` that writes to `CLAUDE.md` writes through to `AGENTS.md`.

Both halves were verified empirically, not assumed — the root file through a fresh
`claude -p` that returned `# DevDigest`, and the nested layer through a session that read
`server/src/platform/config.ts` and then quoted the "migrations do not run on boot" rule
that lives only in `server/AGENTS.md`.

## Decisions and their alternatives

**Symlink, not a pointer stub.** A real three-line `CLAUDE.md` reading "the instructions
live in `AGENTS.md`, read it now" would have avoided symlinks entirely and worked on any
filesystem. It was rejected because it spends eager context on a redirect and makes the
rules conditional on the model following a pointer — L01's own weakness, reintroduced at
the root of the tree. It remains the fallback if a future Claude Code stops resolving the
link.

**Symlink, not a copy behind a CI gate.** Duplicating the content and diffing the two
copies in CI would have mirrored the existing `shared-sync` workflow, which guards the
vendored `shared/` directories. Rejected: `shared-sync` exists because two packages must
each compile against their own copy. Nothing here forces a second copy, so the gate would
be maintenance invented to police a duplication we chose to create.

**History left alone.** `specs/L01`, `specs/L02`, `INSIGHTS.md` and the plan under
`docs/superpowers/plans/` still say `CLAUDE.md`. `specs/README.md` requires it — *"leave
the spec as a record — do not rewrite history to match the implementation"* — and the
symlink keeps every path in them resolvable. Only prose that instructs a reader *now* was
retargeted.

## Known weakness

`AGENTS.md` standardises instructions, not capabilities. `.claude/skills/*`,
`.claude/settings.json` and the `engineering-insights` skill stay Claude-only; another
tool gets the conventions but not the tooling built on top of them. Windows contributors
would need `core.symlinks=true` for the shim to materialise as a link rather than a text
file — no concern while development is macOS with Linux CI.

The shim also does not survive a ZIP export: `git archive --format=zip` writes the link
target as file content, so GitHub's "Download ZIP" yields a nine-byte `CLAUDE.md` reading
`AGENTS.md`. Tar archives and real checkouts keep the link. Clone, do not download.

## Acceptance

- `git ls-files -s` reports mode `120000` for all five `CLAUDE.md` entries.
- A fresh Claude Code session loads the root file and the module file for the folder it
  is working in.
- Every path named in a pointer exists, root `AGENTS.md` ≤ 100 lines, module files ≤ 50 —
  the L01 criteria, still enforced.
- `CLAUDE.md` appears in prose only where the shim itself is being explained, or inside a
  historical record.
