# Insights — e2e/

Failures and surprises specific to the browser suite. Repo-wide ones live in the root
`INSIGHTS.md`. Seven fixed sections, append-only —
`../.claude/skills/engineering-insights/SKILL.md` holds the rules.

---

## What Works

_Nothing recorded yet._

## What Doesn't Work

### Tempted to reach for the `chat` command

**Symptom.** A locator is awkward to express, and `agent-browser`'s LLM-driven `chat`
command would solve it in one line.

**Cause.** It is genuinely more convenient.

**Fix.** Do not. It would make the suite non-deterministic and require an API key in
CI — the two properties this suite exists to avoid. Restructure the locator, or add a
stable `data-*` hook in the client instead.

## Codebase Patterns

_Nothing recorded yet._

## Tool & Library Notes

### `wait --url` takes a substring here, never the glob its own help advertises

**Symptom.** `agent-browser wait --url "**/repos/*/onboarding"` exits 1 with
`✗ Failed to read: Resource temporarily unavailable (os error 35) (after 5 retries - daemon
may be busy or unresponsive)` — on a page whose URL *does* match the pattern, and with the
same daemon answering `get url` correctly one command earlier. Reproduced three times on
2026-08-19 while writing `specs/08-onboarding-tour.flow.json`.

**Cause.** Unknown; `agent-browser wait --help` documents `wait --url "**/dashboard"`, so
the syntax is not the mistake. The message is the daemon read timing out, not a match
failure, which is why it does not read like an assertion that went red.

**Fix.** Match URLs the way every existing flow does — a plain substring (`/pulls`,
`tab=findings`). When a substring is too loose to distinguish two routes, use
`wait --fn` with a `location.pathname` expression instead:
`wait --fn "location.pathname.startsWith('/repos/') && location.pathname.endsWith('/onboarding')"`
tells `/repos/<id>/onboarding` from the bare `/onboarding` screen, and both `--fn` forms
were verified to exit non-zero when false.

## Recurring Errors & Fixes

### The suite passes locally and fails in CI, or vice versa

**Symptom.** `../scripts/e2e.sh` is green, the `e2e-web` workflow is red, and nothing in
the diff explains it.

**Cause.** They are not the same harness. `scripts/e2e.sh` builds an isolated stack on
Postgres 5433 / API 3101 / web 3100 with an ephemeral container. CI does not call that
script at all — `e2e-web.yml` stands up its own stack on 5432 / 3001 / 3000 and invokes
`run.ts`. Anything port- or volume-dependent can differ between them.

**Fix.** Reproduce the CI path directly (start the stack on the standard ports, then
`npm test`) before concluding a flow is flaky.

### A flow fails right after a seed or UI-copy change

**Symptom.** `wait --text` times out on a string that is visibly on the page, or a
`find` matches nothing.

**Cause.** Flows assert against seeded fixtures — the demo repository
`acme/payments-api` and PR #482 — and against literal visible text. Renaming a label or
editing the seed silently invalidates them.

**Fix.** Update the flow JSON alongside the change. Treat these files as part of the
UI's contract, not as an afterthought.

### `find … click` straight after `wait --url` clicks nothing that the API still owes

**Symptom.** `04-pr-findings.flow.json` failed on 2026-08-19 with
`✗ open the PR row — Command failed: agent-browser find text Add rate limiting to public API
endpoints click`, and passed on the three other runs of the same suite that hour. Nothing in
the diff touched it.

**Cause.** `wait --url "/pulls"` settles when the route changes, which is before the PR list
fetch resolves — so the row being clicked may not be in the DOM yet.
`02-repo-pulls-detail.flow.json:7` waits for the row's text before clicking it;
`04-pr-findings.flow.json:7` and `05-pr-diff.flow.json:7` click without that wait. 02 has
never been seen to fail on this step.

**Fix.** Put a `wait --text` for the element in front of every `find … click` that depends on
a fetch. `specs/08-onboarding-tour.flow.json` does this for the sidebar row. Adding the
missing wait to 04 and 05 is a one-line change to each and is left for whoever owns those
flows — an intermittent red step is not evidence of a UI bug here, and chasing it as one
costs a full hermetic run each time.

## Session Notes

_Nothing recorded yet._

## Open Questions

_Nothing recorded yet._
