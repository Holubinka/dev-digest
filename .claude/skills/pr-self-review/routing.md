# Routing — which files reach Track B, and what its two agents open

Step 3 of [SKILL.md](SKILL.md) dispatches two subagents over the routed diff. This file says
which files that is, and what each agent is given to read.

**This file copies no rules.** It points at the checklist a skill ships and stops there. A third
copy of a rule is a third thing to drift, and this repo already pays that bill twice over in
`vendor/shared/`.

## 1. What is routed, and to whom

`scope.sh` decides, in its `domains_for` function. **That function is the executable copy; the
tables below are the readable one. If they disagree, the script is right.**

Routed — source Track B reads, after `skip_reason` and `flag_for` have removed dependencies,
build output, generated snapshots, binaries, secrets, vendored copies and locked skills:

| A path matching | Routed |
|---|---|
| `client/src/**/*.ts(x)`, and `client/**/*.test.ts(x)` outside it | yes |
| `server/src/**` | yes — **all of it**, not only `modules/`, `adapters/`, `platform/` and `db/` |
| `reviewer-core/src/**` | yes |
| `mcp/src/**` | yes — added after `TESTING.md` had already named it as a gap: no Track A gate either (still true, unchanged by this), so before this a diff confined to `mcp/src/**` routed to nobody and gated on nothing |
| `**/contracts/**`, `**/*.schema.ts` | yes, and nothing in this repo matches: there are no `*.schema.ts` files, and every `contracts/` directory sits under `*/vendor/shared/`, which `flag_for` diverts before routing |
| everything else | no: `checklist[]` |

Track A still gates only three packages (`gates.md`) — this table now routes a fourth to Track B
without gating it. A `mcp/`-only diff gets a real security/conventions read and still shows every
Track A row as `skip`; that asymmetry is real, not a bug in this change.

Both agents get that whole set:

| Agent | Opens | Is there for |
|---|---|---|
| `security` | `security` | injection, authorization bypass, path traversal, SSRF, a secret in the diff. The only Track B findings the severity model lets block |
| `conventions` | the three checklist skills in §2 | running those checklists against the diff, as written |

Three properties are deliberate and easy to break:

- **Neither agent is partitioned.** Both see the whole reviewed diff, so either can spot a
  cross-file problem. `.routed[].domains` therefore carries the same pair on every entry: it is
  the roster `report.sh` checks the run against, not a per-file routing decision.
- **`security` has a rule of its own.** It used to have none — it was *appended* to whichever of
  five partitioned domains matched, so those five patterns were the routing test itself. Deleting
  them without replacing the test would have emptied `routed[]` and dispatched both surviving
  agents over zero files while the run still printed a verdict.
- **`server/src/**` routes whole.** The old `backend`/`data` split left `server/src/index.ts` and
  anything else outside those four directories reaching no domain at all — read by nobody. That
  was a hole, not a scope decision.

Files that reach no domain land in `checklist[]`: `.github/workflows/**`, `scripts/**`,
`docker-compose.yml`, `*.env.example`, `docs/**`, `specs/**`, `plans/**`, `*.md`. Read them, no
subagent.
The one thing worth raising from that list: `docs/architecture.md` in the diff earns a `note`
asking whether its diagram still holds.

### The `security` agent enumerates before it searches

Its brief carries one instruction its skill does not: **before looking for a vulnerability, build
the list.** For each attacker-reachable path the diff touches, name every input that travels it
and the bound on each one — length, byte size, count, allowed characters, resolved location. An
input whose bound you cannot name is a finding. Say so explicitly when there is none: *"every
input on this path is bounded, and here they are"* is a result, and it is the only form of answer
the next run can check.

The list is not the findings. Only its unbounded entries are, and a bound enforced elsewhere on
the path still counts as a bound — §5's ban on padding a thin run applies here unchanged.

The failure it answers, from the first branch this skill reviewed four times. Four consecutive
`--full` runs on `feat/agent-layer` each returned exactly one defect of the same shape, all on the
classifier's input path, and each fix opened the next run's surface:

| Run | Finding | Bound that was missing |
|---|---|---|
| 1 | a symlink read escaping the clone | where the path resolves |
| 2 | a symlink resolving back into `<clone>/.git` | where the path resolves |
| 3 | `fs.readFile` on an attacker-named file | bytes |
| 4 | twenty commit subjects, count-capped only | characters |

Every one was present and findable in run 1. What differed was attention: an agent told to
*search* samples the space and returns what it happens to reach, so it surfaces one instance per
pass and stops. Runs 3 and 4 were also steered — their briefs said prior rounds had found defects
in that file, which shortens the search but is not review. An enumeration needs no steering, and
its output is falsifiable: a named input with a named bound can be checked by the next reader,
and a missing row is visible where a silent pass is not.

**Unmeasured.** Whether this finds the set in one pass, or only makes reports longer, has not
been run — [README.md](README.md) §8 records it as owing a measurement.

## 2. Skills that ship a checklist — run it

Three of the thirteen end in a checklist written to be run against a diff. Open the skill and
work the list; nothing here restates it.

