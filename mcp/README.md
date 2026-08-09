# `@devdigest/mcp` — the review loop over stdio

An MCP server that hands DevDigest's review loop to a coding agent, plus the `devdigest`
CLI that reviews an uncommitted working tree from a terminal. Both are **HTTP clients of
the API on `:3001`**, exactly the way `client/` is: no database connection, no Drizzle, no
import from `server/src/**`, no second entrypoint inside `server/`. Local only — stdio
transport, no HTTP/SSE, no OAuth.

Registered project-scope in the repo-root [`.mcp.json`](../.mcp.json), so a Claude Code
session opened in this repository picks it up with no per-machine setup.

## Running it

```sh
cd mcp
npm ci          # npm, not pnpm — see ../AGENTS.md §Stack
npm run build   # tsc → dist/; .mcp.json launches `node mcp/dist/index.js`
```

**`./scripts/dev.sh` deliberately does not do this.** That script bootstraps the
application — Postgres, the API, the web app — and this package is a developer tool none
of them import, so it is built by hand when you want it. `dev.sh` is still what starts the
API the tools talk to.

Nothing builds this package for you: `dist/` is git-ignored (root `.gitignore` line 2), it
is **not** rebuilt on launch, and a `dist/` left over from an older `src/` is served
silently. That is the usual reason an edit does not show up in a session.

Two environment variables, both set in `.mcp.json`, neither of which may ever carry a
secret (root `AGENTS.md` §Non-default conventions — secrets go through the server's
`SecretsProvider`, never through an env var here):

| Variable | Default | Notes |
|---|---|---|
| `DEVDIGEST_API_URL` | `http://localhost:3001` | Rejected unless it is a loopback `http(s)` URL carrying no credentials (`src/config.ts`). The API runs `LocalNoAuthProvider` and authenticates nobody, so a remote value is an exfiltration path for this workspace's code-review data with no compensating control. |
| `DEVDIGEST_MCP_RUN_TIMEOUT_MS` | `120000` | How long `run_agent_on_pr` waits before handing back `still_running` with a `run_id`. |

## The five tools

| Tool | For | Writes? |
|---|---|---|
| `list_agents` | The reviewer agents configured in DevDigest and their exact names — the source of a valid `agent` argument for the two tools below. Disabled agents are listed rather than filtered, because "disabled" is usually the explanation for a review that will not start. | no |
| `run_agent_on_pr` | Run one agent on one PR and return the **finished** findings in a single call — start, wait, project. | **yes, and it costs money** |
| `get_findings` | Read the verdict and findings of a review that already ran: after a `still_running`, for an earlier run, or when nobody asked for a new one. | no in spirit — see below |
| `get_conventions` | The coding conventions DevDigest extracted for a repo, each with the file and line evidencing it. Reads stored rows only; it never triggers an extraction scan, which is a paid model call the user starts from the UI. | no |
| `get_blast_radius` | What a pull request could break: the symbols it changes, their callers as `file:line`, and the HTTP endpoints and crons downstream. One read of `GET /pulls/:id/blast`, answered from the stored code index — no model call, no re-index (spec 07 step 13). Every `file:line` comes with `lines_at_commit`, the commit those lines were recorded at — see below. When the index is not `full` the result carries a `note`, so a short list never reads as "nothing depends on this". | no in spirit — see below |

A pull request is always identified as `repo` (`"owner/name"`) plus `pr` (the GitHub
number) — never an internal id. The one UUID in the surface is `run_id`, and only
because `run_agent_on_pr` hands it back so the follow-up read is exact.

**`run_agent_on_pr` is the only writing tool.** It makes a real model call. Everything
else is a read, and no tool starts a review as a side effect. When a run outruns the
ceiling the tool returns `still_running` with a `run_id` and leaves the run going; the
correct follow-up is `get_findings` with that id, never a second `run_agent_on_pr` —
that would start a second billed run.

