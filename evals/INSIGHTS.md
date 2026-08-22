# Insights — evals/

Failures and surprises specific to the eval harness. Repo-wide ones live in the root
`INSIGHTS.md`. Seven fixed sections, append-only —
`../.claude/skills/engineering-insights/SKILL.md` holds the rules.

---

## What Works

### An explicit "use the tool, don't do it yourself" command fixes dispatch and activation misses

A `dispatch`/`activation` case prompt that only implies the desired action (e.g. "this repo
starts a feature with a spec") lets the model satisfy the intent by hand instead — exploring code,
drafting the answer inline, or asking clarifying questions — rather than invoking the
subagent/skill. An explicit, unambiguous instruction fixes it reliably: "ОБОВ'ЯЗКОВО запусти
сабагента X — не роби Y сам." Confirmed 2026-08-22: `claude-md-routing.cases.ts`'s `spec-creator`
dispatch case went from a hard maxTurns-miss (9 turns exploring `grounding.ts` / `run.ts` /
`run-executor.ts`, never dispatching) to a 4-turn pass after adding the command;
`review-workflow.cases.ts`'s `engineering-insights` activation case went from 1/3 real activations
to 2/2 after the same treatment.

## What Doesn't Work

### Running two `eval:repeat` invocations concurrently corrupts both pass-rate reports

**Symptom.** Two `pnpm eval:repeat` processes launched in parallel (different patterns) each print
a summary containing rows from the OTHER process's cases, and the "N/M cases" progress line during
a run can show a count higher than the pattern's own case count (e.g. "12/16 cases" for a 6-case
pattern).

**Cause.** `src/repeat.ts`'s `main()` tracks "fresh" records by counting lines appended to the
shared `results/records.jsonl` since its own start (`recordCount()` / `loadRecords(line)`). Two
processes writing to the same file interleave their appends, so each process's "since I last
checked" window picks up the other's records too. `aggregate()` still buckets by `nodeid`, so each
test's OWN numbers stay internally correct — the contamination is extra unrelated rows in the
printed table, not corrupted numbers for your own tests.

**Fix.** Never run two `eval:repeat` (or anything else calling `loadRecords`/`recordCount`)
at the same time — run them sequentially. If you already ran them concurrently, your own tests'
per-nodeid numbers are still trustworthy; just ignore rows for tests you didn't ask for.

## Codebase Patterns

### `.claude/agents/architecture-reviewer-lite.md` is a real, dispatchable agent — the eval-only control side of an A/B

`evals/agents/architecture-reviewer-lite/architecture-reviewer-lite.eval.ts` deliberately reuses
`architecture-reviewer`'s cases against a different agent file — that only works if the second
agent file actually exists on disk (`agentContent()` throws `agent not found` otherwise; see
Recurring Errors & Fixes below). It's `architecture-reviewer.md` with Rule 2 ("a finding names the
rule it violates") removed and the findings-table "правило" column dropped — the ONE axis this A/B
measures, everything else byte-identical. Compare it: `pnpm eval:repeat agents/architecture-reviewer
-n 2 --label X`, same for `-lite`, then `pnpm eval:delta X X-lite`. Measured 2026-08-22 (n=2, so
indicative only): removing Rule 2 gained 3 practices (+50pp each, all about not fabricating
findings on out-of-scope diffs) and lost 3 (one flat -100pp — the domain-file-importing-`fastify`
finding stopped landing at all, not just its citation).

### `record()`'s `outcome` needs an explicit boolean for every workflow-tier case kind