| Skill | Section | Given to |
|---|---|---|
| `frontend-architecture` | §Review checklist | `conventions` |
| `onion-architecture` | §7 Review checklist | `conventions` |
| `typescript-expert` | §Code Review Checklist | `conventions` |

This section survived the narrowing on evidence, and it is the reason `conventions` exists. The
one Track B finding in the whole acceptance run that was worth having — a 16-line Drizzle query
added straight into `pulls/routes.ts` — came from `onion-architecture` §7. All eleven of the
throwaway findings came from the pointer lists we invented for skills that ship no checklist,
which is what §3 used to hold and why it is gone. Checklists written to be run against a diff are
cheap and produced the only result; our invented questions were expensive and produced noise.

`conventions` opens all three over the whole routed diff and skips the ones with nothing to
apply. `typescript-expert` is the one that had no live trigger of its own — its old domain,
`contracts`, cannot fire here (§1) — but it is a general TypeScript review checklist and the diff
is TypeScript, so it is reachable for the first time.

## 3. The question lists that used to be here

Gone, deliberately. §3 carried three to six invented *questions* per skill for the eight skills
that ship no checklist — pointers we wrote at their section headings. The acceptance run measured
what they bought: eleven of Track B's twelve findings came from them, every one of them small
(an `export *` barrel, two derive-don't-store effects, six test-style items), none blocking, at
509k tokens across four agents. The twelfth — the only one worth having — came from a real
`Review checklist`. They were unmeasured when they were written and the one measurement did not
favour them, so they are not kept as "nearly free".

Two consequences worth knowing:

- **The RED prong can be re-run honestly again.** The old `security` block named commit
  `1d5348d` and described the defect that prong plants, so the shipped file handed the agent the
  answer. Nothing here does now.
- **Two facts, not questions, survive into the `security` agent's brief**, because both prevent
  false findings rather than prompting for true ones: the skill's §Framework Security Quirks
  covers MongoDB, Mongoose and Express, a stack this repo does not have, so nothing is reported
  against it; and its §Core Philosophy confidence bar does not replace our adversarial verifier
  ([SKILL.md](SKILL.md) §3.4) — a critical clears both.

## 4. Skills from outside `.claude/skills/`

They come from the plugin cache and the built-ins. There is no `~/.claude/skills/`.

| Skill | Used for |
|---|---|
| `superpowers:dispatching-parallel-agents` | the step-3 fan-out — one message, many agents |
| `superpowers:verification-before-completion` | the report's evidence rule: no claim without the command that proves it |
| `superpowers:test-driven-development` | supplies "new behaviour with no test is major" |
| `superpowers:receiving-code-review` | what the user does with the report, after |
| `superpowers:finishing-a-development-branch` | what happens once the verdict is a pass |
| `engineering-insights` | **after** a run, when a finding turned out to be worth recording. Never during one — it writes, and a review does not. |

## 5. Deliberately unused

Listed so the next editor does not add "the missing one".

| Not used | Why |
|---|---|
| `react-best-practices`, `next-best-practices`, `react-testing-library`, `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`, `zod` | they ship no `Review checklist`, so the only way to aim them at a diff was the invented question lists in §3. Those produced eleven small findings out of twelve for 509k tokens and are gone; the skills go with them. Any of them is still the right thing to open **while writing** the code — this is a list of what a *review* dispatches. |
| `mermaid-diagram` | generative, not analytic. Nothing in a review produces a diagram. |
| `claude-api` | skipped **by its own rule**: its SKIP clause defers to whichever provider the project already uses, and `reviewer-core` depends on `openai`. |
| `superpowers:requesting-code-review` | superseded here — [SKILL.md](SKILL.md) §6. Running both duplicates every finding. |
| the rest of `superpowers` — `brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development`, `systematic-debugging`, `using-git-worktrees`, `using-superpowers`, `writing-skills` | authoring and process skills. A review reads; it does not plan, debug or write. |
| all of `chrome-devtools-mcp` | needs a live browser. The e2e suite owns that, and `e2e/specs/*.flow.json` is Tier 2 — flagged, never opened. |
| everything else in the plugin cache and the built-ins — `dataviz`, `artifact-design`, `run`, `init`, `loop`, `schedule`, `update-config`, … | not review skills. |

## 6. Where this drifts

Three section pointers are left, in §2, and one of them — `typescript-expert` — is pinned
upstream in `skills-lock.json`, so its `## Code Review Checklist` heading can be renamed by an
update and nothing here detects it. The other two are ours. Dropping §3 removed thirty-odd such
pointers into five pinned skills, which is the second reason to be glad of it.

If an agent reports that a named section does not exist, that is a defect in this file — fix the
pointer, do not guess at the content.

The roster itself drifts in three places at once: `scope.sh`'s `TRACK_B`, §1 here, and
[SKILL.md](SKILL.md) §3.3. `scope.sh` is the executable copy. A `report.sh` run whose
`UNEXPECTED AGENT` or `PARTIAL COVERAGE` banner names something you did dispatch means these
three have already disagreed.
