# 03 — pr-self-review, a skill behind a blocking hook

**Status:** planned 2026-08-02.

## Problem

Thirteen skills sit in `.claude/skills/`, and five CI workflows measure the repo. Neither fires
before a pull request is opened. The skills load only when an agent happens to judge them
relevant to the file it is editing; the workflows run after the branch is already public. So the
first thing that tells us a change violates the dependency rule, drops a secret into `AppConfig`,
or lets the two vendored copies of `shared/` drift is a red check on GitHub — after review has
been requested from a human.

Two specific gaps make this worse than a generic "run CI locally" complaint:

- **Skill coverage is accidental.** An agent editing `FindingsPanel.tsx` may open
  `react-best-practices` and never open `frontend-architecture`. Nothing routes files to skills.
- **Only three of thirteen skills can be applied to a diff at all.** `frontend-architecture`,
  `onion-architecture` and `typescript-expert` end in a `## Review checklist`. The other ten are
  prose guides with no entry point for a reviewer.

The goal is narrow: review every open local change against the conventions this repo already
wrote down, and make a `critical` finding stop the change from reaching GitHub.

## Approach

**The hook does not review. It checks a verdict.**

Claude Code hooks are shell commands; they cannot call a model. Trying to make the hook do the
review is the design mistake to avoid. So the work splits:

| Part | Does | Artifact |
|---|---|---|
| The skill | Reviews the diff, decides severity | `.pr-self-review/latest.json` + a printed report |
| The hook | Reads the verdict, blocks or allows | `exit 2` on `git push` / `gh pr create` |

The verdict file carries `{ verdict, criticals[], baseSha, headSha, dirtyHash, generatedAt,
mode, skipped }`. The hook rejects it as stale when `headSha` moved, when `dirtyHash` no longer
matches the working tree, or when the merge-base with `main` moved under the branch.

`mode` is what makes one verdict serve both commands. `git push` is satisfied by a fresh verdict
of mode `gates` **or** `full`; `gh pr create` requires mode `full`. A missing, stale, or
insufficient-mode verdict fails the same way: `exit 2` telling the agent which run to perform.

### Two tracks

**Track A — deterministic gates.** No model. Run first, and only for packages present in the
diff, so a docs-only change costs nothing.

| Gate | Command |
|---|---|
| Architecture | `cd server && pnpm arch` — exit 0 **and** the baseline did not grow |
| Types | `pnpm typecheck` in `server/`, `client/`, `reviewer-core/` |
| Lint | `cd client && pnpm lint` |
| Unit tests | server `vitest run --exclude '**/*.it.test.ts'`, client, reviewer-core |
| Vendor drift | `diff -r server/src/vendor/shared client/src/vendor/shared` |

A failure here is `critical` by definition — no interpretation, no second opinion.

**Track B — skill review by parallel subagents.** Changed files route to domains; each subagent
sees only its own files and returns findings as JSON, never prose.

| Diff matches | Subagent | Opens |
|---|---|---|
| `client/src/**/*.{ts,tsx}` | Frontend | `frontend-architecture`, `react-best-practices`, `next-best-practices` |
| `client/**/*.test.{ts,tsx}` | Frontend tests | `react-testing-library` |
| `server/src/modules/**`, `adapters/**`, `platform/**` | Backend | `onion-architecture`, `fastify-best-practices` |
| `server/src/db/**`, `**/schema.ts`, `server/drizzle/*.sql` | Data | `drizzle-orm-patterns`, `postgresql-table-design` |
| `**/contracts/**`, `*.schema.ts` | Contracts | `zod`, `typescript-expert` |
| `reviewer-core/src/**` | Core | `onion-architecture` (Core ring only) |
| routes, request input, auth, secrets, uploads | Security | the built-in `/security-review` |

Fan-out follows `superpowers:dispatching-parallel-agents` rather than a bespoke scheme.

### The skill registry, and what is deliberately unused

Skills come from three places. `~/.claude/skills/` does not exist here, so there is no fourth.

**Project — `.claude/skills/`.** All thirteen are accounted for. The eleven routed above, plus
`mermaid-diagram` (unused; a review draws nothing) and `engineering-insights` (not a gate — the
report suggests it when the run surfaced something non-obvious).

**Plugins — `~/.claude/plugins/cache/claude-plugins-official/`.**

| Skill | Role |
|---|---|
| `superpowers:requesting-code-review` | Boundary. It requests review from another agent; this skill checks conformance to repo conventions |
| `superpowers:verification-before-completion` | The report format follows it: real command output, not a claim that a command passed |
| `superpowers:dispatching-parallel-agents` | The fan-out mechanism |
| `superpowers:receiving-code-review` | The next step for whoever acts on the findings |
| `superpowers:test-driven-development` | Source of one rule: new behaviour with no test is `major` |
| `superpowers:finishing-a-development-branch` | The next step after a clean run |
| the remaining `superpowers:*` and all `chrome-devtools-mcp:*` | Not applicable to a static diff |

