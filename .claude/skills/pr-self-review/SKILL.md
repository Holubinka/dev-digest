---
name: pr-self-review
description: "Reviews every open change on the branch against this repo's own skills and gates, and writes the verdict a push waits for. Use when running /pr-self-review, when a git push or gh pr create was refused by the PR Self-Review hook, before opening a PR, or when asked to check a branch against the repo conventions. Runs the deterministic gates first (arch, lint, typecheck, tests, vendor mirror, skills registry), then one subagent per domain over the routed files, verifies every critical adversarially, and records .pr-self-review/latest.json. It checks conventions, not correctness."
metadata:
  version: "1.1.0"
  tags: pr-review, self-review, pre-push, gates, subagents, verdict, conventions, blocking-hook
---

# PR Self-Review — the verdict a push waits for

Runs this repo's own knowledge over everything the branch changed, and records a verdict.

**This skill produces the verdict; it never enforces it.** `scripts/pr-self-review/gate.sh` is a
`PreToolUse` hook, and a Claude Code hook is a shell command that cannot call a model. So the hook
only reads `.pr-self-review/latest.json` and refuses `git push` / `gh pr create` when it is
missing, stale, or not a pass. You are the half that can read code. Do that half well and stop.

**Do not fix anything unless asked.** A run that ends with edits has changed the tree it just
reviewed, and the verdict it wrote is stale before anyone reads it.

## Navigation

| Read | For |
|---|---|
| **This file** | When it runs, the four modes, the seven-step procedure, the two rules that live only here |
| [modes.md](modes.md) | The procedures for `--freeze` and `--only critical` — the freeze snippet, and the carry-forward that a narrowed re-check must not lose |
| [routing.md](routing.md) | Which skills each domain subagent opens, what to look for in the ones with no checklist, and the skills deliberately left out |
| [gates.md](gates.md) | The ten Track A gates: the command, what a failure looks like, the first thing to try |
| [severity.md](severity.md) | The four levels with this repo's own examples, and what each one blocks |
| [README.md](README.md) | Scope, the boundary with `/code-review`, sources, version, how this was tested |

The scripts document themselves — each opens with a header comment stating its contract. Read
`scripts/pr-self-review/<name>.sh` before describing what it does.

---

## 1. When it runs, and when it must not

Run when: the user types `/pr-self-review`; the hook refused a push or a PR and named this
command; a PR is about to be opened; the user asks whether the branch is ready.

**Refuse on `main`.** Step 1 reads `.branch`. If it is `main`, stop and say to branch first —
there is no base to diff against and no PR to gate.

Do **not** run this for "why is this test failing", "find the bug in X", or "review this one
file I just wrote". Those are `/code-review` and `superpowers:systematic-debugging`. See §6.

## 2. The four modes

`.claude/commands/pr-self-review.md` promises four arguments. All four are implemented here.

| Argument | Runs | Writes `mode:` | Good for |
|---|---|---|---|
| none, or `--full` | Track A + Track B | `full` | the run `gh pr create` requires |
| `--gates` | Track A only, no subagents | `gates` | seconds; enough for `git push` |
| `--only critical` | Track A + Track B on last run's critical files | `gates` | the loop after fixing a critical |
| `--freeze` | Track A + Track B, then records instead of filtering | *nothing* | once, deliberately, on adoption |

Two of these need care, so their procedures are written out in [modes.md](modes.md) rather
than left implied.

## 3. The procedure

**0 — Set up the scratch directory.** Run this first, in every mode, before anything else:

```sh
mkdir -p .pr-self-review/run
printf '[]' > .pr-self-review/run/findings.json
printf '[]' > .pr-self-review/run/agents.json
```

Seeding those two empty is what lets a run that never dispatches a subagent still reach step 6.
Only step 3 writes them, but steps 5 and 6 both read them through `jq --slurpfile`, which exits 2
on a missing path — so without the seed, `--gates`, `--only critical` with nothing to re-check,
and any run cut short by a failing Track A gate all die at step 5 with an empty `final.json`, and
`report.sh` then writes no `latest.json` at all. That is the mode `gate.sh` names in its own
refusal message, so it is the path a blocked user is most likely to take.

