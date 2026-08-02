# Insights — server/

Failures and surprises specific to this package. Repo-wide ones live in the root
`INSIGHTS.md`. Seven fixed sections, append-only —
`../.claude/skills/engineering-insights/SKILL.md` holds the rules.

---

## What Works

_Nothing recorded yet._

## What Doesn't Work

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

## Codebase Patterns

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

## Tool & Library Notes

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

## Session Notes

_Nothing recorded yet._

## Open Questions

_Nothing recorded yet._
