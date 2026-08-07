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

## Codebase Patterns

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

### A fixture patch's `additions`/`deletions` are unchecked, and one of them is already wrong

**Symptom.** `db/seed-fixtures.ts` declares each file's `additions`/`deletions` next to a
hand-written unified-diff string. Nothing verifies the two agree. `SEARCH_ROUTES` (PR #102)
declares `+9 -4` over a patch containing 7 added lines — checked 2026-08-06, still wrong,
left standing because correcting it changes an unrelated fixture's stored numbers.

**Cause.** The numbers are inserted straight into `pr_files` and never derived from the patch.
Typecheck cannot see it, and no test asserts it. Anything summing them then disagrees with the
diff it renders — `GET /pulls/:id/smart-diff` totals exactly these columns into
`split_suggestion.total_lines`.

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

## Open Questions

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
  contradicts `specs/05-intent-layer.md` Step 12, which justifies storing the cost on `pr_intent`
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