**The scratch path is written out literally in every command, never held in a shell variable** —
shell state does not survive between Bash calls in this harness, so a `TMP=` set in step 1 is
gone by step 2. The snippets below write `$TMP` only for readability; substitute
`.pr-self-review/run`.

That location is not arbitrary either. `.pr-self-review/` is gitignored, and `scope.sh` hashes
every *untracked* file's content into `worktreeHash`. Scratch files anywhere else in the repo
would change the hash between the scope and the verdict, and `gate.sh` would then refuse the push
it was just given a pass for. `/tmp` works too; nowhere else in the tree does.

Run the steps in order and stop at the first that says stop.

**1 — Scope the branch.**

```sh
bash scripts/pr-self-review/scope.sh > "$TMP/scope.json"
```

Pure function over the working tree, ~2s, always exits 0. It returns `routed[]` (files a
subagent reviews, each with the `domains` that must see it and the `lines` the branch touched),
`checklist[]` (read, but no skill applies), `skipped[]` (never read, always reported), and
`flagged[]` (the change itself is the finding — a committed `.env`, a one-sided `vendor/`
edit, an edit to a `skills-lock.json`-pinned skill). If `.branch` is `main`, stop.

**2 — Run Track A.**

```sh
bash scripts/pr-self-review/gates.sh < "$TMP/scope.json" > "$TMP/gates.json"
```

It runs only the gates whose package appears in `.packages`, plus the registry gate, which
always runs. **If any `.gates[].status` is `fail`, skip steps 3 and 4** — Track A already blocks
the push, and subagents would be paid for nothing. `--gates` skips them too. In both cases step 0
already left `findings.json` and `agents.json` as `[]`, so go straight to step 5 and change
nothing else. Read failures with [gates.md](gates.md).

**3 — One subagent per domain, in parallel.**

The domains present:

```sh
jq -r '[.routed[].domains[]] | unique[]' "$TMP/scope.json"
```

The file list for one of them:

```sh
jq --arg d frontend '[.routed[] | select(.domains | index($d))]' "$TMP/scope.json"
```

Dispatch them per `superpowers:dispatching-parallel-agents` — all of them in **one** message, so
they actually run concurrently. `security` sits on every routed file by design and is the one
agent that is not partitioned.

Each subagent's brief carries, and carries nothing else:

- its own file list, with the `lines` array — **a finding must land on a line the branch
  touched**, or `baseline.sh` will demote it in step 5;
- an instruction to read the relevant `<module>/INSIGHTS.md` **first**. That file records
  failures that already cost someone time here, which no upstream skill knows;
- the skills named for its domain in [routing.md](routing.md), and nothing else;
- the precedence rule and the empty-report rule from §5, quoted;
- the output contract: **a JSON array and no prose**, each element
  `{severity, source, file, line, message, fix}`. `fix` is one concrete action;
- **the four legal `severity` values, quoted into the brief: `critical`, `major`, `minor`,
  `note`.** Nothing else is a severity. This has to be stated because the subagent is given
  domain skills and nothing else — it never sees [severity.md](severity.md) — and three of the
  skills it *is* given (`react-best-practices`, `zod`, `security`) ship CRITICAL / HIGH / MEDIUM
  vocabularies of their own. A finding returned as `"high"` passes `baseline.sh` untouched, is
  counted in none of `report.sh`'s four buckets and printed in none of its four sections: it
  lands in `latest.json` and is invisible everywhere a human looks. Tell the agent to map its
  skill's own label to one of the four before returning;
- **`source` must begin `agent <domain> · `**, then the skill and section —
  `agent backend · onion-architecture §3.2`, never "the architecture skill".

  That prefix is not decoration. `baseline.sh` anchors a finding to the diff **only** when its
  `source` starts with `agent `, because that is what marks it as a model's opinion about a
  line rather than a deterministic fact about the repo. Drop the prefix and the finding stops
  being diff-anchored, and a pre-existing violation on an untouched line blocks the branch;
