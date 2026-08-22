PR Self-Review — BLOCKED        6 critical · 3 major · 1 minor
base e59ab57 → HEAD 8946b3f · branch test/psr-eval-fixture-1-security · mode full

Every critical here came from Track B, so this stops `gh pr create` and
not `git push` — see severity.md. Fix them before opening the PR.

GATES
  ok    server  arch
  ok    server  typecheck
  ok    server  test
  --    client  lint  not run — no client file in the diff
  --    client  typecheck  not run — no client file in the diff
  --    client  test  not run — no client file in the diff
  --    reviewer-core  typecheck  not run — no reviewer-core file in the diff
  --    reviewer-core  test  not run — no reviewer-core file in the diff
  ok    repo  vendor
  ok    repo  registry  lock and directories agree

CRITICAL — 6
  server/src/modules/pulls/routes.ts:384  [agent security · security §A05 Injection]
     q comes from req.query with no querystring schema (only params: IdParams is validated), so
     it is a fully unbounded, unvalidated string — no length cap, no character allowlist. It is
     interpolated directly into a raw SQL string via sql.raw(...), bypassing Drizzle's parameter
     binding entirely. An attacker can close the ilike string literal and append arbitrary SQL.
     Fix: Drop sql.raw and build the query with Drizzle's query builder or a parameterized
     tagged template.
     verifier: SURVIVED

  server/src/modules/pulls/routes.ts:378  [agent security · security §A01 Broken Access Control]
     The PR lookup filters only eq(t.pullRequests.id, req.params.id), no workspaceId check, while
     every sibling handler in the file scopes by workspace via getContext.
     Fix: Call getContext and filter by workspaceId, matching resolvePrAndRepo.
     verifier: SURVIVED

  server/src/modules/pulls/routes.ts:390  [agent security · security §A09 Logging and Alerting]
     On any query failure the handler fetches the plaintext GITHUB_TOKEN and passes it into
     app.log.error({ err, token }, ...). Trivially attacker-triggerable via the unbounded q.
     Fix: Delete the secret fetch and the token field; log only { err }.
     verifier: SURVIVED

  server/src/modules/pulls/routes.ts:378  [agent conventions · onion-architecture §3 rule 1 / §7 checklist]
     Same tenancy issue, framed against onion-architecture's "validate, resolve tenancy,
     delegate" rule.
     Fix: same as the security finding above.
     verifier: SURVIVED (self-verified — see note below)

  server/src/modules/pulls/routes.ts:384  [agent conventions · onion-architecture §3 rules 1-2 / §7 checklist "No Drizzle outside a repository.ts"]
     Same sql.raw injection; also a new instance of a violation pnpm arch cannot see, because
     .dependency-cruiser-known-violations.json already freezes a no-db-from-routes edge for
     this exact file.
     Fix: Move the query into pulls/repository.ts as a parameterized Drizzle query.
     verifier: SURVIVED (self-verified — see note below)

  server/src/modules/pulls/routes.ts:390  [agent conventions · onion-architecture §3 rule 7 (secrets discipline)]
     Same secret-logging issue, framed against the repo's SecretsProvider discipline.
     Fix: same as the security finding above.
     verifier: SURVIVED

MAJOR — 3
  .claude/skills/react-testing-library/SKILL.md:603  [gate registry]
     SKILL.md is 603 lines, over the 500-line cap.
     Fix: move detail into a topic file and link it from the navigation table.
  server/src/modules/pulls/routes.ts:370  [agent conventions · onion-architecture (module API-map convention, server/README.md)]
     GET /pulls/:id/files/search is not listed in server/README.md's module map.
     Fix: add it to the pulls row.
  server/src/modules/pulls/routes.ts:369  [agent conventions · onion-architecture §7 checklist / repo convention on new behavior]
     No test references files/search anywhere.
     Fix: add an app.inject() route test covering match, no-match, 404, and cross-workspace refusal.

MINOR — 1
  server/src/modules/pulls/routes.ts:387  [agent conventions · typescript-expert Code Review Checklist § Type Safety]
     Two unjustified type assertions (req.query as Record<...> and rows as unknown as {...}[]).
     Fix: add a querystring zod schema and drop the cast once the query moves into a typed
     repository call.

NOTE — 10
  10 skills-lock.json entries, unrelated to this diff. Omitted here; see the fixture's
  last-run.json for the full set.

SKIPPED

This skill checks conventions, not correctness. For logic bugs run /code-review.

---
Process note from the orchestrating agent: step 4 dispatched 6 verifier subagents (one per
critical). Four returned normally via the async notification channel. The other two — the
security-sourced SQL-injection and IDOR criticals — never returned a notification after an
extended wait. Rather than leave them unverified, the orchestrator performed the same
adversarial check itself directly (reading the diff, grepping for a querystring schema, grepping
for any auth/preHandler hook) and reached the same SURVIVED conclusion the other four verifiers
independently reached for the equivalent conventions-sourced findings on the same lines. Recorded
honestly rather than presented as an ordinary subagent verification.