`get_findings` and `get_blast_radius` carry `readOnlyHint: false` even though both read.
Resolving `pr` → pull id goes through `GET /repos/:id/pulls`, which backfills diff stats
for up to ten PRs per call and `UPDATE`s those rows when a GitHub client is configured
(`server/src/modules/pulls/routes.ts:95-116`). The write is bounded and
self-extinguishing — it fires only for rows whose counts are all still zero — but
"reads only" would be a false claim. The resolver cache exists partly to keep it rare.
Per the MCP spec a client MUST treat these annotations as untrusted, so nothing here
builds behaviour on them.

## A `file:line` belongs to a commit, and `get_blast_radius` says which

The index is built at one commit; a pull request head moves on. So every `line` in a blast
result — each symbol's `at`, each caller — was recorded by the indexer against
`link_sha`, the commit it last indexed, and is valid at **that** tree and no other. The
projection renames it `lines_at_commit` and returns it beside the lines it qualifies:

```json
{ "status": "full", "lines_at_commit": "66727c85…", "symbols": [ { "at": "server/src/app.ts:81" } ] }
```

This is not hypothetical. On `Holubinka/dev-digest` PR #12 the index is `full` and its
commit is **not** the PR head, and the same payload read against `head_sha` put 7 of 20
caller lines on a comment, a bare `try {` or a blank line — the measurement that produced
`link_sha` in the first place, recorded in
[`contracts/blast.ts`](../server/src/vendor/shared/contracts/blast.ts) §TWO SHAS, ON
PURPOSE. The web card was fixed for it on 2026-08-09; a model handed
`"server/src/app.ts:81"` with no commit attached makes the same mistake, with no reviewer
looking over its shoulder.

`head_sha` is deliberately **not** in the result. It is the PR's identity, which the caller
already has as `repo` + `pr`, and it is the one commit these line numbers are not valid at —
returning it is an invitation to link against it. When `index_matches_head` is false the
`note` says the two commits differ, appended to whatever the `status` already had to say
rather than replacing it. When `link_sha` is null the index knows no commit at all:
`lines_at_commit` is then absent and the note says the lines cannot be tied to a tree —
falling back to the head is precisely the bug.

## The `devdigest` CLI

The second entry point of this package: `"bin": { "devdigest": "dist/cli.js" }`, built by
the same `npm run build` (spec 07 step 15).

```sh
cd mcp && npm run build
node dist/cli.js --help
node dist/cli.js review          # or `devdigest review` once the bin is linked
```

It runs `git diff HEAD` from the repository root and posts it to `POST /reviews/diff`,
which reviews the diff with **every enabled agent** and persists nothing — there is no
pull request to attach a run to. One line per finding on stdout, `<SEVERITY> <path>:<line>
<title>`; everything else on stderr. Exit **0** nothing blocking · **1** at least one
blocking finding · **2** the review could not be run at all. `--mode staged|branch` parses
and then exits 2: the names are reserved, not implemented.

**Untracked files are invisible to `git diff HEAD`** and so are not reviewed; `git add -N
<file>` makes a new file visible. `--help` (`src/cli/args.ts`) is the full contract.

Every decision lives in `src/cli/run.ts`, which takes the subprocess runner, the API client
and both output sinks as parameters — `src/cli.ts` is the wiring plus the EPIPE guard. That
injection, not "separate module graphs", is what keeps the CLI off the MCP server's stdout:
`src/index.ts` shares modules with the CLI (`project.ts`, `api/schemas.ts`) but never imports
`cli.ts`, the one file that owns a `process.stdout.write`.

## Finding order

Findings come back in a fully deterministic order:

**severity** (`CRITICAL` → `WARNING` → `SUGGESTION`) → **confidence** descending →
**file** → **start_line** → **title**.

The fifth key is not decoration. The source query has no `ORDER BY`, equal confidences
are common, and the finding `id` that breaks the tie in the server's own ranker is
dropped by this projection — with only four keys the order is partial over an unordered
input, and a test pinning it would be flaky rather than pinning anything. Comparison
uses raw confidence, not the 2-dp value shown in the result (`src/project.ts`). The CLI
prints its findings through the same comparator (`src/cli/run.ts:106`), so two runs over
one diff produce identical output.