- read-only. It reports; it does not edit.

Collect the arrays into `$TMP/findings.json`, and build `$TMP/agents.json` as
`[{name, status, files}]` — one entry per dispatched agent, `files` being how many it was given.
An agent that crashed, timed out, or returned something that is not a JSON array gets a status
other than `ok`. **Record it honestly.** `report.sh` turns any such agent into the `incomplete`
verdict, which blocks; hiding it makes breaking a subagent the cheapest way past the gate.

**4 — Verify every critical adversarially.**

For each finding a subagent returned with `severity: "critical"`, dispatch one more subagent
whose whole job is to refute it: *"here is the finding, the file and the rule it cites — try to
refute it; if you are uncertain, treat it as refuted."* Model findings are noisy and here they
stop work, so the burden of proof sits on the finding.

- Refuted or uncertain → `severity` becomes `major`, and `verifier` records why.
- Survived → it stays `critical`, and `verifier` records the confirmation.

Track A findings do not go through this. They are already deterministic — see
[severity.md](severity.md).

**5 — Merge, then filter against the baseline.**

```sh
for f in scope.json gates.json findings.json; do
  jq -e 'type == "array" or type == "object"' "$TMP/$f" >/dev/null 2>&1 && continue
  echo "STOP: $TMP/$f is missing, empty or not JSON. --slurpfile reads it as null," >&2
  echo "      + takes null as its identity, and every finding it should have added" >&2
  echo "      vanishes into a report that reads pass. Fix the step that wrote it." >&2
  exit 1
done

jq -n --slurpfile s "$TMP/scope.json" --slurpfile g "$TMP/gates.json" \
      --slurpfile a "$TMP/findings.json" \
  '{ scope: $s[0], findings: ($s[0].flagged + $g[0].findings + $a[0]) }' \
  | bash scripts/pr-self-review/baseline.sh > "$TMP/final.json"
```

Three things about that command are load-bearing:

- **The guard is the command, not preamble to it.** A 0-byte `findings.json` — step 3 died
  mid-write, or its redirect truncated the file and the writer never came back — makes `$a[0]`
  `null`, and `X + null` is `X` with **exit 0**. Every subagent finding disappears and the run
  reads `pass` whenever Track A is clean. Nothing downstream can tell that array from a genuinely
  clean one; `report.sh` rule 6 sees a well-formed array of the wrong length and waves it through,
  and it is right to — it cannot know what was supposed to be in there. Here, before the `+`, is
  the last place the loss is visible. Same for `scope.json` and `gates.json`: an empty one takes
  `flagged[]` or the whole of Track A with it, just as quietly.
- **`scope.flagged[]` are findings.** Merge them or a committed `.env` is never reported.
- **`gates.findings` already contains the registry findings.** Do not call `registry.sh` again.

`baseline.sh` then drops any **model** finding frozen in `.pr-self-review/baseline.json`, and
demotes any model finding on a line the branch did not touch to `note` with `anchored: false` —
visible, unable to block. Deterministic findings are exempt from both rules and keep their
severity — they can be neither frozen nor demoted — which is why step 3's output contract insists
on the `agent ` prefix: it is the only thing telling `baseline.sh` which findings are a model's
opinion about a diff line.

**6 — Render.**

```sh
for f in scope.json gates.json final.json agents.json; do
  jq -e 'type == "array" or type == "object"' "$TMP/$f" >/dev/null 2>&1 && continue
  echo "STOP: $TMP/$f is missing, empty or not JSON. --slurpfile reads it as null," >&2
  echo "      so the key it fills lands as null in the payload — and a lost agents.json" >&2
  echo "      is a lost crashed-agent record, which is the verdict itself. Fix the step" >&2
  echo "      that wrote it." >&2
  exit 1
done

jq -n --slurpfile s "$TMP/scope.json" --slurpfile g "$TMP/gates.json" \
      --slurpfile f "$TMP/final.json" --slurpfile a "$TMP/agents.json" --arg mode gates \
  '{mode: $mode, scope: $s[0], gates: $g[0].gates, findings: $f[0], agents: $a[0]}' \
  | bash scripts/pr-self-review/report.sh
```

