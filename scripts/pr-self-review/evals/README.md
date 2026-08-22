# pr-self-review eval tooling

Runs and grades the fixtures in `.claude/skills/pr-self-review/eval-fixtures/fixtures/`. The fixtures
(the patches and their answer keys) live inside the skill folder, not here — this folder is only
the repo-specific plumbing: git branches, `jq` grading. Splitting it this way means packaging or
copying `.claude/skills/pr-self-review/` alone carries every test case with it; none of this
tooling needs to travel along.

## The loop, today

```sh
bash scripts/pr-self-review/evals/apply-fixture.sh security-route
# now in Claude Code, on branch eval/pr-self-review/security-route:
#   /pr-self-review --full
bash scripts/pr-self-review/evals/grade.sh security-route
```

`apply-fixture.sh` only does git plumbing — checkout `main`, reset the `eval/pr-self-review/*`
branch, `git apply`, commit. `grade.sh` only reads JSON — `.pr-self-review/latest.json` against
`expected.json`. Neither one calls a model. The step in between, the actual review, still needs a
real Claude Code session, which is why this is a loop you drive by hand right now, not a single
command.

## Why this isn't a CI job yet

`TESTING.md` keeps everything that makes a live model call out of automated CI on purpose —
`run_agent_on_pr` is "exercised by hand... makes live provider calls that cost real money," and
the existing `pr-self-review.yml` workflow tests only the six deterministic scripts precisely
because that half needs no model and no secret. A full `/pr-self-review --full` run against one
fixture costs on the order of 100–150k tokens and 10–12 minutes (measured 2026-08-21, three
fixtures, see the root `INSIGHTS.md` Session Notes entry for that date) — running that on every
push would be a different kind of gate than any other workflow in this repo.

If this becomes a scheduled or `workflow_dispatch` job later, it needs: the `claude` CLI (or
`claude -p`) available in the runner, an Anthropic API key as a repository secret — neither exists
in this repo's CI today — and a decision on cadence (weekly is the obvious default, not per-PR).
`grade.sh`'s exit code is already 0/1, so the grading half is ready; only the "run the skill
headlessly" half is missing.

## Adding a fixture

See `.claude/skills/pr-self-review/eval-fixtures/README.md` — that's where the format and the authoring
checklist live, next to the fixtures themselves.
