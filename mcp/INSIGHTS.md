# mcp/ — insights

What already cost someone time here. Read before debugging in this package.

## Tool & library notes

### MCP SDK v2 requires Zod 4; the rest of this repo is on Zod 3

**Symptom.** `registerTool` from `@modelcontextprotocol/server@2.0.0` rejects a Zod 3 schema:

```
error TS2769: No overload matches this call.
    Property 'jsonSchema' is missing in type 'Props<...>' but required in type 'Props<unknown, unknown>'.
```

**Cause.** v2 accepts only `StandardSchemaWithJSON` — a schema exposing `~standard.jsonSchema`.
Zod 4, ArkType and Valibot implement it; Zod 3 does not. `@modelcontextprotocol/server@2.0.0`
declares `zod: ^4.2.0` itself.

**Fix.** `mcp/` stays on SDK v1 (`@modelcontextprotocol/sdk@1.30.0`), which takes a Zod 3 raw
shape, so `mcp/` keeps the `zod: ^3.24.1` that `server/`, `client/` and `reviewer-core/` use.
Choosing v2 would mean a second major of Zod in the repo. Measured 2026-08-08.

### v2's `SUPPORTED_PROTOCOL_VERSIONS` is the legacy list — 2026-07-28 lives behind `server/discover`

`@modelcontextprotocol/server@2.0.0` exports `LATEST_PROTOCOL_VERSION = 2025-11-25`, which reads as
if the 2026-07-28 spec revision never shipped. It did: send `server/discover` and v2 answers
`{"supportedVersions":["2026-07-28"],...}`, while SDK v1 answers `-32601 Method not found`. Do not
read the exported constant as the whole answer. Re-probe with `scripts/discover-probe.mjs`; the
`_meta` envelope keys are `io.modelcontextprotocol/protocolVersion`, `/clientInfo` and
`/clientCapabilities`.

### Claude Code 2.1.226 negotiates 2025-11-25 and runs a v1-SDK server today

Its binary carries `$dt="2025-11-25"` and
`elr=[$dt,"2025-06-18","2025-03-26","2024-11-05","2024-10-07"]`. Independent of the spike:
`chrome-devtools-mcp@1.6.0` bundles `@modelcontextprotocol/sdk` 1.29.0 and `claude mcp list`
reports it Connected — a v1-line stdio server working against this exact client build. The binary
*also* contains a `server/discover` builder and the string
`required _meta envelope for protocol revision 2026-07-28`, so a future release opening with the
modern handshake is the one thing that would strand the v1 line.

### `mcp/` needs `NodeNext`, unlike `server/` and `reviewer-core/`

`mcp/tsconfig.json` sets `module`/`moduleResolution: "NodeNext"` and relative imports carry a `.js`
extension, where `server/` and `reviewer-core/` use `Bundler` and bare paths. The reason is that
`mcp/` is the only one of the three that **emits JS and runs as a process** (`node
mcp/dist/index.js`), and Node ESM does not add extensions. With `Bundler` the build succeeds and the
launch fails with `ERR_MODULE_NOT_FOUND`.

The trap: Vitest 2.1.9 resolves `./errors.js` → `errors.ts` correctly, so **the test suite does not
catch this**. Only running the built `dist/` under real Node does. Verified 2026-08-08 on Node
v22.23.1.

### A binary that writes to stdout crashes with an unhandled `EPIPE` the first time it is piped

**Symptom.** `node dist/cli.js --help | head -3` printed the first three lines and then a stack
trace: `Error: write EPIPE … Emitted 'error' event on Socket instance`. Measured 2026-08-09 on
Node v22.23.1, with the CLI passing every unit test — the suite injects its own `out`/`err`
sinks, so no test ever touches a real stream.

**Cause.** When the reader closes the pipe first, `process.stdout` emits an `error` event.
Node turns an `error` event with no listener into an uncaught exception. `head`, `grep -q` and
any pager do exactly this, and `devdigest review`'s stdout contract — one line per finding — is
built to be piped.

**Fix.** `src/cli.ts` attaches a handler to both streams that swallows `EPIPE` and re-throws
everything else. This belongs to any future binary in this package and cannot be covered by the
Vitest suite; verify it with `node dist/cli.js --help | head -3`, which must print three lines
and nothing else. Note `src/index.ts` needs no such guard: its stdout is the MCP transport, and
a client that closed it has ended the session anyway.

### A tool result declared as an `interface` cannot be returned from `registerTool`

**Symptom.** Every one of the five `server.registerTool(...)` calls in `src/index.ts` failed to
compile with the same error, while the handler bodies were plainly right:

```
error TS2322: Type 'Promise<ToolTextResult>' is not assignable to type 'Promise<{ [x: string]: unknown; content: (...)[]; ... }>'
  Index signature for type 'string' is missing in type 'ToolTextResult'.
```

**Cause.** The SDK's `CallToolResult` carries an index signature (`[x: string]: unknown`).
TypeScript gives a **type alias** an implicit index signature but never gives one to an
**interface**, so `interface ToolTextResult` is not assignable however correct its fields are.

**Fix.** `src/errors.ts` declares `export type ToolTextResult = { … }`, not `interface`. One
keyword, and it is invisible until the first `registerTool` call site exists. Measured
2026-08-08 against `@modelcontextprotocol/sdk@1.30.0`.

### Vitest fake timers start `Date.now()` at the real epoch, not at 0

**Symptom.** A test recording `Date.now()` inside the poll callback and filtering
`t < 30_000` to check the 2s phase got an empty array — every timestamp was ~1.8e12.

**Cause.** `vi.useFakeTimers()` freezes the clock at the current real time. Only elapsed
values (`now() - startedAt`, which `wait.ts` returns) are relative.

**Fix.** `vi.setSystemTime(0)` in `beforeEach`, then a recorded `Date.now()` reads as "ms since
the wait started". `test/wait.test.ts` does this.

### A rejection during `advanceTimersByTimeAsync` is unhandled unless `.catch` is attached first

**Symptom.** `npm test` printed `Tests 6 passed` and `Errors 2 errors`, with two serialized
`ToolError`s from a test that had asserted the rejection correctly.

**Cause.** `const p = runAgentOnPr(...); await vi.advanceTimersByTimeAsync(30_000); await
p.catch(…)` rejects *inside* the advance, before any handler exists.

**Fix.** Attach it on creation: `const settled = runAgentOnPr(...).catch((e) => e)`, advance,
then `await settled`. Both rejection tests in `test/run-agent.test.ts` are written this way.

## What doesn't work

### `npm run …` as an `.mcp.json` command breaks the transport twice over

**Symptom.** The first bytes on stdout are `\n> @devdigest/...@0.0.0 start\n> node dist/index.js\n\n`
instead of a JSON-RPC frame, and `process.cwd()` inside the server is the package directory rather
than the repo root.

**Cause.** npm prints its script banner to stdout, and `npm --prefix <dir> run` chdirs into `<dir>`.

**Fix.** `.mcp.json` uses `"command": "node", "args": ["mcp/dist/index.js"]`. Verified 2026-08-08 by
capturing raw stdout: `node mcp/dist/index.js` yields 0 non-JSON stdout lines.

### MCP Inspector CLI receives progress notifications but never renders them

Inspector CLI 2.1.0 forwards `--tool-metadata progressToken=…` and the server does emit
`notifications/progress`, but the CLI prints them in neither its text output nor stderr. "No progress
shown in Inspector" is therefore evidence of nothing. Use `scripts/driver.mjs` instead — it prints
every frame on the wire.

### A timeout test whose ceiling lands on the poll grid proves nothing

**Symptom.** Deleting the sleep clamp in `wait.ts` (`sleep(Math.min(interval, ceilingMs -
elapsed))` → `sleep(interval)`) left `test/wait.test.ts` fully green.

**Cause.** The default ceiling, 120 000 ms, is an exact multiple of the 5 s slow poll, so the
unclamped loop happens to land on 120 000 anyway. The test asserted `elapsedMs === 120_000`
and could not tell the two implementations apart.

**Fix.** Assert against a ceiling that is **off** the poll grid — 121 000 ms, where unclamped
overshoots to 125 000. Same family as the repo's astral-truncation rule: a fixture that does
not discriminate is not a test. Found by mutation, not by review.

### A sort test whose fixture agrees with the fallback order proves nothing

**Symptom.** `test/blast-radius.test.ts` pinned the caller order as "rank desc, then file, then
line" and passed. Deleting the rank comparison from `compareBlastCallers` in `src/project.ts`
left it **green**. Found 2026-08-09 by mutation, not by review.

**Cause.** The fixture's low-ranked file was `src/low.ts` and the high-ranked ones were
`src/also-high.ts` / `src/high.ts`, so alphabetical order alone produced the expected list. The
first sort key was never exercised.

**Fix.** Name the fixture so the fallback keys DISAGREE with the primary one: the unimportant
caller is `src/aaa-low.ts` and the important ones are `src/mmm-high.ts` / `src/zzz-high.ts`, so
dropping the rank key moves `aaa-low` to the front. Same family as the poll-grid timeout above
and the repo's astral-truncation rule — for any comparator with more than one key, build the
fixture so each key alone would give a different answer.