**Built-in.** `/security-review` is invoked, not paraphrased. `/code-review` hunts bugs and is
explicitly *not* this skill's job — the report ends by pointing at it. `simplify` is an optional
pass after a clean run, never a gate. `claude-api` is skipped on purpose: `reviewer-core` depends
on `openai`, which is that skill's own documented SKIP condition, and saying so in `routing.md`
stops an agent burning context rediscovering it.

**Precedence.** When two skills disagree, the repo skill wins. `drizzle-orm-patterns` will
happily show a query inside a handler; `onion-architecture` §3.2 forbids it. Without this rule
written down, two subagents put contradictory findings in one report.

### What is never reviewed

Three buckets, because "skip it" and "ignore it" are different answers.

**Ignored.** Not read, counted in the report and nothing more: `**/node_modules/**`, lockfiles,
`server/clones/**`, `.screenshots/**`, `client/.next/**`, `dist/**`, `build/**`, `coverage/**`,
binaries (`*.png *.jpg *.svg *.ico *.woff2 *.pdf`), and `server/drizzle/meta/**` (generated
journal and snapshots — the `.sql` migrations beside them *are* reviewed).

**Flag-only.** No domain skill runs, but presence in the diff is itself the finding:

| Path | Severity |
|---|---|
| `.env`, `*.env` (not `.env.example`) | critical — secret leak |
| a skill listed in `skills-lock.json` | critical — pinned upstream copy |
| any `CLAUDE.md` that stopped being a symlink | critical — the Claude Code shim is broken |
| `server/src/vendor/**`, `client/src/vendor/**` | major; critical if the copies diverge |
| `e2e/specs/*.flow.json` | major — live scenarios, not documentation |
| `docs/agent-prompts/**` with no matching DB change | major — the DB is the source of truth |

**Reviewed.** Everything else, by the routing table.

### Severity, and what blocks

Only `critical` blocks. It means: a Track A gate failed; a dependency-rule violation (Drizzle
outside `repository.ts`, `container.db` in a route, `adapters/` importing `modules/`); a secret
in `AppConfig`, `process.env`, or reachable from the client module graph; an OWASP finding
(injection, authorization bypass, path traversal, SSRF); vendor drift; a new Fastify module
absent from `modules/index.ts`; a test deleted or skipped to make a gate green.

`major` is fixed before the PR but does not block. `minor` and `note` are records.

**A model finding cannot block on its own.** Track A blocks immediately. A `critical` from a
subagent goes to a second adversarial verifier — "try to refute this; if uncertain, refuted" —
and drops to `major` unless confirmed.

**Every finding cites a rule.** `file:line` plus the skill section that was violated
(`[onion §3.2]`). A finding with no rule reference is dropped before the report is written; that
is what keeps this from becoming vague model nagging.

### The report

Printed after the run; the JSON is written alongside for the hook.

