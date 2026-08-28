# Dependency Checker Skill

The skill card: what this skill is for, what it deliberately leaves to others, and how it
was tested.

## 1. Focus

This repo is five packages with no workspace (root `CLAUDE.md`), which means the two normal
questions a dependency tool answers — "what does this package need" and "what does this
package depend on" — don't have one answer here, they have five, plus a sixth question a
workspace tool would never need to ask: which of those five packages read *each other's*
source directly, and through what. This skill answers all three in one report: external
dependencies (size, type, version drift, unused-and-confirmed), the internal cross-package
graph (`tsconfig.json` path aliases, not `workspace:*` — this repo has none), and a
prioritized, human-readable recommendation list. See [SKILL.md](SKILL.md) for the procedure
and the exact report structure.

## 2. File map

| File | Answers |
|---|---|
| `SKILL.md` | When it runs, the five-step procedure, the exact report template |
| `severity.md` | The four tiers — P0/P1/P2/Info — each with this repo's own measured example |
| `graph.md` | Internal vs external, this repo's real graph, why the twice-vendored `shared/` isn't duplication |
| `README.md` | This file |

`scripts/dependency-checker/collect.sh` is the deterministic half: one JSON object with
every package's dependencies (declared range, installed version, on-disk size, import-usage
check) and repo-wide version drift. No model, no network, always exits 0 — the same shape as
`scripts/pr-self-review/*.sh`.

## 3. What it covers, and what it does not

| Question | Owner |
|---|---|
| What does package X depend on, and how much does each dependency weigh? | **this skill** |
| Which packages read each other's source, and through what? | **this skill** |
| Is a dependency declared but never used? | **this skill** — with a confirm-before-flagging step; see `SKILL.md` §2 |
| Does dependency X have a known CVE? | `security` skill §A03 — not duplicated here |
| Which ring does this new file belong in — `service.ts` or `repository.ts`? | `onion-architecture` |
| Is this query slow? | neither — nothing here profiles running code |

This skill **never edits anything**. `npm remove` / `pnpm remove`, editing a `package.json`,
regenerating a lockfile — all of that stays a human decision this skill's report feeds into,
never an action it takes. Same rule, same reason, as `pr-self-review`'s "do not fix anything
unless asked": a report that changes the tree it just analyzed is stale before anyone reads
it.

## 4. How this was tested

Built against `scripts/dependency-checker/collect.sh` run for real against this repo's
current state (2026-08-22), not against invented numbers. Three things the first real run
caught, kept as the worked examples in `severity.md` and `graph.md` rather than synthetic
ones:

- **A real confirmed-unused dependency**: `@fastify/autoload` in `server/package.json` —
  installed, zero imports under `server/src`, and root `CLAUDE.md` independently confirms the
  repo never autoloads Fastify modules. This is the one case in the repo today where the
  grep-negative signal and a documented reason agree.
- **Three real false positives the naive grep-for-import check produces**, each kept as a
  named caveat rather than silently "fixed" into an unrealistically clean heuristic:
  `dependency-cruiser` (invoked only via `pnpm exec depcruise`, never `import`ed as a
  module), `react-dom` (a Next.js peer dependency no app code imports directly), and
  `@vscode/ripgrep` (a dynamic `import()` wrapped in a `/* @vite-ignore */` comment the
  regex can't see through). The collect script's own comment and `SKILL.md` §2 both name
  these so a future run doesn't have to rediscover them by hand.
- **A real clean boundary check**: every `server/src` import of `reviewer-core` goes through
  the bare `@devdigest/reviewer-core` alias (nine files, grepped), none through the wildcard
  that would allow a deep import. Recorded as the `Info`-tier example in `severity.md`, with
  the `P0` shape it would take if that ever stopped being true.
- **Version drift measured, not assumed**: `zod` resolves to the same `3.25.76` in every
  package that declares it, today. The illustrative drift example in `severity.md` and this
  skill's own `evals/skills/dependency-checker/` eval cases (three different `zod` versions)
  is a synthetic fixture, not this repo's current state — the report template must still
  show that check ran clean, not silently omit it because it found nothing.

**Not yet run**: `evals/skills/dependency-checker/dependency-checker.eval.ts` — the Lesson 6
eval harness's own cases for this exact skill, imported into this repo separately (see
`evals/README.md`). They test the "quality" shape (SKILL.md content reasoning, no tool
access) this README's examples were written to satisfy, but running them for real is a
separate step from writing the skill.

## 5. Sources

- Root `CLAUDE.md` — the no-workspace fact, the per-package manager table, the twice-vendored
  `shared/` convention.
- `server/.dependency-cruiser.cjs` — the intra-package graph tool this skill deliberately
  does not duplicate (§3 above).
- `.claude/skills/pr-self-review/` — the severity-tier pattern (`severity.md`), the read-only
  convention, and the Bash-script style `collect.sh` follows.
- `evals/skills/dependency-checker/dependency-checker.cases.ts` — the report structure and
  severity vocabulary this skill's `SKILL.md` §3 template is built to satisfy.

## 6. Version and changelog

**1.0.0** (2026-08-22) — initial version.