### `safeParse` over a narrow schema catches a REMOVED contract field, never an ADDED one

**Symptom.** `server/src/vendor/shared/contracts/blast.ts` gained `link_sha` and
`index_matches_head` on 2026-08-09. `mcp/` kept compiling, `npm test` stayed green, and
`get_blast_radius` kept answering — with both new fields silently stripped, so the tool handed a
model 20 `"file:line"` references and no commit to resolve them against. Nothing failed. Found by
reading the contract, not by a gate.

**Cause.** `BlastPayload` in `src/api/schemas.ts` strips unknown keys deliberately (its header
comment says so), which is what lets the API grow without breaking this server. The consequence is
that the compensating control `AGENTS.md` advertises — "a moved API contract becomes a loud,
self-describing tool error" — only fires for a field the schema **names** going missing or changing
type. A new field the tool ought to project looks exactly like a new field it should ignore.

**Fix.** Treat a new field in `server/src/vendor/shared/contracts/**` as a review item for every
narrow schema mirroring that contract; no gate will raise it, and `scripts/pr-self-review/scope.sh`
maps `mcp/` into no package at all, so a server-side contract change reaches this package through
nobody's checklist. The cheap confirmation is the shipped result, not the source:
`node scripts/driver.mjs --tool <name> --args '<json>' --no-progress -- node dist/index.js`.

## What works

### Drive the BUILT server against a loopback stub API, and every tool is provable for free

`scripts/driver.mjs --tool <name> --args <json>` plus a ~120-line `node:http` stub on
127.0.0.1 exercises all five tools end to end through real stdio, the real SDK and the real
`dist/` — no Postgres, no API, no provider call, no money. It caught what unit tests
structurally cannot: that `dist/index.js` resolves its imports under real Node, that the first
bytes on stdout are a JSON-RPC frame, and that `notifications/progress` is on the wire with the
token the client issued. Verified 2026-08-08: a stub that never reports `done` plus
`DEVDIGEST_MCP_RUN_TIMEOUT_MS=6000` reproduces the `still_running` ceiling path in six seconds.

Keep the stub in a scratch directory, not in `mcp/` — it is a fixture for one verification, and
a committed fake API is a second contract to keep in step with the real one.

### Drive an MCP server with a raw stdio script before trusting a client

`scripts/driver.mjs` spawns the server, writes newline-delimited JSON-RPC to its stdin and keeps
stdout and stderr apart. That answers three things no client UI will: the first bytes on stdout, the
count of progress frames actually on the wire, and the negotiated protocol version.

### An MCP stdio server inherits the Claude Code process's cwd — the project root

Verified 2026-08-08 across five live server processes in two different projects: find the
claude → server pair with `ps -axo pid,ppid,command`, then `lsof -a -d cwd -p <pid>`. Every server's
cwd equalled its parent claude's cwd. Relative paths in `.mcp.json` `args` are therefore safe, and
this is checkable without an interactive session.

### `claude mcp list` validates `.mcp.json` before the server it points at exists

Run from the repo root it prints one line per configured server, project-scope entries included:

```
devdigest: node mcp/dist/index.js - ⏸ Pending approval (run `claude` to approve)
```

That single line proves the file parsed, the entry was discovered at project scope, and the
`command` + `args` are what you meant — with no `dist/` on disk and no session started. Verified
2026-08-08 while `mcp/src/index.ts` did not yet exist. `⏸ Pending approval` is the normal first-use
state for a committed project-scope server, not a fault; the other entries in the same output show
`✔ Connected`, so a real connection failure is distinguishable at a glance.

