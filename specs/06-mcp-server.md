# 06 — Local MCP server: five tools over stdio

**Status:** Planned 2026-08-08
**Scope:** repo-wide (new package `mcp/`, plus `.mcp.json`, `scripts/dev.sh`, `AGENTS.md`, `README.md`, `TESTING.md`)
**Modules touched:** `mcp/` (new), repo root

**Superseded in part, 2026-08-09:** `get_blast_radius` is no longer a stub.
[`07-blast-radius.md`](07-blast-radius.md) step 13 replaced step 9 below, its appendix
string, and its `readOnlyHint`, and is the source of truth for that one tool — including
for `mcp/AGENTS.md` §"The six description strings are fixed", whose "fix it in the spec
first" now means spec 07 for this description and this file for the other five. Nothing
else here is out of date; the stub is left standing as the record of what 06 shipped.

## Problem

DevDigest can only be driven through its web UI. A coding agent working in this repository
cannot ask which reviewer agents exist, cannot run one on a PR, and cannot read the findings —
so the review loop stops at the browser. We add a **local-only MCP server over stdio** exposing
five tools, registered project-scope in a committed `.mcp.json`. It is another *client* of the
API at `localhost:3001`, exactly like `client/` is: it opens no database connection and adds no
second entrypoint inside `server/`. Four of the five tools are read-only; `run_agent_on_pr` is
the only one that writes, and it waits for the review to finish rather than handing back a job id.

## Out of scope

- **No HTTP/SSE MCP transport, no OAuth.** stdio only; per the spec, stdio implementations take
  credentials from the environment instead.