This is the **third** findings ranker in the repo and it does not claim to match the
other two (root `INSIGHTS.md` §"The two findings rankers must sort identically, and
nothing checks that they do"). It is documented here and pinned by
`test/project.test.ts` so any drift stays visible.

## SDK: v1, and why not v2

**`@modelcontextprotocol/sdk@1.30.0`.** Settled 2026-08-08 by building a `ping` server on
both lines and driving each over raw stdio: both passed identically, so the tie was
broken on three findings rather than on the spike.

**Rejected: the v2 line** (`@modelcontextprotocol/{server,client,core}@2.0.0`).

- **v2 requires Zod 4 and this repo is Zod 3.** Its `registerTool` accepts only a schema
  exposing `~standard.jsonSchema`; Zod 3 does not implement it, and
  `@modelcontextprotocol/server@2.0.0` declares `zod: ^4.2.0` itself. Adopting v2 means a
  second major of Zod alongside `server/`, `client/` and `reviewer-core/`.
- A v1-SDK server is **connected to this Claude Code build right now** —
  `chrome-devtools-mcp@1.6.0` bundles SDK 1.29.0 and `claude mcp list` reports it
  Connected. That is stronger evidence than a spike: a production server on the v1 line
  against the client we ship for.
- Claude Code 2.1.226 negotiates protocol `2025-11-25`, which v1 serves.

The risk this carries is recorded in `INSIGHTS.md`: the 2026-07-28 spec revision lives
behind a `server/discover` handshake that v1 answers `-32601`. If a future Claude Code
opens with `server/discover` instead of `initialize`, this package strands. Re-probe with
`scripts/discover-probe.mjs`.

## Testing, and the gate that is not automatic

```sh
cd mcp && npm run typecheck && npm test
```

Hermetic vitest with a stubbed `fetch`, and a stubbed subprocess runner for the CLI suite
— no API, no Docker, no git, no key. There are no
`*.it.test.ts` files (this package has no database) and nothing in `e2e/` (no browser
surface). `scripts/smoke.ts` exercises the read-only tools against a running API by hand.

### Poking at it in a UI

```sh
cd mcp && npm run inspector
```

Rebuilds `dist/` and opens MCP Inspector on <http://localhost:6274> — a browser UI listing
the five tools, with a form per tool, the response, and the raw JSON-RPC frames both ways.
No Claude Code session involved, which makes it the fastest way to see what a tool actually
returns while changing it. Start the API first or every tool answers with the
"Cannot reach the DevDigest API" text.

The build is part of the script on purpose: this is the entry point people reach for
straight after editing `src/`, and a stale `dist/` is the documented trap above.

**Inspector renders no progress notifications.** Version 2.1.0 receives them and displays
them nowhere, so a silent `run_agent_on_pr` there proves nothing about progress. Use
`scripts/driver.mjs`, which prints every frame on the wire:

```sh
node scripts/driver.mjs --expect-tools 5 --no-progress -- node dist/index.js
node scripts/driver.mjs --tool list_agents --args '{}' -- node dist/index.js
```

That driver is also the only check that catches a relative import missing its `.js`
extension — see `INSIGHTS.md`.

**`run_agent_on_pr` is in no suite, on purpose.** A real run makes live provider calls
that cost real money, and an out-of-process HTTP client cannot override the server's LLM
the way an in-process test can. It is verified by hand, once.

**`mcp/` has no Track A gate and no CI workflow.**
`scripts/pr-self-review/scope.sh` maps only `client/*`, `server/*` and `reviewer-core/*`
into `.packages` (`scope.sh:209-213`), so a change confined to this package triggers no
typecheck, no tests, nothing. That is deliberate for now — teaching the pre-push gate a
fourth package means editing scripts that carry their own Bash suite. **So run the
command above by hand before pushing** and paste the result into the PR body. Nothing
else will.

## Read when

- **Read `AGENTS.md`** before writing code here — the `NodeNext` extension rule and the
  stdout rule both bite silently.
- **Read `INSIGHTS.md`** before debugging anything in this package.
- **Read `../specs/06-mcp-server.md`** for the design, the rejected alternatives, and the
  measured numbers behind the 120-second ceiling. It predates `get_blast_radius` and the
  CLI: for those, **read `../specs/07-blast-radius.md`** steps 13 and 15.
- **Read `../TESTING.md`** for where this suite sits relative to the others.
