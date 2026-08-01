# 03 — pr-self-review, a blocking pre-PR gate

**Status:** proposed 2026-08-01.

## Problem

The repo already owns the knowledge and the measurements. Nothing schedules them.

- **Thirteen skills sit in `.claude/skills/`, and activate on the agent's own judgement.**
  A skill fires when the model decides it is relevant — which happens while writing code, if at
  all, and never as a sweep over everything a branch changed. `frontend-architecture` and
  `onion-architecture` each end with a `Review checklist` written to be run against a diff. No
  workflow runs them.
- **Seven CI workflows catch gate failures after the push.** `pnpm arch`, `lint`, `typecheck`,
  the test suites and `shared-sync` all report on GitHub, minutes later, on a branch that is
  already public. The same commands run locally in seconds.
- **Convention violations have no gate at all.** "State that is shareable belongs in the URL",
  "a `*Row` type must not leave its module", "a new route must be registered by hand in
  `modules/index.ts`" — prose in a skill or in `AGENTS.md`, measured by nobody.
- **Only three of thirteen skills expose a checklist** (`frontend-architecture`,
  `onion-architecture`, `typescript-expert`). The other ten are prose guides with no entry point
  for review.
- **The skill registry has already drifted.** `skills-lock.json` names `architecture-patterns`
  and `github-workflow-automation`, and neither directory exists. Seven directories —
  `engineering-insights`, `frontend-architecture`, `mermaid-diagram`, `onion-architecture`,
  `react-best-practices`, `react-testing-library`, `security` — have no lock entry, so by the
  rule in `CLAUDE.md` they read as locally authored whether or not they are.
  `.claude/skills/README.md` promises a `.cursor/skills` symlink that is not in the tree.

Spec 02 solved this shape once for one rule: a skill supplies the judgement, a gate supplies
the measurement. This spec applies the same split to everything a branch touches, and adds the
part 02 did not need — refusing to proceed.

## Approach

Three artifacts. The **skill** reviews and writes a verdict. The **hook** reads the verdict and
blocks. The **verdict file** is the seam between them.

### Why the hook cannot do the review

Claude Code hooks are shell commands. They cannot call a model, so a hook can never *perform* a
skill-based review. It can only check whether a fresh one exists and what it concluded. That
constraint sets the whole design: the skill produces `.pr-self-review/latest.json`, and the hook
is a freshness-and-verdict check over that file.

Freshness is the load-bearing half. Without it, one passing review licenses every later push.

```jsonc
// .pr-self-review/latest.json  (git-ignored)
{
  "mode": "gates" | "full",      // which tracks actually ran
  "verdict": "pass" | "blocked" | "incomplete",
  "baseSha": "a1b2c3d",          // merge-base with main
  "headSha": "6f7ebb4",
  "worktreeHash": "…",           // hash of staged + unstaged + untracked content
  "generatedAt": "2026-08-01T21:14:00Z",
  "counts": { "critical": 2, "major": 5, "minor": 3 },
  "findings": [ /* file, line, severity, source, message, fix, verifier */ ],
  "skipped":  [ /* path, reason */ ],
  "coverage": { "agents": [ { "name": "frontend", "status": "ok", "files": 11 } ] }
}
```

The hook (`scripts/pr-self-review-gate.sh`, wired as `PreToolUse` on `Bash` in a new
`.claude/settings.json`) reads `tool_input.command` from stdin and exits `2` — which blocks the
call and hands its stderr back to the model — under two different rules:

| Command | Requires | Blocks when |
|---|---|---|
| `git push` | a fresh run of **either** mode | file missing, stale, or any Track A gate failed |
| `gh pr create`, `gh pr ready` | a fresh run with `mode: "full"` | file missing, stale, `mode` is `gates`, or the verdict is not `pass` |

Stale means `headSha` or `worktreeHash` no longer matches the working tree. One `mode: "full"`
run therefore satisfies both rules; a cheap `gates` run satisfies only the push.

### Track A — deterministic gates

Run first, no model involved, only for packages present in the diff. A failure here is
**critical by definition**; nothing interprets it.