- **No blast-radius implementation.** `get_blast_radius` ships as a registered stub.
- **No client UI, no new Fastify route, no schema change, no migration.**
- **No new CI workflow.** A branch adding a file under `.github/workflows/**` cannot be pushed with
  any credential on this machine (`INSIGHTS.md` §"A push is rejected for the whole branch when a
  commit adds a workflow file"). `mcp.yml` is a separate change from a session with workflow scope.
- **No writes other than `POST /pulls/:id/review`.** `get_conventions` never calls
  `POST /repos/:id/conventions/extract` — that is a paid model call.
- **No sixth tool.** No `list_repos`, no `import_repo`, no `cancel_run`. A repo that was never
  imported is handled by error text, not by a tool.

## What already exists

Every route the five tools need is already live. Verified in this tree:

| Need | Route | Source |
|---|---|---|
| agent list (name, model, enabled) | `GET /agents` | `server/src/modules/agents/routes.ts:74` |
| `owner/name` → repo id | `GET /repos` → `Repo.full_name` | `repos/routes.ts:33`, `vendor/shared/contracts/platform.ts:144` |
| PR number → pull id | `GET /repos/:id/pulls` → `PrMeta.number`/`.id` | `pulls/routes.ts:30`, `platform.ts:178` |
| start a review | `POST /pulls/:id/review` `{agentId}` | `reviews/routes.ts:27` |
| run status / outcome | `GET /pulls/:id/runs` → `RunSummary[]` | `reviews/routes.ts:101`, `contracts/trace.ts:136` |
| findings | `GET /pulls/:id/reviews` → `ReviewDto[]` | `reviews/routes.ts:129`, `reviews/helpers.ts:22` |
| conventions | `GET /repos/:id/conventions` | `conventions/routes.ts:40`, `contracts/knowledge.ts:225` ⚠️ |
| error envelope `{error:{code,message,details}}` | error handler | `server/src/app.ts:126-170` |

⚠️ **RESOLVED 2026-08-08 — `feat/conventions-extractor` was merged into `feat/mcp-server`.** All
three cited anchors verified present after the merge. The paragraph below is kept because it is the
reason this branch carries commits that are not yet on `main`, and a reviewer will ask.

**The conventions row is not on `main`.** `server/src/modules/conventions/` and the
`ConventionCandidate`/`ConventionsResponse` contracts exist only on `feat/conventions-extractor`
(and on `feat/smart-diff-pr`, which contains it). Every other row in this table is on `main`. This
plan was written from a tree that had conventions checked out, and the field lists in steps 5 and 6
match that contract exactly — they are correct, but **`get_conventions` cannot be built or run on a
branch based on `main` alone**. Base the work on a branch that contains
`feat/conventions-extractor`, or move `get_conventions` to a follow-up; do not implement it against
`main` and discover the 404 at runtime.

Two facts that shape the design and are not visible in the route list: **`POST /pulls/:id/review`
is fire-and-forget** — it creates the `agent_runs` rows, returns `{runs:[…], reviews: []}`
immediately, and executes in the background (`reviews/service.ts:134-142`), so waiting is entirely
the caller's job; and **the SSE bus is in-memory and process-local**
(`server/src/platform/sse.ts:19-103`). Nothing MCP-shaped exists anywhere in the repo.

## Constraints

1. **`mcp/` uses npm, with `package-lock.json` committed.** `server/` and `client/` use pnpm;
   `reviewer-core/` and `e2e/` use npm (`AGENTS.md` §Stack; `INSIGHTS.md` §"Mixed package managers
   across packages"). `mcp/` is an auxiliary tool package like those two — and decisively, the root
   `README.md` lists pnpm as a *separately installed* prerequisite while npm ships with Node, and
   `.mcp.json` must work on a clean clone.
2. **Nothing but JSON-RPC frames may reach stdout.** Logs, warnings and stack traces go to stderr.
   This rules out `npm run …` as the `.mcp.json` command — npm prints its script banner to stdout.
3. **No Drizzle, no `postgres` dependency, no import from `server/src/**`.** The one external
   dependency is the HTTP API and it goes behind a single client module — `onion-architecture` §3.4:
   every external call goes behind a port, and a port is not finished until there is a fake for it
   (here, a stubbed `fetch`).
4. **No third vendored copy of `@devdigest/shared`.** The `shared-sync` gate is literally
   `diff -r server/src/vendor/shared client/src/vendor/shared` (`gates.md` §repo·vendor); a third
   copy would be the only one no gate compares. See Alternatives rejected.
5. **Parse at the edge, once, with `safeParse`** (`zod` §`parse-use-safeparse`,
   §`parse-never-trust-json`). Every API response is validated by a narrow local schema before
   projection; a failure becomes an actionable tool error, never a crash or a wrong answer.
6. **Do not add or change a server route.** Every resolution below composes existing ones. If a step
   genuinely cannot, stop and ask — a new route is a different change.
7. **No secret, and no new env var carrying one** (root `AGENTS.md`). The local API runs
   `LocalNoAuthProvider` and takes no credential. `DEVDIGEST_API_URL` defaults to
   `http://localhost:3001` and is rejected unless it is a loopback `http(s)` URL — the API has no
   auth, so a remote value is an exfiltration path with no compensating control.
8. **`e2e/specs/*.flow.json` is untouched.** MCP has no browser surface (root `AGENTS.md`).

## Skills the implementer must invoke

| Step | Skill | Why |
|---|---|---|
| 2, 3 | `security` | stdio credential rule, env validation, argument validation, the loopback constraint |
| 3, 5, 6–9 | `zod` | tool input schemas, narrow response schemas, `safeParse` over `parse`, `z.infer` for the projection types |
| 2, 3 | `onion-architecture` | why `mcp/` holds no Drizzle, and the port + fake shape for the HTTP client (§3.4, §3.8) |
| any step that turns out to need a server route | `fastify-best-practices` | only if Constraint 6 is escalated and the answer is yes |

Invoke each one before writing the step it governs, not after.

## Steps

### 1 — Spike: settle the SDK line and the launch command (do this first)

npm `latest` today is `@modelcontextprotocol/sdk@1.30.0` (v1, legacy protocol) and
`@modelcontextprotocol/{server,client,core}@2.0.0` (v2). The spec had a breaking revision on
2026-07-28 and **Claude Code's own MCP documentation never mentions it**, so which line this
client speaks is unverified. Nothing else may be built until it is.

Files: `mcp/spike/` (throwaway, deleted at the end of this step), root `.mcp.json`.

Build one server exposing a single `ping` tool, on **both** SDK lines. For each: connect MCP
Inspector, then a real Claude Code session through `.mcp.json`, call `ping`, and send one progress
notification during a 5-second call. Settle three things at once: which SDK line Claude Code connects
to without warnings; the exact `.mcp.json` `command`/`args` that work from a clean clone under
Constraint 2; and whether the server process's cwd is the project root (which decides whether
relative paths in `args` are usable). **If the spike is inconclusive,** take SDK v1
(`@modelcontextprotocol/sdk@1.30.0`), the line the published Claude Code docs describe, and record
that it was a fallback rather than a finding.

**Check:** `/mcp` lists `devdigest` as connected, `ping` returns, and the progress notification
arrives. Write the answer and the rejected line into `mcp/README.md`; if it cost time, run the
`engineering-insights` skill into `mcp/INSIGHTS.md`. Delete `mcp/spike/`.

---

**SETTLED 2026-08-08 — do not re-litigate.** Both lines were built, run over stdio on Node
v22.23.1, and driven with a raw JSON-RPC script; both passed identically (5/5 progress frames, clean
stdout, `initialize` negotiated at `2025-11-25`). The tie was broken by three findings, so this is a
**finding, not the documented fallback**:

1. **v2 requires Zod 4; this repo is Zod 3.** `registerTool` in v2 accepts only a schema exposing
   `~standard.jsonSchema`. Adopting v2 means a second major of Zod alongside `server/`, `client/`
   and `reviewer-core/`.
2. **A v1-SDK server is connected to this Claude Code build right now.** `chrome-devtools-mcp@1.6.0`
   bundles `@modelcontextprotocol/sdk` 1.29.0 and `claude mcp list` reports it Connected. This is
   stronger than a spike connection — it is a production server on the v1 line against the client we
   ship for.
3. **Claude Code 2.1.226 negotiates `2025-11-25`,** which v1 serves.

**Decision: SDK v1, `@modelcontextprotocol/sdk@1.30.0`.**

`.mcp.json` (Constraint 2 verified empirically — 0 non-JSON stdout lines; `npm run …` fails it twice
over, on the banner *and* on `--prefix` chdir):

```json
{
  "mcpServers": {
    "devdigest": {
      "command": "node",
      "args": ["mcp/dist/index.js"],
      "env": {
        "DEVDIGEST_API_URL": "http://localhost:3001",
        "DEVDIGEST_MCP_RUN_TIMEOUT_MS": "120000"
      }
    }
  }
}
```

The server's cwd **is** the project root — verified with `lsof -a -d cwd` on five live MCP processes
across two projects — so the relative path in `args` is safe.

`mcp/spike/` is deleted. Its two reusable diagnostics were kept as `mcp/scripts/driver.mjs` (raw
stdio driver; Inspector CLI receives progress frames but never renders them, so a client UI cannot
prove progress works) and `mcp/scripts/discover-probe.mjs` (probes `server/discover`, the only place
v2 reveals 2026-07-28). Findings recorded in `mcp/INSIGHTS.md`, including the one risk this decision
carries: if a future Claude Code opens with `server/discover` instead of `initialize`, v1 answers
`-32601` and this package strands.

### 2 — Scaffold `mcp/`

Creates: `mcp/package.json`, `mcp/tsconfig.json`, `mcp/vitest.config.ts`, `mcp/src/index.ts`,
`mcp/src/config.ts`, `mcp/README.md`, `mcp/AGENTS.md`, `mcp/CLAUDE.md` (a **symlink** to
`AGENTS.md` — root `AGENTS.md` §Do not touch), `mcp/INSIGHTS.md`.
Changes: root `.mcp.json`, `scripts/dev.sh`, root `AGENTS.md` (Stack table row), root `README.md`
(the package table at lines 14-18 **and** the setup section — it is a separate table from the one in
`AGENTS.md` and is the first thing a new student reads), `TESTING.md` (Suite map row).

No `mcp/.gitignore` is needed: the root `.gitignore` already ignores `dist/` and `node_modules/`
repo-wide (lines 1-2), with an explicit un-ignore only for `agent-runner/dist/`.

`package.json` scripts: `typecheck` (`tsc --noEmit`), `build` (`tsc -p tsconfig.json` → `dist/`),
`test` (`vitest run`). `mcp/` **does** emit JS, unlike `reviewer-core` — it is an executable launched
by another process, not a library imported as source, and a compiled entry removes any dependence on
PATH or a loader flag at launch. `dist/` stays git-ignored. `scripts/dev.sh` borrows half its shape from `reviewer-core` at line 80 —
`npm ci` when `node_modules` is absent — and adds a step that line does **not** have: `npm run build`.
`reviewer-core` never builds because the API imports its raw source through a tsconfig alias; `mcp/`
is launched as a process by another program, so it must produce `dist/` before `.mcp.json` can point
at it. Do not copy line 80 verbatim expecting it to be enough.

`src/index.ts` holds the transport, the five registrations, and the server `instructions` string.
`instructions` and every tool `description` are truncated by the client at **2KB each** — put the
load-bearing sentence first. Claude Code defers tool definitions by default (only names and
`instructions` load at session start), so the token levers are `instructions`, the tool *names* and
result size, not schema minimalism.

**Do not author the descriptions.** All six strings — the server `instructions` and one `description`
per tool — are fixed in [the appendix](#appendix--server-instructions-and-tool-descriptions) and are
copied from there character for character. Set `readOnlyHint: true` on `list_agents`, `get_conventions` and `get_blast_radius`, and `false` on
`run_agent_on_pr`: cheap and correct, but the spec says clients MUST treat annotations as untrusted,
so **build no behaviour on them**. (`get_blast_radius` flipped to `false` with
[`07-blast-radius.md`](07-blast-radius.md) step 13, once it started resolving `pr` → pull id.)

`get_findings` is the awkward one and gets `readOnlyHint: false`. It reads only, but resolving
`pr` → pull id calls `GET /repos/:id/pulls`, which **writes**: when a GitHub client is configured it
backfills diff stats for up to ten PRs per call and `UPDATE`s those rows
(`pulls/routes.ts:95-116`). The write is bounded and self-extinguishing — it fires only for rows
whose `additions`/`deletions`/`files_count` are all still zero, so it is a one-time cost per PR and a
no-op afterwards — but "reads only" would be a false claim, and the 5-minute resolver cache
(step 3) exists partly to keep it rare.

**Check:** `cd mcp && npm run typecheck && npm run build`, then `/mcp` lists five tool names.

### 3 — HTTP client, response schemas, resolvers

Creates: `mcp/src/api/client.ts`, `mcp/src/api/schemas.ts`, `mcp/src/api/resolve.ts`.

`client.ts` — one `request()` over an injectable `fetch`, with a per-request timeout (default 15s), a
base URL from `config.ts`, and decoding of the `{error:{code,message,details}}` envelope
(`server/src/app.ts:126-170`) into a typed failure. `schemas.ts` — a narrow Zod object per response,
naming only the fields the tools project; never `Review.parse()` or `Agent.parse()` on a whole
payload (Constraints 4 and 5).

`resolve.ts` — three resolvers. `repoId(full_name)` via `GET /repos`, case-insensitive match on
`full_name`, cached for the process lifetime (repo ids do not change). `pullId(full_name, number)`
via `GET /repos/:id/pulls`, matched on `number`, guarding `PrMeta.id` being `nullish`, cached with a
5-minute TTL — that route syncs from GitHub and backfills up to ten PR details per call
(`pulls/routes.ts:89-116`), so it is the expensive one and must never run per poll.
`agentId(name)` via `GET /agents`, case-insensitive exact match, ambiguity an error listing the
candidates.

No user string is concatenated into a URL path — `repo` and `agent` are matched against API output,
and only server-issued UUIDs reach a path segment. Validate them anyway: `repo` as
`^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$`, `pr` as a positive integer.

### 4 — Errors that move the agent forward

Creates: `mcp/src/errors.ts`.

Every failure becomes `isError: true` with text naming the next step — per the MCP spec, execution
errors belong in the result rather than in a protocol error, so the model can self-correct.

| Failure | Text |
|---|---|
| repo not imported | `Repo "x/y" is not imported into DevDigest. Imported repos: <up to 20 full_names>. Ask the user to add it in the DevDigest UI — this server cannot import repos.` |
| PR number unknown | `PR #N not found in x/y. Known PR numbers: <up to 20>. If the PR is new, open the repo in DevDigest to sync it.` |
| agent name unknown | `Agent "z" not found. Call list_agents for the valid names.` |
| API unreachable | `Cannot reach the DevDigest API at <url>. Start it with ./scripts/dev.sh (API on :3001), then retry.` |
| response failed `safeParse` | `The DevDigest API returned a shape this MCP server does not recognise (<path>). The API contract moved; mcp/ needs updating. Do not retry.` |
| run failed / cancelled | the run's `error` field verbatim, plus `Check the run trace in the DevDigest UI.` |

There is no `list_repos` tool, so the first two rows are the *only* thing carrying the user forward —
they must enumerate what exists, not merely say "not found".

### 5 — Compact projections

Creates: `mcp/src/project.ts`.

- **Findings** (`ReviewDto.findings` → MCP): keep `severity`, `category`, `title`, `file`,
  `line` (= `start_line`; add `end_line` only when it differs), `confidence` (2 dp), `why`
  (= `rationale`, capped 500 chars), `fix` (= `suggestion`, capped 500 chars, omitted when null).
  **Drop** `id`, `review_id`, `accepted_at`, `dismissed_at`, `kind`, `trifecta_components`,
  `evidence` — no tool consumes them, and they are UUIDs or nested objects (principle 2).
- **Agents:** keep `name`, `description` (capped 200), `model`, `enabled`. **Drop `system_prompt`** —
  the largest field on `Agent`, thousands of tokens each.
- **Conventions:** keep `category`, `rule`, `evidence` as `"path:line"`, `confidence`. Drop
  `extra_evidence`, `evidence_snippet`, `id`, `repo_id`, `scan_id`, `head_sha`, `created_at`.
- **Truncation is grapheme-safe** — `String.slice` corrupts astral characters (`server/INSIGHTS.md`
  §"Truncating text for an API response with `String.slice` corrupts emoji").
- **Ordering:** CRITICAL → WARNING → SUGGESTION, then `confidence` descending, then `file`, then
  `start_line`, then **`title`**. Fully deterministic, pinned by a test (see Risks). The fifth key
  was added during implementation and **is accepted**: with only four, the order is not in fact
  total — the source query has no `ORDER BY`, equal `confidence` is common, and the `id` that the
  server's own ranker uses to break ties is dropped by this projection. Without `title` the
  ordering test is flaky rather than pinning anything.
- **Limits:** default 20 findings, `limit` capped at 100; when trimmed, add
  `"note": "showing 20 of 47 — call get_findings with severity=\"CRITICAL\" or a higher limit"`.
  Budget a normal response under ~4,000 tokens (`MAX_MCP_OUTPUT_TOKENS` defaults to 25,000, with a
  fixed warning at 10,000). **Do not set `_meta["anthropic/maxResultSizeChars"]`** — a tool needing
  the ceiling raised has a projection problem.

### 6 — `list_agents` and `get_conventions`

Changes: `mcp/src/tools/list-agents.ts`, `mcp/src/tools/get-conventions.ts`, `src/index.ts`.

`list_agents()` — no arguments. `GET /agents` → the agent projection, all agents, `enabled` shown
rather than filtered (a disabled agent explains a later failure). This is where the model gets a
valid agent name; say exactly that in the description's first sentence.

`get_conventions(repo, status?, limit?)` — `status` defaults to `"accepted"`, `limit` to 50.
`GET /repos/:id/conventions` → the conventions projection, plus `scan.created_at` and `scan.model` as
a one-line provenance field. When `accepted` yields zero rows but pending ones exist, return
`{conventions: [], note: "No accepted conventions for x/y. N candidates are pending — call
get_conventions with status=\"pending\", or accept them in the DevDigest UI."}` — principle 4 applied
to an empty result, not only to an error.

**Check:** both against a running seeded API; `list_agents` returns the two built-in agents.

### 7 — `get_findings`

Changes: `mcp/src/tools/get-findings.ts`, `src/index.ts`.

`get_findings(repo, pr, agent?, run_id?, severity?, limit?)` — all scalars. `repo` + `pr` are
required and human; `run_id` is **optional** and, when given, selects exactly that run — it is what
`run_agent_on_pr` hands back on the ceiling path, so the follow-up call is exact rather than a guess.
Without `run_id`: the newest completed run for that PR, narrowed by `agent` when given, tie-broken by
`ran_at` descending. That resolves the tension in principle 2 without ever *requiring* a UUID in the
tool surface.

Implementation: `GET /pulls/:id/reviews`, select the matching `ReviewDto`, project. Response:
`{repo, pr, agent, run_id, status, verdict, score, summary (capped 600),
counts:{critical, warning, suggestion}, findings:[…], note?}`.

**A run that has not finished is not an error.** When `run_id` names a run whose status is still
`queued`/`running` — the normal continuation of the step-8 ceiling path — return `isError: false`
and a structured in-progress result, so the model waits instead of re-running the review:

```json
{"status":"running","run_id":"…","repo":"x/y","pr":105,"agent":"…","elapsed_s":145,
 "next_step":"Still running. Call get_findings with the same run_id in about a minute. Do not call run_agent_on_pr again — that would start a second run and bill a second time."}
```

The explicit "do not call `run_agent_on_pr` again" matters: `run_agent_on_pr` is the only writing
tool, a second run costs a second provider call, and an agent that reads "no findings yet" without
that sentence is one step away from starting one. When `run_id` is absent and *no* completed run
exists but one is in flight, return the same shape with the in-flight `run_id` filled in.

### 8 — `run_agent_on_pr`

Changes: `mcp/src/tools/run-agent.ts`, `mcp/src/wait.ts`, `src/index.ts`.

`run_agent_on_pr(repo, pr, agent)`. The only writing tool.

1. Resolve `repo`+`pr` → pull id and `agent` → agent id (step 3).
2. `POST /pulls/:id/review` with `{agentId}`. **Never `{all: true}`** — fanning out to every enabled
   agent multiplies the LLM bill without being asked. Take `runs[0].run_id`.
3. Poll **`GET /pulls/:id/runs`** — 2s for the first 30s, then 5s. Match on `run_id`; finish on
   `status` ∈ {`done`, `failed`, `cancelled`}.
4. On `done`, hand the run id to the step-7 projection and return the same compact shape.

**Why polling and not the SSE stream** (`GET /runs/:id/events`): `/pulls/:id/runs` returns
`RunSummary` with `status`, `error`, `score` and `findings_count` from the database — the durable
source of truth — while `/pulls/:id/runs/active` returns only `running` rows, so a finished run falls
out with no way to tell done from failed. The SSE bus is in-memory and process-local
(`platform/sse.ts:19-103`): restart the API mid-run and `onDone` never fires for that run id, so the
stream hangs until our own ceiling, whereas a poll sees the boot reaper flip the row to `failed`.
Consuming SSE in Node also carries a known trap — `break` out of a `for await` destroys the stream
(`server/INSIGHTS.md`). We give up the per-step log lines; progress carries elapsed time and status
instead. Load: 5s polling for 10 minutes is ~12 requests/minute against a 120/minute global limit
(`server/src/app.ts:106`).

**Progress:** send `notifications/progress` only when the client supplied a `progressToken` in
`_meta`; on every status change and **at least once every 20 seconds** — the stdio idle timeout is
30 minutes and aborts a call that sends neither a response nor a progress notification.

**Soft ceiling:** `DEVDIGEST_MCP_RUN_TIMEOUT_MS`, default `120000` (120 s), read from `.mcp.json`
`env`. Progress prevents the *idle* abort but **not** the per-server `timeout`, which is a hard
wall-clock limit per tool call — so the ceiling exists and must sit below any `timeout` configured in
`.mcp.json`.

The 120 s default is measured, not guessed. Over the 242 completed runs in the local development
database (`agent_runs`, `status='done'`, `duration_ms` not null):

| n | min | p50 | p90 | p95 | max |
|---|---|---|---|---|---|
| 242 | 1.6 s | 30.5 s | 151.0 s | 238.2 s | 1425.2 s |

Bucketed against the ceiling: 158 runs under 60 s, 44 between 60 and 120 s, 40 over 120 s. So **~83%
of runs return findings from the first call** and the `still_running` path is the exception. The
`max` of ~24 minutes is why an unbounded wait was rejected: it would sit just under the 30-minute
stdio idle timeout with nothing to show.

120 s is also exactly Claude Code's automatic-backgrounding threshold, so in practice this tool
returns at the moment the call would otherwise have moved to a background task — the session is
never blocked for longer than that, and the tool never becomes a background task. Treat the two
values as coupled: if `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` is raised, this ceiling may be raised with
it. Re-measure with the query above before changing the default.

On exceeding the ceiling, **do not cancel the run** and **do not return `isError`**; return:

```json
{"status":"still_running","run_id":"…","repo":"x/y","pr":105,"agent":"…","elapsed_s":600,
 "next_step":"The review is still running. Call get_findings with run_id=\"…\" in a minute."}
```

The follow-up `get_findings(run_id=…)` may land while that run is *still* running — at a 120 s
ceiling that is the common case for the ~17% that overflow, not a rare one. Step 7 handles it as a
structured in-progress result, not an error.

### 9 — `get_blast_radius` stub

**Superseded by [`07-blast-radius.md`](07-blast-radius.md) step 13 (2026-08-09).** The tool
now resolves `pr` → pull id, reads `GET /pulls/:id/blast` and projects the result; it
carries `readOnlyHint: false` for the same resolver reason `get_findings` does. What
follows is what 06 shipped, kept as the record.

Changes: `mcp/src/tools/blast-radius.ts`, `src/index.ts`.

`get_blast_radius(repo, pr)`. Registered, validates its arguments, resolves nothing, calls no API.
Its description **opens** with `PLACEHOLDER — not implemented.` (first bytes survive the 2KB cut) and
it returns, with `isError` **false** so the model does not retry:

```json
{"status":"not_implemented","tool":"get_blast_radius",
 "message":"Blast radius is not implemented yet. Do not retry — no arguments will make it work. Use get_findings for what is available today.",
 "planned":["changed symbols","reverse dependents","risk score"]}
```

### 10 — Tests, docs, registry rows

Creates: `mcp/test/*.test.ts`, `mcp/scripts/smoke.ts`. Changes: `mcp/README.md`, root `AGENTS.md`
(Stack table), `TESTING.md` (Suite map), `specs/README.md` status row. Run the
`engineering-insights` skill into `mcp/INSIGHTS.md` before reporting the work complete.

## Appendix — server instructions and tool descriptions

**These six strings are final. Copy them into `mcp/src/index.ts` character for character — do not
paraphrase, re-order, shorten, or "improve" them.** They are a contract, not a starting point: the
server `instructions` is one of only two things loaded at session start, each string is cut at 2KB
with the first bytes surviving, and every sentence in them was placed against a specific rule (the
result-not-operation phrasing, the by-example argument formats, the two cost warnings, the measured
30-second median, the three distinct dead-end recoveries). Re-wording one silently drops whichever
rule it was carrying.

If a string turns out to be wrong during implementation, change it **here first** and say so — do
not fix it only in the code, or the plan stops describing what shipped.

**Server `instructions`** — written like a skill description, because that is how Claude Code uses
it: to decide whether to search this server at all.

```
DevDigest runs local-first AI code review on pull requests imported into this workspace. Search
these tools when the user asks to review a pull request, to see what a reviewer agent found, to
check which review agents are configured, or to look up a repository's extracted coding conventions.

Identify a pull request by repository slug and number — "acme/payments-api" and 482 — never by an
internal id. Agents are identified by name; list_agents is the source of valid names.

run_agent_on_pr is the only tool here that writes or costs money: it starts a real review with a
real model call. Never call it to check or refresh something. Everything else is a read.

These tools need the DevDigest API running on localhost:3001. If one reports it unreachable, tell
the user to run ./scripts/dev.sh.
```

**`list_agents`**

```
List the reviewer agents configured in DevDigest, with the exact name that run_agent_on_pr and
get_findings expect. Call this first whenever you need an agent name and do not already have one
from this conversation — names are free text chosen by the user, so guessing one wastes a round
trip. Returns each agent's name, model, one-line description, and whether it is enabled; a disabled
agent is still listed, because "disabled" is usually the explanation for a review that will not
start. Takes no arguments and costs nothing.
```

**`run_agent_on_pr`**

```
Run a DevDigest review agent on a pull request and return the finished findings. This does the whole
job in one call — starts the run, waits for it, and returns the verdict with findings attached — so
do not follow it with a separate step to fetch results. It is the only tool here that writes: it
makes a real model call and costs real money, so call it when the user asks for a review, never to
poll or refresh. Arguments are plain values: repo as "owner/name", pr as the GitHub pull request
number, agent as a name from list_agents. Reviews take about 30 seconds at the median; if one is
still going after 120 seconds this returns status "still_running" with a run_id — call get_findings
with that run_id rather than calling this tool again, which would start a second billed run.
```

**`get_findings`**

```
Get the verdict and findings from a review that has already run, without starting a new one. Use it
to read results after run_agent_on_pr returned "still_running", to look at an earlier review, or
when the user asks what an agent found without asking to run one. Identify the pull request by repo
"owner/name" and pr number; optionally narrow by agent name, or pass the exact run_id you were
given. Returns the verdict, score, severity counts and up to 20 findings sorted most severe first —
pass a higher limit or a severity filter for more. If the run is still in progress this returns
status "running" rather than an error; wait and call again with the same run_id.
```

**`get_conventions`**

```
Get the coding conventions DevDigest extracted for a repository — the house rules a reviewer should
apply, each with the file and line that evidences it. Use it before writing or reviewing code in an
imported repository, or when the user asks what conventions this project follows. Takes repo as
"owner/name"; returns accepted conventions by default, and status "pending" shows candidates nobody
has confirmed yet. This reads stored results and costs nothing — it never triggers a new extraction
scan, which is a paid model call the user starts from the DevDigest UI.
```

**`get_blast_radius`** — **no longer the shipped string.**
[`07-blast-radius.md`](07-blast-radius.md) step 13 replaced it and is what
`mcp/src/index.ts` must be diffed against for this one description; the five above are
still frozen here.

```
PLACEHOLDER — not implemented, returns nothing useful. It is registered so the tool list matches the
planned surface; blast radius — which symbols a pull request changes, what depends on them, and the
resulting risk score — is a later exercise. Calling it always returns status "not_implemented"
whatever the arguments, so there is nothing to retry and no argument that will make it work. For
what exists today, use get_findings.
```

**No namespace prefix on the names.** Claude Code already exposes these as
`mcp__devdigest__<tool>`, so the server name is the namespace; prefixing again would spend the one
budget that is always in context — tool names — on a repeated word.

## Tests

**Hermetic unit — `cd mcp && npm test` (vitest, stubbed `fetch`; no API, no Docker, no key):**

- `project.test.ts` — the three projections, every dropped field asserted absent, the finding
  ordering pinned, and a truncation whose cap lands **mid-surrogate-pair** (a cap landing on a BMP
  character proves nothing — `INSIGHTS.md` §"An astral-character truncation test proves nothing
  unless the cap lands mid-pair").
- `resolve.test.ts` — repo hit, repo miss, PR miss, ambiguous agent name, `PrMeta.id` null.
- `errors.test.ts` — each row of the step-4 table yields `isError: true` and text naming a next step.
- `wait.test.ts` — fake timers: status transition; ceiling exceeded at the 120 s default → the
  `still_running` shape with `isError` false; progress at least every 20s; no progress without a
  `progressToken`.
- `get-findings.test.ts` — the step-8 handoff end to end against a stubbed `fetch`: a `run_id` whose
  run is still `running` yields `isError: false`, `status: "running"`, and a `next_step` that names
  `get_findings` and warns off `run_agent_on_pr`; the same `run_id` once `done` yields the projection.
- `blast-radius.test.ts` — `isError` false, payload says `not_implemented`.

Prove each new test fails before leaving it green (root `AGENTS.md`).

**Needs the API running — `mcp/scripts/smoke.ts`, manual, in no suite:** `list_agents`,
`get_conventions`, `get_findings` against `localhost:3001` on seeded data. Read-only, no LLM cost.

**`run_agent_on_pr` end to end is manual, local, and run once.** It spends real money: a review
makes live provider calls unless the container's LLM is overridden, which an out-of-process HTTP
client cannot do (`server/INSIGHTS.md` §"An integration test that starts a review makes LIVE
OpenRouter calls unless `secrets` is overridden"). Never in CI, never in a vitest file.

**Nothing goes in `e2e/`** — that suite is agent-browser flows over the web UI, and MCP has no
browser surface. **No `*.it.test.ts`** — `mcp/` has no database.

## Gates

Track A, verbatim from `.claude/skills/pr-self-review/gates.md`. Only the `repo` gates apply,
because `mcp/` touches no gated package:

```sh
diff -r server/src/vendor/shared client/src/vendor/shared
bash scripts/pr-self-review/registry.sh
```

`scope.sh` maps only `client/*`, `server/*` and `reviewer-core/*` into `.packages`
(`scripts/pr-self-review/scope.sh:210-212`), so **`mcp/` gets no Track A gate at all** — the position
`e2e/` has always been in. Deliberate here: teaching `scope.sh` and `gates.sh` a fourth package means
editing the pre-push gate's own scripts, which have their own Bash suite
(`scripts/pr-self-review/test/run.sh`) — a separate change with its own risk. Instead run
`cd mcp && npm run typecheck && npm test` by hand before the push and paste the result into the PR
body. If the branch also touches `server/` or `client/`, their gates apply as written in `gates.md`.

## Risks (from INSIGHTS.md)

- **The SDK line is unverified.** Claude Code's MCP docs never mention the 2026-07-28 spec revision,
  and the v2 migration guide only *claims* one handler serves both eras. Step 1 settles it first —
  the repo's own rule is "prove a new CI rule can fail before trusting it to pass" (`INSIGHTS.md`).
- **A third findings ranker.** `INSIGHTS.md` §"The two findings rankers must sort identically, and
  nothing checks that they do" — step 5 adds a third. It does not claim to match the other two; its
  order is documented in `mcp/README.md` and pinned by a test, so drift stays visible.
- **Truncation corrupts astral characters.** `server/INSIGHTS.md` §"Truncating text for an API
  response with `String.slice` corrupts emoji" — step 5 truncates four fields; mitigated by the
  grapheme-safe helper and the mid-pair test.
- **A live review costs real money.** `server/INSIGHTS.md` §"An integration test that starts a review
  makes LIVE OpenRouter calls…" — mitigated by keeping `run_agent_on_pr` out of every suite.
- **Mixed package managers.** `INSIGHTS.md` §"Mixed package managers across packages" —
  `pnpm install` in `mcp/` produces an untracked lockfile. Constraint 1 pins npm.
- **A workflow file blocks the whole push.** `INSIGHTS.md` §"A push is rejected for the whole branch
  when a commit adds a workflow file" — hence no `mcp.yml` here.

## Alternatives rejected

- **A second entrypoint inside `server/`, on Drizzle directly.** No HTTP hop, but it duplicates every
  service the routes compose, bypasses the workspace resolution in `modules/_shared/context.ts`, and
  gives `server/` a second process shape to keep alive.
- **A third vendored `@devdigest/shared`.** The `shared-sync` gate compares exactly two paths, so the
  third copy would be the only unguarded one — worse than the drift the gate exists to catch.
- **A tsconfig `paths` alias from `mcp/` to `server/src/vendor/shared`,** the trick `reviewer-core`
  uses. Zero copies and exact types, and genuinely tempting. Rejected because the MCP surface is a
  *projection*, not the contract — the tools drop most of `Finding` and all of `Agent.system_prompt`,
  and having the full contract in scope invites returning it whole, which is what the 25k output
  limit punishes. The compensating control is Constraint 5: `safeParse` against narrow local schemas
  turns a moved contract into a loud, self-describing tool error rather than a silently wrong answer.
- **Consuming SSE instead of polling.** Richer progress text, but the bus is process-local and an API
  restart leaves the stream hanging — see step 8.
- **Returning a bare `run_id` from `run_agent_on_pr`.** Violates principle 1: the model would have to
  sequence create → wait → collect itself, three round trips and three chances to stall.
- **`isError: true` on the blast-radius stub.** An error invites a retry with different arguments; no
  arguments will ever work. A structured `not_implemented` result says so once.

## Acceptance criteria

1. `cd mcp && npm ci && npm run typecheck && npm test && npm run build` all pass.
2. `/mcp` lists `devdigest` with exactly five tools; no stdout noise breaks the session.
2a. The server `instructions` and all five tool `description` strings in `mcp/src/index.ts` match the
   appendix character for character. Diff them before opening the PR; a paraphrase is a failed
   criterion, not a style preference. (Since 2026-08-09, `get_blast_radius`'s string is diffed
   against [`07-blast-radius.md`](07-blast-radius.md) step 13 instead.)
3. `list_agents` returns the seeded agents with `system_prompt` absent from the payload.
4. `get_conventions` on a repo with no accepted conventions returns the pending-count note, not an error.
5. `get_findings` on a reviewed PR returns the step-5 shape, under ~4,000 tokens, with no UUID other
   than `run_id`.
6. `get_blast_radius` returns `not_implemented` with `isError` false. (Met by 06; superseded — see
   step 9.)
6a. `run_agent_on_pr` on a review that outruns 120 s returns `still_running` with a `run_id`, the run
   keeps going, and `get_findings` with that `run_id` returns `status: "running"` first and the
   findings once it lands — no second run started at any point.
7. An un-imported repo returns text naming the repos that *were* imported; an unknown agent name
   returns text naming `list_agents`.
8. **End to end, once, by hand:** from a cold clone — `./scripts/dev.sh`, then in a Claude Code
   session ask it to review a seeded PR with a named agent. `run_agent_on_pr` blocks, emits progress,
   and returns finished findings matching what the DevDigest UI shows for that run.

## Open questions

_None._ Step 1 turns the one unresolved external fact — which SDK line Claude Code speaks — into an
empirical check with a recorded default, rather than a question answered on paper.