```
━━ PR Self-Review ─ feat/findings-severity-filter ━━━━━━━━━━━━━━━━━━━
  BLOCKED · 1 critical · 3 major · 2 minor            12.4s
  Scope  main…HEAD +7 uncommitted · 18 reviewed · 9 ignored · 2 flagged

  Gates                                            (track A, no model)
    ✔ server arch        exit 0, baseline 41 → 41
    ✘ client lint        exit 1 — 1 error
    ⊘ server unit tests  skipped — no server/src file in diff

  CRITICAL
  1  client/src/…/FindingsPanel.tsx:64          [gate: client lint]
     react-hooks/exhaustive-deps — `repoId` missing from deps
     Fix: cd client && pnpm lint --fix

  MAJOR
  2  client/src/…/FindingsPanel.tsx:31   [frontend-architecture §5]
     Shareable filter state in useState, not the URL · verifier 2/2

  Coverage   nothing truncated · flag-only: e2e/specs/pr-review.flow.json
  Next       /pr-self-review --only critical · bugs are /code-review
  Verdict → .pr-self-review/latest.json (HEAD 6f7ebb4)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Rules the report obeys: gates print real exit codes; a skipped gate states why; nothing is
truncated silently; and **an empty report is a valid result** — zero findings print as zero.
Inventing a finding so the run looks useful is prohibited in `SKILL.md`, for the same reason
`INSIGHTS.md` records that local reviews legitimately return nothing.

After a clean run the report appends a paste-ready PR description. The diff has already been
read; drafting it costs almost nothing and is the next thing anyone does.

On `main`, the skill does not review — it says to branch first.

### Artifacts

```
.claude/skills/pr-self-review/{SKILL.md,gates.md,routing.md,severity.md,README.md}
.claude/commands/pr-self-review.md      slash command; --gates, --full, --only critical
.claude/settings.json                   PreToolUse hook (no such file today)
scripts/pr-self-review-gate.sh          reads the verdict; never reviews
scripts/fixtures/pr-self-review/        deliberately bad diffs, one per critical rule
.gitignore                              += .pr-self-review/
.claude/skills/README.md                += catalog row
```

Not added to `skills-lock.json` — this skill is ours.

## Decisions and their alternatives

**`git push` runs Track A only; `gh pr create` runs everything.** Requiring a full fan-out for
every WIP push means dozens of model runs a day for changes nobody will ever read. The gate that
actually catches breakage cheaply — typecheck, lint, arch, vendor diff — costs seconds and runs
on every push. The expensive judgement runs once, where it pays: at the PR boundary.

**An escape hatch exists and is recorded.** `PR_SELF_REVIEW_SKIP=1 git push` passes, and the
bypass is written into `latest.json` and printed in the next report. A gate with no override is
removed from `settings.json` the first time it is inconvenient, and then protects nothing. A
recorded override is visible; a deleted hook is not.

**A Claude Code hook, not a git `pre-push` hook.** A git hook would also catch pushes from the
IDE, which is a real advantage. But it cannot run Track B at all — there is no agent behind it —
so it would enforce only the half that CI already enforces, at the cost of a second maintenance
point and a slower push. Consequence accepted below.

**The skill routes; it does not restate rules.** Rules live in the skills they came from. A
fourth copy of "no Drizzle in a route" would drift from the three that exist
(`onion-architecture`, `.dependency-cruiser.cjs`, `server/AGENTS.md`). For the ten skills with no
checklist, `routing.md` carries three to six *pointers* per skill, not their content.

**Findings are dropped unless they cite a rule.** The alternative — let subagents report whatever
they noticed — produces a report nobody reads by the third run, and the block becomes noise.

**Fail-fast ordering, and a fixed time budget.** Track A first: a broken typecheck ends the run
in seconds without paying for subagents. Exceeding the budget reports partial coverage and is
never a pass.

**The verdict is cached by diff hash.** Re-running with an unchanged diff reuses the verdict, so
a push after a rebase-less retry is free.

## Known weakness

**A push outside Claude Code bypasses the gate completely.** A `git push` from WebStorm or a
plain terminal never reaches a `PreToolUse` hook. This is the direct cost of the decision above,
and it means the gate is a fast feedback loop for agent-driven work, not an enforcement boundary.
CI remains the only thing that cannot be walked around.

**Track B is not reproducible.** Two runs over the same diff can differ. Adversarial verification
reduces the false-positive rate but cannot make model output deterministic, so only Track A
findings are stable enough to argue with. Anything blocking that came from a subagent should be
readable as a claim with evidence, not as a verdict.

**The flag-only table is a second copy of `CLAUDE.md` prose.** The do-not-touch list, the
symlink rule and the DB-is-source-of-truth rule live in `CLAUDE.md` today. Encoding them in
`routing.md` creates exactly the drift this spec warns about elsewhere. Mitigation is a single
acceptance check comparing the two lists; there is no mechanism that keeps them honest.

**Staleness detection cannot see everything.** `headSha` + working-tree hash + merge-base cover
the common cases. A dependency install, an env change, or an edit to a skill itself leaves the
verdict looking fresh while its basis moved.

**The value is unmeasured until the baseline runs.** `.claude/skills/README.md` requires
measuring against an agent without the skill. Spec 02 found every RED agent reached the right
answer unaided, and the skill bought speed rather than correctness. The same may hold here — the
part most likely to earn its keep is the routing table, since accidental skill coverage is the
gap that started this.

## Acceptance

- Every fixture in `scripts/fixtures/pr-self-review/` produces its expected `critical`, and
  removing the defect makes the run pass. One fixture per critical rule, including a Drizzle call
  in a route, a secret in `AppConfig`, divergent vendor copies, and an unregistered Fastify
  module.
- `git push` with a failing `cd client && pnpm lint` is blocked; the same push with
  `PR_SELF_REVIEW_SKIP=1` succeeds and the bypass appears in `latest.json` and in the next report.
- A verdict is rejected as stale after a new commit, after an uncommitted edit, and after the
  merge-base with `main` moves.
- A docs-only diff runs no gate for `server/` or `client/`, and each skipped gate states why.
- A clean run prints zero findings and drafts a PR description; it invents nothing.
- Every path in the ignored and flag-only tables matches `CLAUDE.md` §"Do not touch"; a diff of
  the two lists is empty.
- `SKILL.md` is under 500 lines, `name` matches the directory, file references are one level
  deep, and the frontmatter has no top-level `version`.
- The skill is absent from `skills-lock.json` and present in `.claude/skills/README.md`.
- The RED/GREEN baseline is run and recorded in the skill's `README.md`, with RED being a genuinely
  absent skill rather than an instruction not to use it.
- No Cyrillic in any committed file.