`report.sh` rule 6 does catch the `null`s this guard prevents, and records `incomplete` rather
than `pass`. The guard still earns its place: it says **which file** was lost, here, where you
can still fix the step that lost it, instead of leaving you a broken verdict and four candidate
steps to bisect.

**`--arg mode` is the one value you must set by hand, and the snippet deliberately reads
`gates`.** Change it to `full` *only* when steps 3 and 4 actually dispatched subagents across the
whole diff. Every other case — `--gates`, `--only critical`, and any run where a failing Track A
gate skipped step 3 — stays `gates`.

The default is the cautious one on purpose. `gate.sh` refuses `gh pr create` on any mode but
`full`, so a snippet hardcoded to `full` and pasted after a gates-only run would open a PR on a
review that dispatched no subagent at all — the one place a copy-paste defeats the PR half of the
gate. Pasted the other way round it merely refuses a PR that would have been allowed, costing one
turn. Cheap error, expensive error; pick the cheap one.

`report.sh` catches both halves of that mistake. `full` with an empty `agents[]` over a
**non-empty** `.routed[]` is recorded as `incomplete` and prints `NO SUBAGENT RAN`. And a `full`
claimed after subagents ran on *some* of the diff is caught too: `scope.json` carries the domain
set, so every domain in `.routed[].domains` must appear in `.agents[].name` or the run is
`incomplete` and prints `PARTIAL COVERAGE` naming the domains that were missed. Dispatch those
and re-run — the ones already covered do not need repeating.

`report.sh` writes `.pr-self-review/latest.json` for the hook and `.pr-self-review/report.md` for
people, prints the short form, and always exits 0. **The verdict never reaches you through an
exit code** — read it from the output or from `latest.json`.

If the report prints `BROKEN INPUT`, the payload was not something `report.sh` could read: it
needs `.scope` to be an object and `.findings`, `.gates`, `.agents` and `.scope.skipped` to each
be an **array of objects**. A key that arrived null, a key that arrived as a bare string, or an
array with a stray string among the objects — a subagent that returned prose instead of a finding
does exactly that — all land here. The unreadable parts are dropped, the readable ones still
print, and the verdict is `incomplete` rather than `pass`. Do not paper over it by re-running
step 6 with a hand-written array: find which step produced the bad shape and fix that.

**7 — Print the report and stop.** Do not fix anything unless asked. If the verdict is `blocked`,
say which criticals block and where, and say **which command** they stop: `latest.json`'s
`pushBlocked` is `false` when every surviving critical came from a subagent, and that verdict
stops `gh pr create` while still letting a push through ([severity.md](severity.md)). The user
decides what happens next.

## 4. The two modes that needed a decision

`--freeze` and `--only critical` do not simply run steps 1–7, and their procedures — the freeze
snippet that replaces step 5, and the `--only critical` carry-forward with the six things that
had to be true at once — are in **[modes.md](modes.md)**. Read it before running either. A
`--full` or `--gates` run never opens it.

Two things from there are worth knowing without opening it: a freeze writes no `latest.json`, so
it grants no verdict and unblocks nothing; and `--only critical` records `mode: "gates"`, because
Track A ran whole and Track B did not.

## 5. Two rules that live only here

**A repo skill overrules an upstream one.** `drizzle-orm-patterns` Example 1 builds the client
and runs `db.select()` at module scope, beside the schema; `onion-architecture` §3.2 puts every
query in a `repository.ts`. Both load for the same file in the same
subagent. When a skill under `.claude/skills/` that we authored — `onion-architecture`,
`frontend-architecture`, `engineering-insights` — disagrees with a pinned upstream copy, **ours
wins and the upstream rule is not reported at all.** Not reported as a minor, not reported "for
completeness". One report carrying two contradictory findings is a report nobody reads twice.
`skills-lock.json` is the list of the pinned ones; anything absent from it is ours.