`src/dsl/case.ts`'s `runWorkflowCases` derives `outcome` directly from the same boolean(s) the
case's `expect()` call checks (`result.subagents.includes(...)`, `activated(...) ===
shouldActivate`, etc.) and passes it to `record(name, { result, outcome })`. `record()`
(`src/records/record.ts:29`) uses that value when present; only quality-tier cases (which don't
pass it) fall through to the grounding/judge/`!result.isError` heuristics. Adding a new
`WorkflowCase` kind: compute its own explicit `outcome` the same way — never let it fall through
to the `!result.isError` default (see Recurring Errors & Fixes below for what that conflation
cost).

### `activation`-kind cases have no `stopWhen` and need real maxTurns headroom

Unlike `dispatch`/`trace`, an `activation` case (`src/dsl/case.ts`) runs the full session to
natural completion or `maxTurns` — there's no early-stop once the Skill call (or its absence) is
decided, because a negative case can only be proven by letting the whole turn budget play out. In
practice the model needs one extra turn to wrap up its answer after acting. `maxTurns: 4`
routinely produced a 5-turn session; `maxTurns: 6` is what `workflow/review-workflow.cases.ts`
uses now.

## Recurring Errors & Fixes

### `eval:repeat`/`eval:delta` reported a wrong pass rate for workflow cases, with no crash

**Symptom.** `pnpm eval:repeat workflow/review-workflow -n 2` reported `0/2` for an `activation`
case whose trace (`skillsInvoked`, `filesRead`) proved the real `expect()` assertion had passed in
both runs — and, in the same run set, `True` for a run whose trace proved it should have failed.
`pnpm eval:workflow` (a single plain run) reported the correct `✓`/`✗` throughout; only the
persisted-record-based tools (`eval:repeat`, `eval:delta`, anything reading `results/records.jsonl`'s
`outcome` field) were wrong.

**Cause.** Before 2026-08-22, `record()` had no way to know the real `expect()` result for a
workflow case — it fell back to `!result.isError`, i.e. "did the Claude Agent SDK session end with
subtype `success`." That is not the same fact: a session that ends in one empty turn because the
model asked a clarifying question instead of acting is "clean" (`isError=false`) yet fails the
real check; a session that satisfies the check early but needs one more turn to summarize and
overruns `maxTurns` is "unclean" (`isError=true`, subtype `error_max_turns`) yet the real check
already held.

**Fix.** `record()` now accepts an explicit `outcome?: boolean` that wins over the fallback when
present; `runWorkflowCases` computes it for every kind (`dispatch`/`activation`/`trace`/`contrast`)
from the exact same boolean(s) its `expect()` checks, before calling `expect()`. Confirmed
2026-08-22: re-running the `engineering-insights` activation pair after the fix produced `outcome`
values matching the trace exactly (`skills:['engineering-insights']` → `True`; `skills:[]` on the
`shouldActivate:false` case → `True`) in all 4 runs.

### Three `review-workflow.cases.ts` `trace` cases asserted `expectFilesRead` paths that no longer exist

**Symptom.** No error, no crash — the cases would just always fail their `expectFilesRead` check
regardless of what the model actually read, indistinguishable from a genuine CLAUDE.md-routing
miss.

**Cause.** `server/docs/api-contracts.md`, `reviewer-core/docs/pipeline.md`, and
`reviewer-core/insights/gotchas.md` don't exist in this repo — the real files are
`server/README.md`, `reviewer-core/README.md`, and `reviewer-core/INSIGHTS.md`. The cases were
written against an earlier or illustrative doc layout and never re-verified against the actual
repo tree once the docs moved.

**Fix.** Before trusting a red `trace`/`contrast` case as "the model didn't follow the routing
rule," confirm the expected path actually exists (`ls <path>`) — a stale path fails identically to
a real miss and gives no other signal. Fixed 2026-08-22; see `workflow/review-workflow.cases.ts`.

### `eval:delta` always printed `—%` for an agent-variant A/B comparison

**Symptom.** `pnpm eval:delta architecture-reviewer architecture-reviewer-lite` printed every row
as `N% -> —%` — every single practice showing the B side as missing, with no error, on a run that
had actually completed and saved records.

**Cause.** `src/delta.ts` keyed both sides by the FULL `nodeid` (`${testPath} > ${testName}`,
`src/records/record.ts:45`). An agent-variant A/B is, by design, two DIFFERENT `.eval.ts` files
with the SAME case names (`architecture-reviewer-lite.eval.ts` deliberately reuses
`architecture-reviewer.cases.ts` — see Codebase Patterns above) — so `testPath` never matches
across labels even though the test name is identical on purpose. `eval:delta` was only ever
exercised on same-file before/after comparisons until this session, where `testPath` is always
identical, so the bug had no prior symptom.

**Fix.** `src/delta.ts` now keys by test NAME (`shortId()`), not full nodeid, with a collision
guard that warns (rather than silently drops data) if one label's own run has two different
nodeids sharing a short name. Verified 2026-08-22: re-running the same comparison after the fix
produced real percentages and a visible spread (see Codebase Patterns above), not `—%`.

### `agentContent()` threw "agent not found" for `architecture-reviewer-lite` — the file didn't exist

**Symptom.** `pnpm eval:repeat agents/architecture-reviewer-lite -n 2` finished in ~400ms per run
and reported "no records — run crashed" for both, no model call visible in the trace.

**Cause.** `evals/agents/architecture-reviewer-lite/architecture-reviewer-lite.eval.ts` was
scaffolded (references agent name `"architecture-reviewer-lite"`) but
`.claude/agents/architecture-reviewer-lite.md` itself had never been created — `agentContent()`
(`src/artifacts/load.ts:48`) throws synchronously before any SDK call, which is why the crash was
~400ms instead of a real session's tens of seconds. The eval side of an A/B was built; the second
agent variant it needs was not.

**Fix.** Created `.claude/agents/architecture-reviewer-lite.md` per the eval file's own doc
comment (Rule 2 removed, otherwise identical). Before trusting a same-shape "crashed in <1s, no
records" result as a flaky model call, check whether the crash duration is even plausible for a
real session — see `results/outputs/<run>/<slug>.md` (won't exist) or just re-run with
`--reporter=verbose` instead of the quiet `eval:repeat` wrapper to see the real stack trace.

## Session Notes

### 2026-08-22

Built out `evals/workflow/`'s CLAUDE.md-routing coverage: fixed the 3 stale-path `trace` cases in
`review-workflow.cases.ts` above, added `claude-md-routing.cases.ts` (5 new consolidated `trace`
cases covering `client/AGENTS.md`, `e2e/AGENTS.md`, `docs/architecture.md` + `spec-creator`
dispatch, `docs/agent-prompts/README.md`, `docs/skills/README.md`), and fixed the
`record()`/`activation` stats bug above. `pnpm eval:workflow` (10 cases) and a follow-up
`eval:repeat -n 2` on the activation pair are both green as of this session.

Also: added the eval routing table + commands to root `AGENTS.md` (§ *Evals gate what changes*);
added `.github/workflows/evals.yml` (blocking `eval:quality` + advisory `model-run`) and
`evals/baselines/` (committed baseline convention, currently empty — no baseline accepted yet);
added an `eval:quality`-blocking check for missing negative-activation coverage
(`skill-quality.ts`'s `activationCoverage()`); wrote the full evals/README.md § *Anti-patterns*;
fixed `eval:delta`'s cross-file matching bug and created the missing
`architecture-reviewer-lite.md` agent (both above) to actually close the "two agent versions
compared with visible spread" gap. Could not verify `evals.yml` live — this machine cannot push
`.github/workflows/**`; a human needs to push it and confirm the first real run.

## Open Questions

_Nothing recorded yet._
