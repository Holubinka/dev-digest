# e2e/ — `@devdigest/e2e`

Browser end-to-end flows against the real stack. Repo-wide rules live in the root
`CLAUDE.md`; this file only covers what is specific to this package.

## Determinism is the contract

These tests must produce the same result on every run, with no API keys.

- **Never use the `chat` command.** `agent-browser` can drive the page with an LLM;
  doing so here would make failures unreproducible. Locators only: `--url`, `--text`,
  `find role|text|label`.
- **No LLM runs anywhere in this suite.** Reviews are exercised through seeded data,
  not by calling a model.

## Not Playwright

The runner is `agent-browser` — a native Rust + CDP automation CLI. Playwright idioms do
not apply: there is no page object, no `expect`, no auto-waiting API.

- `specs/*.flow.json` — ordered lists of CLI commands, one file per flow. **This folder
  holds tests, not documentation.** Design notes go in `docs/`; there is no `specs/`
  docs folder here for exactly this reason.
- `run.ts` — executes every flow against one shared browser session.
- An assertion is a command that exits non-zero on timeout. There is no matcher library;
  if you need to assert something, express it as a `wait` or a `find`.

Uses **npm**, not pnpm.

## Running it

`../scripts/e2e.sh` brings up an isolated stack (Postgres 5433, API 3101, web 3100) with
an ephemeral, volume-less container, then runs the suite and tears it down. It is a
**local convenience and is not what CI uses** — `.github/workflows/e2e-web.yml` builds
its own stack on the standard ports (5432 / 3001 / 3000) and calls `run.ts` directly.

Flows assume the seeded demo repository `acme/payments-api` and PR #482. Changing the
seed breaks these tests.

## Read when

- **Read `README.md`** for the flow format and the command vocabulary before writing a
  new flow.
- **Read `INSIGHTS.md`** before debugging a flaky or failing flow.
- **Read `../TESTING.md`** to see where this suite sits relative to the unit and
  integration lanes.
