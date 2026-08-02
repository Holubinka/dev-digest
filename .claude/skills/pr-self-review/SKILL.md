---
name: pr-self-review
description: "Reviews every open change on the branch against this repo's own skills and gates, and writes the verdict a push waits for. Use when running /pr-self-review, when a git push or gh pr create was refused by the PR Self-Review hook, before opening a PR, or when asked to check a branch against the repo conventions. Runs the deterministic gates first (arch, lint, typecheck, tests, vendor mirror, skills registry), then one subagent per domain over the routed files, verifies every critical adversarially, and records .pr-self-review/latest.json. It checks conventions, not correctness."
metadata:
  version: "1.0.0"
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

Two of these need care, so their procedures are written out in §4 rather than left implied.

## 3. The procedure

Every step writes into one scratch directory. Use `.pr-self-review/run`, and pass it literally in
every command rather than as a shell variable — **shell state does not survive between Bash
calls** in this harness, so a `TMP=` set in step 1 is gone by step 2. Use `mkdir -p
.pr-self-review/run` once at the start; the snippets below write `$TMP` for readability.

That location is not arbitrary. `.pr-self-review/` is gitignored, and `scope.sh` hashes every
*untracked* file's content into `worktreeHash`. Scratch files anywhere else in the repo would
change the hash between the scope and the verdict, and `gate.sh` would then refuse the push it
was just given a pass for. `/tmp` works too; nowhere else in the tree does.

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
the push, and subagents would be paid for nothing. Set `agents` to `[]` and go to step 5.
`--gates` also skips 3 and 4, with `agents` `[]`. Read failures with [gates.md](gates.md).

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
  `{severity, source, file, line, message, fix}`. **`source` must begin `agent <domain> · `**,
  then the skill and section — `agent backend · onion-architecture §3.2`, never "the
  architecture skill". `fix` is one concrete action;

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
jq -n --slurpfile s "$TMP/scope.json" --slurpfile g "$TMP/gates.json" \
      --slurpfile a "$TMP/findings.json" \
  '{ scope: $s[0], findings: ($s[0].flagged + $g[0].findings + $a[0]) }' \
  | bash scripts/pr-self-review/baseline.sh > "$TMP/final.json"
```

Two things about that command are load-bearing:

- **`scope.flagged[]` are findings.** Merge them or a committed `.env` is never reported.
- **`gates.findings` already contains the registry findings.** Do not call `registry.sh` again.

`baseline.sh` then drops anything frozen in `.pr-self-review/baseline.json`, and demotes any
**model** finding on a line the branch did not touch to `note` with `anchored: false` — visible,
unable to block. Deterministic findings are exempt from that rule and keep their severity, which
is why step 3's output contract insists on the `agent ` prefix: it is the only thing telling
`baseline.sh` which findings are a model's opinion about a diff line.

**6 — Render.**

```sh
jq -n --slurpfile s "$TMP/scope.json" --slurpfile g "$TMP/gates.json" \
      --slurpfile f "$TMP/final.json" --slurpfile a "$TMP/agents.json" --arg mode full \
  '{mode: $mode, scope: $s[0], gates: $g[0].gates, findings: $f[0], agents: $a[0]}' \
  | bash scripts/pr-self-review/report.sh
```

`report.sh` writes `.pr-self-review/latest.json` for the hook and `.pr-self-review/report.md` for
people, prints the short form, and always exits 0. **The verdict never reaches you through an
exit code** — read it from the output or from `latest.json`.

**7 — Print the report and stop.** Do not fix anything unless asked. If the verdict is `blocked`,
say which criticals block and where; the user decides what happens next.

## 4. The two modes that needed a decision

**`--freeze`.** Run steps 1–4 exactly as `--full`, then replace step 5 with:

```sh
jq -n --slurpfile s "$TMP/scope.json" --slurpfile g "$TMP/gates.json" \
      --slurpfile a "$TMP/findings.json" \
  '{ scope: $s[0], findings: ($s[0].flagged + $g[0].findings + $a[0]) }' \
  | bash scripts/pr-self-review/baseline.sh --freeze
```

Then **stop**. There is no step 6: a freeze writes no `latest.json`, so it grants no verdict and
unblocks nothing. Say what was frozen and that `/pr-self-review` must be run again for a verdict.

Two things to say out loud when you do it. The fingerprint is `{file, line, message}`, and a
Track A finding stores twenty lines of raw command output in `message` — so freezing a gate
failure almost never re-matches on the next run. Freeze is for Track B findings and Tier-2 flags;
a red gate gets fixed, not frozen. And the file only ever shrinks: re-freezing to clear a new
finding is the one thing this baseline cannot survive.

**`--only critical`.** Read the previous verdict **before** anything overwrites it:

```sh
jq -r '[.findings[] | select(.severity == "critical")
                    | select(.source | startswith("agent ")) | .file] | unique[]' \
  .pr-self-review/latest.json > "$TMP/recheck"
```

Only **Track B** criticals go on that list. A gate critical needs no narrowing — step 2 re-runs
every gate in full anyway, and `skills-lock.json` is not a file a subagent reviews.

No `latest.json` means there is no last run to narrow — say so and run `--full` instead. Then:

- Steps 1 and 2 run **in full**. Track A is seconds, and it is the half that blocks a push.
- Steps 3 and 4 cover only the routed files listed in `$TMP/recheck`, and only the domains those
  files carry.
- Step 5 **carries forward** the previous run's subagent findings for every file that was *not*
  re-checked, merged with the new ones. Dropping them is how repeatedly narrowing a re-check
  turns a blocked branch green without a line being fixed. Gate and `gate scope` findings are not
  carried — they re-ran:

  ```sh
  jq -n --slurpfile p .pr-self-review/latest.json --slurpfile n "$TMP/findings.json" \
        --rawfile r "$TMP/recheck" \
    '($r | split("\n") | map(select(length > 0))) as $re
     | [ $p[0].findings[]
         | . as $f
         | select($f.source | startswith("agent "))
         | select(($re | index($f.file)) | not) ] + $n[0]' > "$TMP/findings.json"
  ```

  Bind the finding to `$f` before the `index`. After the pipe into `index()`, a bare `.file`
  reads off `$re`, not off the finding — `jq` answers `Cannot index array with string "file"`,
  and a subtler shape of the same mistake once shipped silently in `baseline.sh`.

- Step 6 records **`mode: "gates"`, not `"full"`.** Track A ran whole, Track B did not, and
  `gates` is exactly the mode `gate.sh` already treats as *enough for a push, not enough for a
  PR*. A partial review must never open a PR, and `latest.json` has only these two mode values —
  inventing a third would still be accepted for a push while confusing every later reader.

## 5. Two rules that live only here

**A repo skill overrules an upstream one.** `drizzle-orm-patterns` will show a query sitting in a
handler; `onion-architecture` §3.2 forbids exactly that. Both load for the same file in the same
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
| "I'll re-freeze the baseline so the branch goes green" | §4 — the baseline only shrinks |
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
