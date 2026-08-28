---
name: dependency-checker
description: "Analyzes this repo's dependencies — external npm packages per package (client, server, reviewer-core, e2e, mcp) and the internal, no-workspace cross-package graph (tsconfig path aliases, the twice-vendored shared/) — and renders one structured report: a Mermaid graph, an installed-size table, findings graded P0/P1/P2/Info, and a ranked summary. Use whenever asked to check, audit, analyze or map dependencies, find unused or duplicate packages, see what depends on what, or explain why a package is so large. Read-only: it recommends, it never runs npm/pnpm remove or edits a package.json."
metadata:
  version: "1.0.0"
  tags: dependencies, npm, pnpm, mermaid, audit, package-size
---

# Dependency Checker

Answers three questions this repo cannot answer any other way, because it is five
independent packages with no workspace (root `CLAUDE.md`): what does each package actually
depend on, what do the packages depend on *each other* for, and which of that is worth
doing something about.

**Read-only.** This skill reports and recommends. It never runs `npm remove` / `pnpm remove`,
never edits a `package.json`, and never deletes a `node_modules` entry. Removing a dependency
is a recommendation for a human to confirm, not an action this skill takes — the same rule
`pr-self-review` follows for the same reason: a run that changes the tree it just analyzed
makes its own report stale before anyone reads it.

## Navigation

| Read | For |
|---|---|
| **This file** | When it runs, the procedure, the exact report template |
| [severity.md](severity.md) | The four tiers — P0/P1/P2/Info — with this repo's own examples |
| [graph.md](graph.md) | How internal (source-level) edges differ from external npm ones, and this repo's real graph |
| [README.md](README.md) | Scope, boundary with `security` and `onion-architecture`, sources |

## 1. When to run

Run when asked to check, audit, map, visualize or clean up dependencies; to find unused,
duplicate or oversized packages; to explain what a package pulls in or why install is slow;
or when a PR review (`pr-self-review`, `/code-review`) turns up a dependency question this
skill answers better than an ad hoc grep.

Do **not** run this for a single known-CVE check (`security` skill §A03 owns that), for
"why is this query slow" (nothing here profiles code), or for intra-`server/` layering —
whether a route belongs in `service.ts` or `repository.ts` is `onion-architecture`'s question,
not this one. See [README.md](README.md) §Boundary.

## 2. The procedure

**1 — Scope it.** Default to all five packages: `server`, `client`, `reviewer-core`, `e2e`,
`mcp`. If the user names one or two, narrow to those — the report's own Scope section says
which.

**2 — Gather the raw data.** Don't hand-parse five `package.json` files and run `du -sh` by
eye — that's what the script is for:

```sh
bash scripts/dependency-checker/collect.sh [package ...]
```

It prints one JSON object: per package, its manager (`pnpm` or `npm` — root `CLAUDE.md`:
`server`/`client` use pnpm, `reviewer-core`/`e2e`/`mcp` use npm, and mixing them is its own
kind of failure), every `dependencies`/`devDependencies` entry with its declared range,
installed version, on-disk size, and (dependencies only) whether it's actually imported
anywhere under that package's own source — plus a repo-wide `versionDrift` list: any runtime
dependency name resolved to more than one version across packages.

**`imported: false` is a lead, not a verdict.** The script's usage check is a grep over
`import`/`require`/dynamic-`import()` statements, and three real shapes in this repo already
defeat a naive one: a CLI tool invoked only via a `package.json` script
(`dependency-cruiser`, run through `pnpm exec depcruise`, never `import`ed — server's own
gate), a framework peer dependency an app never imports directly (`react-dom` — Next.js uses
it internally), and a dynamic import wrapped in a comment the regex can't see through
(`@vscode/ripgrep`, imported as `import(/* @vite-ignore */ '@vscode/ripgrep')`). Before
calling something unused: check the package's `scripts` in `package.json`, and grep once more
for the bare name across the whole package (not just `src/`) before you trust the flag.
`@fastify/autoload` in `server/package.json` is the repo's one *confirmed* case — installed,
never imported, and `server/AGENTS.md`/root `CLAUDE.md` say autoloading is deliberately not
used here, so there's no live path that would ever import it.

**3 — Read the internal graph from `tsconfig.json`, not from guessing.** `compilerOptions.paths`
is the ground truth for which packages a package can reach at the source level — see
[graph.md](graph.md) for how to read it and this repo's actual edges (`server → reviewer-core`,
`reviewer-core → server`'s vendored `shared/`, and the two packages that only ever reach each
other over HTTP). A path alias resolving to another package's `src/**` behind a wildcard
(`@devdigest/reviewer-core/*`, not the bare `@devdigest/reviewer-core`) is reachable for a deep
import that bypasses the target's public entry point — grep for whether anything actually uses
that wildcard before deciding it's a live problem.

**4 — Grade every finding P0, P1, P2, or Info.** Open [severity.md](severity.md) before
grading — the names alone are not the rule, the deciding question is *what does leaving this
alone cost*. A finding with no clear cost is Info, not P2 padding it out.

**5 — Render the report in the exact structure below.** Section names matter — a downstream
reader (and this skill's own eval) checks for them literally.

## 3. Report structure

```markdown
# Dependency Check — <repo or package name> (<date>)

## Scope
<which packages were analyzed, and which were explicitly excluded and why>

## Dependency Graph
```mermaid
flowchart LR
  <one node per package, solid edges for source-level imports, dashed for HTTP/runtime-only>
```
<one or two sentences on what the graph shows that isn't obvious from looking at it>

## External Dependencies — Size & Type
| Package | Dependency | Type | Version | Installed Size |
|---|---|---|---|---|
<one row per dependency worth naming — not every devDependency needs a row if nothing about
it is notable, but do not omit anything a finding below refers to>

## Findings & Priorities
### P0
### P1
### P2
### Info
<each finding names a specific package, dependency, and file — never a generic
"consider auditing dependencies">

## Summary
<3-5 concrete, ranked, actionable takeaways — not a restatement of every finding above>
```

**No section is optional, and an empty tier still gets its heading** (`### P0` with nothing
under it if there is nothing — the reader needs to know P0 was checked and came back clean,
not that it was skipped). §5 in [severity.md](severity.md) says the same for a genuinely clean
run: zero findings is a valid result, never padded to look thorough.

## 4. Red flags

| Red flag | Why it is wrong |
|---|---|
| "It's not imported, I'll list it as unused" | §2 — check `scripts` and the whole package first; `dependency-cruiser` and `react-dom` are real false positives here |
| "I'll just run `pnpm remove` while I'm here" | intro — this skill recommends, a human confirms |
| "Two packages both vendor `shared/`, that's duplication" | [graph.md](graph.md) §3 — that duplication is deliberate and gated (`shared-sync`); report drift between the copies, not the existence of two copies |
| "No P0s, I'll invent one so the report looks thorough" | §5 above — an empty tier is a real result |
| "This is a security question, I'll check for CVEs" | README.md §Boundary — that's `security` skill §A03, not this one |