**An empty report is a valid result.** Zero findings print as zero. Inventing one so the run
looks worthwhile is prohibited outright, and so is padding a thin run with notes. The root
`INSIGHTS.md` already records that reviews in this repo legitimately return nothing — a clean
verdict on a small, careful diff is the expected outcome, not a failed review.

## 6. Boundary with the sibling commands

Split by **what happens after the output**, not by what is inspected.

| Run | Answers | Blocks? |
|---|---|---|
| **`/pr-self-review`** (this) | Does the branch obey *this repo's* conventions and gates? | yes — `git push` and `gh pr create` |
| `/code-review` | Is the logic right? Does this code have bugs? | no |
| `/security-review` | Is there a vulnerability in the pending changes? | no |
| `superpowers:requesting-code-review` | Generic pre-merge review | no |

This skill **supersedes `superpowers:requesting-code-review` in this repo** — same intent, but
that skill knows nothing about `pnpm arch`, the twice-vendored `shared/`, or `skills-lock.json`.
Do not run both.

It **does not hunt for bugs.** `/code-review` and `/security-review` are better at it and the
report says so in its own last line. What this skill has that they do not is gates, repo
conventions, secrets, and a verdict that refuses to let a push through.

## 7. Red flags

Stop when you catch yourself doing any of these.

| Red flag | Why it is wrong |
|---|---|
| "Nothing found — I'll add a note so it looks thorough" | §5 — an empty report is the result |
| "The Drizzle skill says this query is fine" | §5 — the repo skill wins; do not report the upstream rule |
| "The frontend agent died, I'll just report the other four" | §3.3 — that is the `incomplete` verdict, and it blocks |
| "This critical is obvious, skip the verifier" | §3.4 — a false critical stops the user's work |
| "I'll fix the two criticals while I'm here" | §intro — the verdict is stale the moment you edit |
| "Track A failed, but let's see what the agents find" | §3.2 — it already blocks; the agents are wasted spend |
| "`scope.flagged` is just metadata" | §3.5 — it holds the committed-secret criticals |
| "The source can just name the skill" | §3.3 — without the `agent ` prefix it is never diff-anchored |
| "The `jq` probably worked, `mv` it into place" | modes.md — a failed `jq` leaves a 0-byte file that reads as zero findings |
| "`findings.json` is 0 bytes, so the agents found nothing" | §3.5 — 0 bytes is a crash; a run that found nothing writes `[]` |
| "The agent returned prose, I'll drop it in the array as-is" | §3.6 — a string among the objects is `BROKEN INPUT` |
| "No subagent ran, but the diff was small — call it `full`" | §3.6 — routed files with no agent is `NO SUBAGENT RAN` |
| "`recheck` came back empty, something must be broken" | modes.md — no Track B critical is the ordinary case; carry on |
| "`BROKEN INPUT` — I'll just re-run step 6 with the array" | §3.6 — that hides which step lost it |
| "I'll re-freeze the baseline so the branch goes green" | modes.md — the baseline only shrinks |
| "It's on line 300 of a file I touched at line 40" | §3.5 — that is baseline, not yours |
| "Run it on `main`, it's only a check" | §1 — there is no base and no PR |

## 8. Before you print the report

- [ ] `.branch` was not `main` (§1)
- [ ] Track A ran, and a failure stopped Track B before any subagent was dispatched (§3.2)
- [ ] Every dispatched agent has an entry in `agents[]`, and a broken one says so (§3.3)
- [ ] Every subagent `critical` carries a `verifier` line (§3.4)
- [ ] `scope.flagged[]` was merged into the findings before `baseline.sh` (§3.5)
- [ ] Every subagent finding's `source` begins `agent <domain> · ` (§3.3)
- [ ] Every finding has `file`, `line`, a `source` naming skill and section, and a `message`
- [ ] Every surviving `critical` carries one concrete `fix`
- [ ] No finding restates an upstream rule that a repo skill contradicts (§5)
- [ ] Nothing was invented to fill the report, and nothing was edited (§5)
- [ ] `mode` matches what actually ran — `full` only when both tracks covered the whole diff (§2)