Pair it with `node mcp/dist/index.js < /dev/null` from the repo root: Node's `Cannot find module
/abs/path/...` error is how you confirm the relative path resolves to the file the build will
produce, rather than waiting for a client to fail quietly.

## Codebase patterns

### No frame logging in the shipped server

The spike logged every inbound JSON-RPC frame to a file (`DEVDIGEST_SPIKE_LOG`) to learn what an
unobservable client sends. In the shipped server that same hook would write tool arguments — repo
slugs, PR numbers, whatever a user typed — to an unrotated file chosen by an environment variable.
It is a diagnostic for a throwaway package only, and it did not survive into `src/`.

### Review selection is keyed on `run_id`, which is why `kind` is not parsed

`ReviewDto` carries `kind: 'summary' | 'review'`, and it is deliberately absent from
`ReviewSummary` in `src/api/schemas.ts`. `get_findings` picks a review by the `run_id` it took
from `GET /pulls/:id/runs`, and a run id is an `agent_runs` row — a reduce/summary review
cannot own one. Nothing in the server writes `kind: 'summary'` today either
(`server/src/modules/reviews/run-executor.ts:414` is the only insert and it writes `'review'`).
Filtering on `kind` would be a second lock on a door already locked. If selection ever stops
being keyed on `run_id`, add the field and filter.

### A tool that resolves a PR number cannot claim `readOnlyHint: true`

Resolving `pr` → pull id calls `GET /repos/:id/pulls`, and that route WRITES: with a GitHub
client configured it backfills diff stats for up to ten PRs and UPDATEs those rows
(`server/src/modules/pulls/routes.ts:95-116`). `get_findings` has carried
`annotations: { readOnlyHint: false }` for this reason since spec 06; `get_blast_radius` was
`true` only because the stub resolved nothing, and spec 07 step 13 flipped it when the tool
started calling `resolver.pullId`. The rule for any future tool: **`repo` alone is a read
(`GET /repos`), `repo` + `pr` is not.** The blast route itself is a pure read — the write is in
the resolution, which is exactly why it is easy to miss.

### The CLI cannot print on the server's stdout because printing is injected, not because the graphs are disjoint

`src/cli/run.ts` claimed until 2026-08-09 that it "shares NO import chain with `src/index.ts`".
It never did: `run.ts` imports `../project.js` and so does `index.ts:32`, `cli/schema.ts:12`
imports `../api/schemas.js`, and `cli.ts:16-17` imports `./api/client.js` and `./config.js` —
all on the MCP server's graph. What actually holds is narrower and stronger: every byte the
command emits leaves through `deps.out` / `deps.err`, and the package's only
`process.stdout.write` is `cli.ts:61`, which `index.ts` does not import. The practical
consequence the false version hid: a `console.log` added to a SHARED module — `project.ts`,
`api/schemas.ts`, `api/client.ts`, `config.ts` — still lands on the transport and kills the
session. After touching one of those, `grep -rn "process.stdout\|console\.log" src/` should
show exactly `cli.ts:40` and `cli.ts:61` plus doc comments.

### A spec that freezes strings needs a forward pointer when a later spec changes one

`AGENTS.md` §"The six description strings are fixed" says a wrong description is fixed "in the
spec first", naming `specs/06-mcp-server.md` §Appendix. Spec 07 step 13 then replaced
`get_blast_radius`'s description and its `readOnlyHint`, so 06's appendix and the shipped code
disagreed and the rule pointed at the wrong file — only the comment at `src/index.ts:40-44`
recorded it. Fixed 2026-08-09 by marking 06 superseded *in part* (status header, step 9, the
appendix entry, criteria 2a and 6) instead of editing the frozen string, because
`specs/README.md` forbids rewriting a shipped spec to match the implementation. When a later
spec changes one frozen string, annotate the earlier spec at every place a reader lands, not
just at the top.

### A projected field is named for what the model must DO with it, not for the column it came from

`link_sha` ships to a model as `lines_at_commit` (`src/project.ts`), the way `start_line` ships as
`line`, `rationale` as `why` and `suggestion` as `fix`. The contract name answers "which sha is
this"; the projected name answers "what are these line numbers valid at", which is the only
question a model has. Verified 2026-08-09 on `Holubinka/dev-digest` PR #12: `server/src/app.ts:81`
is `const reaped = await new ReviewService(container).reapStaleRuns();` at the indexed commit
`66727c85`, and a comment line in a later tree — the same reference, read against two commits, is
right once and wrong once.

The corollary for `note` text: caveats are **appended to an array**, never assigned, because a
`full` index with a stale commit and a `degraded` index with a stale commit are both real states.
A single `note` string built with `if/else` loses one of the two, and the case it loses is the live
one.

## Open questions

- **Will a `kind: 'summary'` review ever carry a `run_id`?** If multi-agent reduce starts
  writing summary rows against an `agent_runs` id, `get_findings` could select one and report a
  reduce as if it were a single agent's review. Nothing writes such a row today; the guard is
  the selection key, not a filter.
- **Should `get_blast_radius` also return `head_sha`, so a model can say HOW stale the index is?**
  It is omitted today: it is the PR's identity, which the caller already holds as `repo` + `pr`,
  and it is the one commit the reported lines are not valid at — returning it invites linking
  against it. The cost is that the model can say "these lines are from another commit" but not
  "the index is N commits behind", which is what a user would actually want to hear.
- **Does Claude Code ever open a stdio connection with `server/discover` rather than `initialize`?**
  The builder is in the 2.1.226 binary but was never observed on the wire, and SDK v1 answers it
  `-32601`. Re-probe with `scripts/discover-probe.mjs` if a Claude Code upgrade breaks this package.
