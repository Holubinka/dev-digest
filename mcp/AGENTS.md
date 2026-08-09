# mcp/ — `@devdigest/mcp`

The MCP server that exposes the review loop over stdio. Repo-wide rules live in the root
`AGENTS.md`; this file only covers what is specific to this package.

Uses **npm**, not pnpm, with `package-lock.json` committed. `pnpm install` here produces
an untracked lockfile and a package the root README's prerequisites do not cover.

## Only JSON-RPC may reach stdout

stdout **is** the transport. One stray byte there desynchronises the frame stream and the
session dies, usually with an error that names neither this package nor the line that
printed.

- No `console.log`, ever. Diagnostics go to `console.error` / stderr, which the client
  captures and shows separately.
- No `npm run …` as a launch command — npm prints its script banner to stdout, and
  `--prefix` chdirs. `.mcp.json` runs `node mcp/dist/index.js` for exactly this reason
  (`INSIGHTS.md`).
- Nothing that logs on import. A dependency that greets stdout is disqualified.

## `NodeNext`, so relative imports carry `.js`

`tsconfig.json` sets `module`/`moduleResolution: "NodeNext"`, unlike `server/` and
`reviewer-core/`, which use `Bundler` and bare specifiers. Write `import { x } from
'./errors.js'`, never `'./errors'`, even though the file is `errors.ts`.

This package is the only one of the three that **emits JS and runs as a process**, and
Node ESM does not add extensions. **The test suite will not catch a missing one:** Vitest
2.1.9 resolves `./errors.js` → `errors.ts` happily, so `npm test` passes and
`node dist/index.js` dies with `ERR_MODULE_NOT_FOUND`. `npm run build` followed by an
actual launch is the only check that fires.

## An HTTP client of the API, and nothing more

The API on `:3001` is the single external dependency. Behind one client module, over an
injectable `fetch` — that is the port, and the stubbed `fetch` in `test/` is its fake.

- **No Drizzle, no `postgres`, no database connection.** This package holds no schema and
  opens no socket to anything but the API.
- **Never import from `server/src/**`.** Not a type, not a constant. Runtime dependencies
  are the MCP SDK and Zod; `fetch` is built in.
- **No third vendored copy of `@devdigest/shared`,** and no tsconfig alias to the server's
  copy. The `shared-sync` gate compares exactly two paths, so a third would be the only
  one nothing guards — and the MCP surface is a *projection*, not the contract. Having the
  full contract in scope invites returning it whole, which is what the output-token limit
  punishes.
- Instead: a **narrow local Zod schema per response**, naming only the fields a tool
  projects, and `safeParse` at the edge — once, on the way in. A moved API contract then
  becomes a loud, self-describing tool error instead of a silently wrong answer.

## Result size is the budget

Tool results are read by a model. Project aggressively, drop identifiers and nested
objects nothing consumes, cap free text, and default to a page rather than everything.
Do not raise `_meta["anthropic/maxResultSizeChars"]` — a tool that needs the ceiling
lifted has a projection problem.

Truncate by code point, not with `String.slice`: slicing cuts astral characters in half
and leaves a lone surrogate (`server/INSIGHTS.md`). Use the helper in `src/project.ts`.

## The six description strings are fixed

The server `instructions` and the five tool `description`s are specified verbatim in
`../specs/06-mcp-server.md` §Appendix and are copied character for character. They are a
contract, not a starting point: each is cut at 2KB with the first bytes surviving, and
every sentence carries a specific rule. If one is wrong, fix it **in the spec first**, then
in the code.

## Read when

- **Read `README.md`** for the tool surface, the SDK decision, and the finding order.
- **Read `INSIGHTS.md`** before debugging anything here — the SDK line, the cwd question
  and the stdout traps are all already answered there.
- **Read `../specs/06-mcp-server.md`** before changing what a tool returns.
- **Read `../TESTING.md`** — this package has no CI workflow and no Track A gate, so
  `npm run typecheck && npm test` before a push is manual and is the only gate.
