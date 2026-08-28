# evals/baselines/

Committed snapshots of `pnpm eval:repeat --label <name>` runs, used as the "before" side of a
CI comparison. Unlike `evals/results/` (gitignored, append-only, safe to delete), this folder is
tracked — a baseline is only useful if it survives past the run that produced it.

## Why this exists

`evals/results/repeat-<label>.json` is the local output of `eval:repeat --label <label>` — but
`results/` is gitignored, so nothing there persists into CI or a fresh clone. A CI job comparing
"this PR's run" against "the accepted baseline" needs that baseline to be a real, reviewable file
in the repo, not something regenerated fresh on every run (which would compare a PR against
itself).

## Convention

One file per pattern, named after the pattern it covers:

- `skills.json` — baseline for `pnpm eval:repeat skills -n 2`
- `agents.json` — baseline for `pnpm eval:repeat agents -n 2`
- `workflow.json` — baseline for `pnpm eval:repeat workflow -n 2`

`.github/workflows/evals-tier.yml` copies `baselines/<tier>.json` to
`results/repeat-baseline-<tier>.json` before running, then diffs the PR's own run
(`repeat-candidate-<tier>.json`) against it with `pnpm eval:delta baseline-<tier> candidate-<tier>`.
The tier name comes from the caller (`evals-skills.yml`, `evals-agents.yml`, `evals-workflow.yml`),
so the three files above are exactly the three baselines CI can restore.
A pattern with no committed baseline here just gets its raw results published — no diff, and no
CI failure either (this tier never blocks a merge; see root `AGENTS.md` § *Evals gate what
changes*).

## Updating one

A maintainer's deliberate act, not automatic — the same reasoning as `docs/agent-prompts/` and
`docs/skills/` being hand-edited sources of truth, not generated:

```sh
cd evals
pnpm eval:repeat skills -n 2 --label skills   # writes results/repeat-skills.json
cp results/repeat-skills.json baselines/skills.json
git add baselines/skills.json
```

Recalibrate whenever the harness or a grader changes (`evals/src/**`) — an old baseline measured
against a different scorer isn't comparable, and the CI job flags this in its summary when it
detects that path changed without a matching baseline update.

## Currently empty

No baseline is committed yet. First one to add: run the command above for whichever pattern you
want covered and commit the result — a human decision about what "acceptable" looks like, not
something to seed with an arbitrary local run.
