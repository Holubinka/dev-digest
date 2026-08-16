# Insights — server/

Failures and surprises specific to this package. Repo-wide ones live in the root
`INSIGHTS.md`. Seven fixed sections, append-only —
`../.claude/skills/engineering-insights/SKILL.md` holds the rules.

---

## What Works

_Nothing recorded yet._

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

## Tool & Library Notes

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

## Recurring Errors & Fixes

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

## Session Notes

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

## Open Questions

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
