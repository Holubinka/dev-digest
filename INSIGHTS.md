# Insights — repo-wide

Cross-package failures and surprises. Module-specific ones live in
`<module>/INSIGHTS.md`. Seven fixed sections; entries are appended under the one that fits.
`.claude/skills/engineering-insights/SKILL.md` holds the rules.

Add an entry when something cost you more than a few minutes to work out. **Append only** —
never rewrite or delete an entry mid-session; correct it with a dated note instead. Pruning
what has gone stale is a separate, deliberate pass.

---

## What Works

_Nothing recorded yet._

## What Doesn't Work

_Nothing recorded yet._

## Codebase Patterns

### The two `docker-compose.yml` files are byte-identical duplicates

**Symptom.** You edit the Postgres config and the change has no effect, because the
other compose file was the one that ran.

**Cause.** `docker-compose.yml` and `server/docker-compose.yml` are literal duplicates
(verified with `diff`). The duplication exists so `docker compose up` works from either
directory. Nothing enforces that they stay equal.

**Fix.** Change both, then confirm with `diff docker-compose.yml server/docker-compose.yml`.

### Finished features are deliberately removed so lessons can rebuild them — look for the removal commit first

**Symptom.** A course task asks for a feature that looks brand new, but half the plumbing
for it already exists and reads as if something was torn out around it.

**Cause.** The starter repo strips completed features on purpose. Per-run cost is the
worked example: commit `d45ab0d` ("feat(reviews): remove per-PR/run cost, keep model
pricing") dropped `agent_runs.cost_usd` (migration `0009`), the `cost_usd` field on
`RunStats`/`RunSummary`, and the client's COST stat + `formatCost` — while deliberately
keeping `reviewer-core`'s `ReviewOutcome.costUsd`, OpenRouter's `usage.cost` plumbing and
`server/src/adapters/llm/pricing.ts`. Designing from scratch means re-deriving a shape the
repo already agreed on, and risks missing a call site the removal touched.

**Fix.** Before planning, search the log for the teardown:
`git log --oneline --all | grep -iE 'remove|drop'`, or `git log -S<symbol> -- <path>` for a
symbol you expect to exist. `git show <sha> --stat` is then an exact file-by-file map of
what to put back. On 2026-07-28 this turned the Run Cost Badge design into a checklist.

### `.gitignore` references a package that does not exist

**Symptom.** You go looking for `agent-runner/` after seeing it in `.gitignore` and in
`reviewer-core`'s package description. There is no such directory.

**Cause.** The starter template was carved out of a larger repo; the ignore rules for
`agent-runner/dist/` survived the carving. It is a CI-side consumer that later course
lessons introduce.

**Fix.** Nothing to do — do not go hunting for the package. Treat the ignore rule as a
placeholder.

## Tool & Library Notes

### Mixed package managers across packages

**Symptom.** `pnpm install` in `reviewer-core/` or `e2e/` produces a lockfile the repo
does not track, or CI installs different versions than you have locally.

**Cause.** `client/` and `server/` ship `pnpm-lock.yaml`; `reviewer-core/` and `e2e/`
ship `package-lock.json`. The root README lists only pnpm as a prerequisite, so this is
easy to miss.

**Fix.** Use pnpm in `server/` and `client/`, npm in `reviewer-core/` and `e2e/`.

## Recurring Errors & Fixes

### The two vendored `shared/` copies drift silently

**Symptom.** A Zod contract or adapter interface behaves differently depending on which
package you read it from. Types that should match do not, and nothing fails until
runtime.

**Cause.** `@devdigest/shared` is vendored twice — `server/src/vendor/shared/` and
`client/src/vendor/shared/` — because it is not a workspace package. Type-checking cannot
detect the drift: each package compiles happily against its own copy, so nothing fails
until runtime.

This has happened once already. On 2026-07-27 five files differed: `LLMProvider.id` was
`'openai' | 'anthropic' | 'openrouter'` on the server but `'openai' | 'anthropic'` on the
client, and `AgentManifest`, `AgentVersion`, `CommitFile`/`CommitFilesPayload` plus the
`commitFiles`, `findOpenPr`, `sync` and `diffNameOnly` adapter methods existed only on
the server. Notably the drift was **not** purely one-directional — `contracts/trace.ts`
had better comment wording on the client, so a blind copy would have regressed it.

**Fix.** The copies were resynced the same day, and the `shared-sync` CI gate
(`.github/workflows/shared-sync.yml`) now compares them on every change to either copy,
catching content edits as well as added or deleted files. Locally, verify with
`diff -r server/src/vendor/shared client/src/vendor/shared`.

`server/src/vendor/shared/` is the source of truth (`reviewer-core` aliases it), but read
the diff before overwriting — the client copy is not always the stale one.

## Session Notes

### 2026-07-27

- Added the `engineering-insights` skill and restructured all five `INSIGHTS.md` into the
  seven fixed sections. Entries moved from `##` to `###`; none were reworded.
- Capture is model-invoked, so it is not guaranteed to fire. A `Stop` hook is lesson L06.

### 2026-07-28

- Built the Run Cost Badge feature: per-run USD cost on four surfaces (PR-list COST
  column, Agent-runs timeline, verdict plaque, run-trace Stats), plus
  `agent_runs.cost_usd` and migration `0010` with a frozen price-book backfill.
- The whole design came out of `git show d45ab0d`, the commit that had removed the
  feature — see Codebase Patterns above.
- Verified visually against the dev app by inserting a synthetic completed run, then
  deleting it. Live LLM verification was blocked by a malformed OpenRouter key (see
  `server/INSIGHTS.md`), but the failed run usefully exercised the `cost_usd = NULL` → "—"
  branch on every surface.

## Open Questions

_Nothing recorded yet._
