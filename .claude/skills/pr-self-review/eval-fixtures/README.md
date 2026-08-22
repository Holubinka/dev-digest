# pr-self-review — eval fixtures

Test cases for the *model* half of this skill (Track B: `security` and `conventions`) — does a
real run of `/pr-self-review --full` actually catch a planted bug? This is a different question
from `scripts/pr-self-review/test/`, which tests the *deterministic* half (`scope.sh`, `gates.sh`,
`baseline.sh`, `report.sh`) with the model half stubbed out on purpose — see `seam.test.sh`'s own
comment: *"Only the model half — findings.json and agents.json — is fixture here."* These fixtures
are for the half that suite deliberately does not exercise.

They live inside the skill folder, not in `scripts/`, so that packaging or copying this skill
elsewhere carries its own test cases with it. The tooling that *runs* them — git plumbing, JSON
grading — is repo-specific and lives one level up, in `scripts/pr-self-review/evals/`.

## What's here

```
evals.json               the same 3 fixtures in skill-creator's own schema (prompt + expectations)
                         — references/schemas.md's evals.json, read by the skill-creator plugin
benchmark.json/.md        the scorecard — generated output of the real skill-creator plugin's
                         scripts/aggregate_benchmark.py, not hand-written. Read benchmark.md first
                         if you want the numbers, not the format. Regenerate it, don't hand-edit it
                         — see "Refreshing the scorecard" below.
fixtures/<name>/
  diff.patch             a real `git diff` against main — apply it and the fixture is a small PR
  expected.json          the answer key for grade.sh: which findings a passing run must contain
```

Each fixture is a small, realistic change with **exactly three planted issues** and **no comment
anywhere in the diff naming them** — the fixture has to read like an ordinary PR, or the eval
measures nothing. Chosen so none of the three trips the deterministic Track A gates (`pnpm arch` /
`typecheck` / `lint` all pass before the patch was committed), which forces Track B to actually run
instead of the branch getting blocked before either subagent is dispatched.

| Fixture | Targets | Trips Track A? |
|---|---|---|
| `security-route` | `security` agent — SQLi, IDOR, a secret written to the log | no |
| `onion-notify-service` | `conventions` agent — `onion-architecture` §3.3/§3.4/§3.7, none of them visible to `pnpm arch` | no |
| `frontend-label-filter` | `conventions` agent — `frontend-architecture`'s Review checklist | no |

## Two eval mechanisms, on purpose

The same 3 fixtures are described twice, for two different jobs:

- **`expected.json` + `grade.sh`** (this folder + `scripts/pr-self-review/evals/`) — deterministic,
  keyword-matching grading against `.pr-self-review/latest.json`. This is the one worth wiring to
  CI eventually: no LLM judge needed, since the skill's own output is already structured JSON.
- **`evals.json` + `benchmark.json`/`.md`** — the real Claude Skill Creator plugin's own format:
  `prompt` + natural-language `expectations`, graded by a grader agent following its
  `agents/grader.md` rubric, aggregated by its `scripts/aggregate_benchmark.py`, viewable through
  its `eval-viewer/generate_review.py`. This is the one that produces `benchmark.md`'s pass-rate /
  time / token comparison against a no-skill baseline.

Both point at the same `diff.patch` files and the same planted issues — they're not redundant, they
answer different questions ("does this specific run contain the finding" vs "how does the skill
compare to no skill at all, with evidence and a critique of the eval itself").

## `expected.json`

```json
{
  "expected_findings": [
    { "id": "sql-injection", "file": "server/src/modules/pulls/routes.ts",
      "min_severity": "critical", "keywords": ["sql.raw", "injection", "parameteriz"] }
  ]
}
```

`min_severity` is the floor `severity.md` actually prescribes for that class of finding — an
OWASP shape (`security-route`, `onion-notify-service`'s secret) is `critical`; a
`frontend-architecture` checklist item (`frontend-label-filter`) is `major`, since nothing in
that skill's checklist is an OWASP shape or a Track A gate. A run that grades one of these lower
than its floor is a real regression to raise, not something to loosen the fixture for.

`keywords` is deliberately loose — one case-insensitive substring match against a finding's
`message` is enough. Grading a model's prose exactly would make the fixture brittle for no
reason; the question is whether the *right defect* was found on the *right file*, not whether the
wording matches.

## Running a fixture

The grading script only needs `.pr-self-review/latest.json` from a real run, which means a real
Claude Code session still has to run `/pr-self-review --full` in between — this is not yet a
push-button CI job, and `scripts/pr-self-review/evals/README.md` says why. From the repo root:

```sh
bash scripts/pr-self-review/evals/apply-fixture.sh security-route   # checks out eval/pr-self-review/security-route
# then, inside Claude Code, on that branch: /pr-self-review --full
bash scripts/pr-self-review/evals/grade.sh security-route           # checks .pr-self-review/latest.json against expected.json
```

`grade.sh` also takes the report path as an optional second argument (default
`.pr-self-review/latest.json`), for regrading any saved report without a live run — as long as it's
the same JSON shape as `latest.json` (a `.findings[]` array of `{severity, source, file, line,
message, fix}`). Note that's a different shape from `scripts/pr-self-review/evals/skill-creator-run/`'s
own `grading.json` (expectations/passed/evidence) and `outputs/report.md` (plain markdown) — neither
of those is `grade.sh`-readable as-is.

## Refreshing the scorecard

`benchmark.json`/`.md` are generated files — regenerate them, don't hand-edit them. The real run
data (`eval_metadata.json`, `grading.json`, `timing.json`, `outputs/`) lives in
`scripts/pr-self-review/evals/skill-creator-run/`; see that folder's own README for how a run gets
there. Once it does:

```sh
cd <skill-creator-plugin-dir>   # wherever the plugin is installed
python3 -m scripts.aggregate_benchmark \
  <repo>/scripts/pr-self-review/evals/skill-creator-run/iteration-1 \
  --skill-name pr-self-review --skill-path .claude/skills/pr-self-review
cp <repo>/scripts/pr-self-review/evals/skill-creator-run/iteration-1/benchmark.{json,md} \
   <repo>/.claude/skills/pr-self-review/eval-fixtures/
```

One real gotcha, hit building this: the plugin's own `aggregate_benchmark.py` and
`eval-viewer/generate_review.py` use `dict | None`-style type hints (PEP 604, Python 3.10+) — on
macOS the system `python3` is often 3.9 and fails with a `TypeError` at import time. Use a newer
interpreter (e.g. `/opt/homebrew/bin/python3` on a Homebrew install).

## Adding a fixture

1. Branch off `main`, make a small, realistic change with 2–4 planted issues and zero giveaway
   comments — read like a real PR, not a quiz.
2. Confirm it does not trip a Track A gate on its own (`pnpm arch` / `typecheck` / `lint` in the
   touched package) — a red gate stops Track B before either subagent runs, and the fixture stops
   testing anything.
3. `git diff main..<branch> > diff.patch`, write `expected.json` next to it, add both under a new
   `fixtures/<name>/`.
4. Delete the branch — the patch is the fixture now, the branch was scaffolding.
5. Run it for real (`apply-fixture.sh` → `/pr-self-review --full` → `grade.sh`) to prove
   `expected.json` against a live run — an answer key nobody has ever run for real is a guess.
6. Add a matching entry to `evals.json`, then extend the workspace under
   `scripts/pr-self-review/evals/skill-creator-run/` with the new eval's `eval_metadata.json`,
   `grading.json` and `timing.json` for both conditions, and refresh `benchmark.json`/`.md` per
   "Refreshing the scorecard" above.