| Gate | Command | Passes when |
|---|---|---|
| Architecture | `cd server && pnpm arch` | exits 0 **and** the known-violations baseline did not grow |
| Types | `pnpm typecheck` in `server/`, `client/`, `reviewer-core/` | exits 0 |
| Lint | `cd client && pnpm lint` | exits 0 (`client/` is the only package with ESLint) |
| Unit tests | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`; `cd client && pnpm test`; `cd reviewer-core && npm test` | exit 0 |
| Vendor mirror | `diff -r server/src/vendor/shared client/src/vendor/shared` | no output |
| Registry | lock ↔ directories, frontmatter `name` == directory, `SKILL.md` < 500 lines | no mismatch |

Integration tests (`*.it.test.ts`) are **not** in Track A. They need testcontainers and cost
minutes; CI owns them.

### Track B — skill review by parallel subagents

One subagent per domain, each seeing only its own files, each returning JSON findings rather
than prose. Every subagent reads the relevant `<module>/INSIGHTS.md` first — that file records
failures that already cost someone time in this repo, which no general-purpose skill knows.

| Diff matches | Subagent | Opens |
|---|---|---|
| `client/src/**/*.{ts,tsx}` | frontend | `frontend-architecture`, `react-best-practices`, `next-best-practices` (only when `app/`, `layout`, `page` or `'use client'` is touched) |
| `client/**/*.test.{ts,tsx}` | frontend-tests | `react-testing-library` |
| `server/src/{modules,adapters,platform}/**` | backend | `onion-architecture`, `fastify-best-practices` (only when a `routes.ts` or plugin is touched) |
| `server/src/db/**`, `**/schema.ts`, `server/drizzle/**` | data | `drizzle-orm-patterns`, `postgresql-table-design` (only for a new migration or schema change) |
| `**/vendor/shared/**`, `**/*.schema.ts`, Zod contracts | contracts | `zod`, `typescript-expert` |
| `reviewer-core/src/**` | core | `onion-architecture` (Core-ring rules only) |
| the whole diff | security | `security` — cross-cutting, the one agent that is not partitioned |

`mermaid-diagram` and `engineering-insights` take no part in review. The first is generative;
the second runs *after*, when a finding turns out to be worth recording. The one exception:
`docs/architecture.md` in the diff raises a note asking whether its diagram still holds.

For the ten skills with no `Review checklist`, `routing.md` carries three to six "what to look
for" lines per skill, each pointing at a section of that skill. **It does not copy the rules.** A
third copy of a rule is a third thing to drift; spec 01 and the twice-vendored `shared/` are the
standing reminder of what that costs.

### Severity, and what blocks

**critical — blocks per the hook table above**, so a Track A critical stops `git push` as well,
while a Track B one stops only `gh pr create`: any Track A gate failed; a dependency-rule violation
(Drizzle outside `repository.ts`, `container.db` in a route, `adapters/` importing `modules/`);
a secret in `AppConfig`, `process.env`, or a committed file; an OWASP finding (injection,
authorization bypass, path traversal, SSRF); one-sided drift between the two `vendor/shared`
copies; a Fastify module added without registration in `modules/index.ts`; a test deleted or
`skip`ped to make a gate green; a change to a `skills-lock.json`-pinned skill; a `CLAUDE.md` that
stopped being a symlink.

**major — fix before the PR, does not block:** checklist violations that no gate enforces, new
behaviour with no test, anything named `use*` that calls no hook, shareable state held in
`useState`, a new route absent from the API map in `server/README.md`.

**minor / note:** everything else.

### Guarding against false criticals

Model findings are noisy, and here they stop work. So the two sources are treated differently: a
Track A failure blocks immediately, while a **critical from a subagent must survive a second,
adversarial verifier** ("try to refute this; if uncertain, treat it as refuted"). Unconfirmed,
it drops to major and does not block.

### Baseline

`.pr-self-review/baseline.json` freezes findings that already exist in files the branch did not
change, exactly as `.dependency-cruiser-known-violations.json` does for the architecture gate.
Without it the first run against `pulls/routes.ts` — 420 lines, 16 direct `container.db` calls
per spec 02 — emits sixteen criticals and the hook is deleted the same day.

Findings are anchored to **diff lines, not files**. A violation on line 300 of a file whose line
40 you edited is baseline, not yours.

### What is never reviewed

**Tier 1 — not read at all**, and always listed in the report's skipped section:
`**/node_modules/**`, `**/dist/**`, `**/.next/**`, `**/coverage/**`, `pnpm-lock.yaml`,
`package-lock.json`, `.screenshots/**`, `server/clones/**`, `server/drizzle/meta/**`, `*.snap`,
binaries (`png|jpe?g|svg|webp|ico|pdf|woff2?`). A file over 200 KB or 1500 lines contributes its
diff hunks only, never its full text.

**Tier 2 — the fact of the change is the finding**, the contents are not reviewed:

| Path | A change here means |
|---|---|
| `server/src/vendor/**`, `client/src/vendor/**` | acceptable only if both copies match; one-sided is **critical** |
| `e2e/specs/*.flow.json` | major — live browser scenarios, confirm it was deliberate |
| `.claude/skills/<locked>/**` | **critical** — pinned upstream copy |
| `CLAUDE.md` anywhere | **critical** if it is no longer a symlink |
| `server/clones/**`, `.env`, `*.key`, `*.pem` | **critical** — git-ignored runtime data, or a secret |

**Tier 3 — read, but no skill applies.** A short checklist only, no subagent:
`.github/workflows/**`, `scripts/**`, `docker-compose.yml`, `*.env.example`, `docs/**`,
`specs/**`, `*.md`, `AGENTS.md`, `INSIGHTS.md`.

### The report

`.pr-self-review/report.md` is written and printed; `latest.json` carries the same data for the
hook. The verdict, the counts and the scope fit on the first screen; detail follows, ordered by
severity and then by path.

```
PR Self-Review — BLOCKED        2 critical · 5 major · 3 minor
base main@a1b2c3d → HEAD 6f7ebb4 + 4 uncommitted
18 files (client 11 · server 5 · docs 2) · 3 skipped · 42s · mode full

GATES
  ok    server  arch         baseline 20 -> 20
  ok    server  typecheck
  ok    server  test         88 passed
  FAIL  client  lint         2 errors                     -> CRITICAL 1
  ok    client  typecheck
  ok    client  test         141 passed
  ok    shared  vendor diff  clean
  ok    repo    registry     lock and directories agree
  --    core    typecheck    not run (no changes in reviewer-core)

CRITICAL — blocks the PR
  1  client/src/.../FindingCard.tsx:42            [gate eslint]
     react-hooks/exhaustive-deps: `repoId` missing from the dependency array
     Fix: add `repoId` to the dependency array

  2  server/src/modules/pulls/routes.ts:118       [onion-architecture 3.1]
     `container.db` in a route — added by this diff, not baseline
     Verifier: confirmed 2/2
     Fix: move the query into pulls/repository.ts

MAJOR — fix before the PR, does not block
  3  client/.../FindingsPanel.tsx:57  [frontend-architecture 5]
     filter state in useState although it is shareable — belongs in the URL
  ... 4 more

MINOR / NOTES — 3, listed in .pr-self-review/report.md

SKIPPED
  client/pnpm-lock.yaml (lockfile) · .screenshots/panel.png (binary)
  server/src/vendor/shared/contracts.ts (vendor — mirror checked, contents not reviewed)

Next: fix 2 criticals, then /pr-self-review (re-reviews only what changed).
This skill checks conventions, not correctness. For logic bugs run /code-review.
```

Five rules make it trustworthy:

1. **No finding without `file:line` and a source** — `[onion-architecture §3.1]` or
   `[gate eslint]`. A finding that cannot be checked is not a finding.
2. **Every critical carries one concrete `Fix:` line.** Not "consider reviewing".
3. **Skipped files are always printed.** A green report with no skipped list is lying.
4. **A failed subagent is visible** — `FE agent failed, 11 files unreviewed` — and forces the
   `incomplete` verdict, which blocks. Otherwise the cheapest way past the gate is to break a
   subagent.
5. **The report states what it does not do**: this skill checks conventions, not correctness.
   Logic bugs are `/code-review`'s job.

### Modes and cost control

`/pr-self-review` runs everything. `gates` runs Track A alone in seconds. `fe`, `be`, `sec` run
one domain. Findings are cached by file-content hash, so the run after a fix re-reviews only
what changed.

### What gets built

```
.claude/skills/pr-self-review/
  SKILL.md      trigger, procedure, severity model, block rule, routing table
  gates.md      Track A commands per package, and how to read each failure
  routing.md    globs to skills, and what to look for in the ten without a checklist
  severity.md   the four levels, with examples taken from this repo
  README.md     skill card: scope, sibling boundaries, sources, version, baseline evidence
scripts/pr-self-review-gate.sh      the hook: reads the verdict, never reviews
.claude/settings.json               new file — PreToolUse hook on Bash
.claude/commands/pr-self-review.md  the slash command
```

Plus a catalog row in `.claude/skills/README.md`, `.pr-self-review/` in `.gitignore`, and **no
entry in `skills-lock.json`** — this skill is ours.

## Decisions and their alternatives

**A Claude Code hook, not a git `pre-push` hook.** A git hook fires for every terminal, which is
strictly better coverage, but it can only run Track A — a shell hook cannot invoke a model, so
the skill review would silently never run for anyone outside Claude Code. Coverage that omits the
half the spec exists for is worse than honest partial coverage. A git hook remains available
later for Track A alone.

**`git push` runs Track A only; `gh pr create` runs everything.** The request was "before every
GitHub call", but pushing a WIP branch is ordinary and happens dozens of times a day. Charging a
full multi-agent review for each one guarantees the hook is removed. The gates are seconds and
still catch the majority of criticals; the full review is mandatory at the moment a PR is
actually opened.

**The escape hatch stays.** `PR_SELF_REVIEW_SKIP=1 git push` bypasses the hook and the bypass is
recorded in the report. A gate with no override is removed the first time it is wrong during an
urgent push, and then it protects nothing.

**Freeze a baseline instead of starting clean.** Same argument as spec 02, with a sharper edge:
there, a red gate blocked a branch; here it blocks every push in the repo.

**Parallel subagents, not an inline sweep.** Reviewing five domains inline loads four or five
skills into one context at once and serialises the work. Partitioned subagents keep the main
context clean and each agent's attention on its own files. The cost is tokens, which the
content-hash cache and the mode flags are there to bound.

**This skill copies no rules.** It routes and enforces; the domain rules stay in their skills.
Restating them here creates a third copy that drifts — which is the failure mode the `shared-sync`
gate exists to catch elsewhere in this repo.

**No review on `Edit`/`Write`.** A `PostToolUse` hook reviewing each write is tempting and would
catch problems earlier. It also runs a review dozens of times per feature, most of them against
code that is half-written. Rejected deliberately, recorded here so it is not revisited.

**`incomplete` blocks.** Treating a crashed subagent as a pass makes breaking a subagent the
cheapest way through the gate.

**It does not hunt for bugs.** `/code-review` and `/security-review` already do, and they are
better at it. This skill checks conventions, gates, and secrets, and it blocks — three things
those commands do not do. The report points at them rather than competing.

**It supersedes `superpowers:requesting-code-review` in this repo.** Same intent, but that skill
knows nothing about `pnpm arch`, the vendored `shared/`, or `skills-lock.json`. `SKILL.md` states
the boundary so an agent does not run both.

## Known weakness

**Half the verdict is non-deterministic.** Two runs over the same diff will not produce the same
Track B findings. The adversarial verifier reduces false criticals but cannot remove them, and it
cannot address false *negatives* at all — a missed critical is invisible by construction. Track A
is the only part with a reproducible answer, which is the argument for keeping it first and
letting it block on its own.

**The baseline can hide a real problem.** A pre-existing critical in an untouched file never
blocks. That is the deliberate trade for the skill surviving its first week, and the mitigation
is the same as spec 02's: the file only shrinks, and it is readable.

**The freshness check breaks on rebase.** `headSha` changes when a branch is rebased or amended
even though the content did not, forcing a re-review. `worktreeHash` covers uncommitted changes
but not this case. Accepted rather than solved; a content-tree hash instead of a SHA is the
obvious later fix.

**The hook guards one tool, not the machine.** It sees `Bash` calls in this session. A push from
another terminal, an IDE button, or the GitHub web UI bypasses it entirely. This is a discipline
aid, not a security control — the enforceable copy of these rules is CI.

**The ten checklist-less skills get our summary, not theirs.** Six of them are pinned upstream in
`skills-lock.json` and cannot be edited to add a checklist, so `routing.md` holds a pointer that
can go stale against the skill it points at. Nothing detects that drift.

**Unmeasured until acceptance runs.** Every claim about what this catches is a prediction. The
RED/GREEN prong below exists because `.claude/skills/README.md` requires it and because spec 02
found its skill rescued nothing it had assumed it would.

## Acceptance

- `/pr-self-review` on a clean branch writes `latest.json` with `verdict: "pass"` and a report
  that lists the skipped files.
- With an injected `container.db` call in `modules/agents/routes.ts`, both tracks fire
  independently: `pnpm arch` grows the baseline, so `git push` is refused with exit 2 after a
  `gates` run alone; and the backend agent raises the same violation citing `onion-architecture`
  and `file:line`, confirmed by the adversarial verifier. `PR_SELF_REVIEW_SKIP=1 git push`
  proceeds and the report records the bypass.
- A `gates` run lets `git push` through but is refused for `gh pr create` on `mode`.
- A pass followed by one edit makes the verdict stale, and the hook blocks both commands until
  the review is re-run.
- A deliberately crashed subagent yields `incomplete`, blocks, and names the unreviewed files.
- The registry gate reports today's real drift: two `skills-lock.json` entries without
  directories, seven directories without entries, and the missing `.cursor/skills` symlink.
- Re-running against commit `1d5348d` (*refuse a finding link whose path would resolve out of the
  repo*) with the fix reverted raises a path-traversal critical from the `security` agent. This is
  the RED prong: a real defect this repo actually shipped a fix for.
- The same run without the skill installed is recorded in `README.md` as the GREEN comparison,
  with token and tool-call counts, per `.claude/skills/README.md`.
- Track A alone completes in under 90 seconds on a diff touching both packages.
- `SKILL.md` under 500 lines, file references one level deep, frontmatter `name` matching the
  directory, no top-level `version`.
- No Cyrillic in any committed file.
