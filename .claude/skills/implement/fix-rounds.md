# Fix rounds — what to do with what the reviews returned

Stage 5 of [SKILL.md](SKILL.md). Two reviews have returned findings; this file says which of them
become work, who does that work, and when the loop stops.

## Where the brief goes, and why it must be there

```
.reviews/<branch>/round-<N>.md
```

**That directory is gitignored, and this is load-bearing rather than tidiness.**
`scripts/pr-self-review/scope.sh` feeds `worktreeHash` from
`git ls-files --others --exclude-standard`, which sees untracked files but not ignored ones. Write
a brief anywhere else in the tree and it changes that hash, so a `--gates` verdict recorded a
minute earlier stops matching, and `gate.sh` refuses the push while pointing at an edit nobody
made. `.gitignore` carries the same reasoning for `.pr-self-review/` — this is the second instance
of one failure mode, not a new rule.

## Triage before you fix — three filters, in this order

`NOT_MET` and `PARTIAL` rows from `plan-verifier` do not enter here at all. The plan asked for
them, so they are unfinished work: they go straight into the brief.

Everything a *review* returned passes these three:

### 1. `pre-existing` → not this branch's

`architecture-reviewer` tags every finding with that axis itself, deciding it from `git diff`
against the base rather than from intuition about which code looks newer. A `pre-existing` finding
goes into the final report as backlog and no further: fixing it widens a diff that is about to be
reviewed for what it *changed*, and it buries the findings that are about this work.

### 2. Below `major` → not this round

Collect `minor` and `note`; act on neither. A fix is new code, and new code is what a review is
for — so a round spent on cosmetics buys itself another round. `AGENTS.md` § *What a session
costs* records the measurement behind this: **refactor after the PR is open, not between rounds.**

`architecture-reviewer`'s own severity anchors make the cut easy to apply. `minor` there means
"broken in one place while the same slice already does it right somewhere else" — which is exactly
the class that batches well and blocks nothing.

### 3. Needs a decision, not an edit → not the implementer's

A finding that cannot be satisfied without changing a contract, moving a boundary, or widening
scope goes back to the human, or to `implementation-planner` for a new plan. It does not go in the
brief.

This is the implementer's own rule read from the other side: *a refactor you decided was necessary
is a finding, not a task*. Handing it one anyway produces either a refused dispatch or, worse, an
agent quietly exceeding a plan nobody re-approved.

The `architecture-reviewer` tie-break is the same question and can be borrowed directly: does the
fix need a **decision** or only an **edit**? One default parameter and no call-site changes is an
edit. Changing what two rings promise each other is a decision.

## Print the triage before dispatching anything

A short table — every finding, which filter it fell to, or that it survived:

| # | severity | axis | path:line | verdict |
|---|---|---|---|---|
| 1 | major | introduced | `server/src/modules/blast/service.ts:88` | **in the brief** |
| 2 | major | pre-existing | `server/src/modules/pulls/routes.ts:41` | filter 1 — backlog |
| 3 | minor | introduced | `client/src/app/…/Card.tsx:12` | filter 2 — after the PR |
| 4 | critical | introduced | `server/src/vendor/shared/contracts/blast.ts:9` | filter 3 — needs a decision |

That table is where scope quietly grows, and it costs almost nothing to read. Print it even when
every row survived.

## The brief

What survives all three filters — `introduced`, `critical` or `major`, fixable inside the plan's
boundary — becomes the file. One entry per finding:

- `path:line`;
- the rule it violates, named: a section of `onion-architecture` or `frontend-architecture`, a
  line in an `AGENTS.md`, a documented contract;
- what the reviewer said, quoted rather than summarised;
- the shape that would satisfy it — the shape, not a diff. `architecture-reviewer` returns one for
  every finding above `note`, so this is usually a copy.

The header names the plan the branch was executing. Then dispatch **one `implementer` against the
brief path, with `model: sonnet` on the `Agent` call**. That override beats the agent's `opus`
frontmatter for this one dispatch, and a brief built to the shape above is what makes it safe: the
address, the rule, the quote and the target shape are all decided already, so the round is an edit
rather than a design. Downgrade the *round*, never the agent file — a build implementer starting
from a plan is not this, and `SKILL.md` § 11 says why it stays on `opus`. Note the override in
your report; if a finding turns out to need a decision rather than an edit, it was filter 3's and
does not belong in the brief at all. It opens only that plan's `## Out of scope`, `## Constraints` and `## Gates` — the
steps are done, and re-reading them is what would make a fix round cost as much as the build did —
and it runs the touched modules' gates before reporting.

The brief is that agent's boundary exactly as a plan's steps are. A defect it notices in passing
and which the brief does not carry is reported, not fixed.

## Two rounds, and then stop

**Round 2 re-reviews only the files round 1 touched**, not the whole diff. Then the loop ends,
whatever round 2 returned. Anything still open is printed in the final report with its `path:line`
and handed to the human.

The cap is not caution. It is the measured shape of this repo's most expensive session, recorded
in `AGENTS.md` § *What a session costs*: eleven review rounds ran, the feature stopped producing
findings at round seven, and rounds 8-10 were reviewing the fixes to rounds 7-9 — **2.8M subagent
tokens, 42% of that session's total, for six minors.**

The failure mode is worth naming because it does not feel like one from the inside: each round
finds something, so each round looks justified. What it is actually finding is the previous
round's work.

## Red flags

| Red flag | Why it is wrong |
|---|---|
| "It's pre-existing but it's right there, I'll fix it too" | Filter 1 — the diff is about to be reviewed for what it changed |
| "Six minors is a lot, that's worth a round" | Filter 2 — that is the 42% |
| "The finding needs a contract change, I'll just brief it" | Filter 3 — the implementer stops, or exceeds an unapproved plan |
| "Round 2 found something new, so round 3" | § *Two rounds* — that is exactly rounds 8-10 |
| "Nothing survived triage, the review must have been shallow" | An empty round is the ordinary outcome |
| "I'll put the brief in `/tmp` next to the repo" | `/tmp` is fine; anywhere tracked in the tree is not — it moves `worktreeHash` |
| "Round 2 should re-review everything, to be safe" | It re-reviews what round 1 touched; the rest did not change |
