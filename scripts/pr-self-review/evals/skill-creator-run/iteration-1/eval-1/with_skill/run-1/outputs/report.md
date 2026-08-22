PR Self-Review — BLOCKED        3 critical · 2 major · 1 minor
base e59ab57 → HEAD aacde5a · branch test/psr-eval-fixture-2-onion · mode full

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

CRITICAL — 3
  server/src/modules/pulls/notify.ts:12  [agent conventions · onion-architecture §7 (§3.3)]
     PrNotifyService builds its own repository inside the constructor (`this.repo = new PullsRepository(container.db)`) instead of taking it as a parameter. Checklist item 'The service takes its repository as a parameter (§3.3)' is violated — this is the exact 'service can just take the container' red flag, and `pnpm arch` has no rule that can see it (no-service-to-adapter-impl only checks src/adapters/, not a module's own repository.ts), so nothing else catches it.
     Fix: Change the constructor to `constructor(private container: Container, private repo: PullsRepository = new PullsRepository(container.db)) {}`, matching BlastService/BriefService in container.ts.
  server/src/modules/pulls/notify.ts:22  [agent conventions · onion-architecture §7 (§3.4)]
     The Slack webhook call is a raw `fetch` inside a service with no port and no adapter. Checklist item 'Every new external call has a port and a mock in adapters/mocks.ts (§3.4)' is violated. No dependency-cruiser rule forbids a bare network call from a service (only node:fs and Fastify are blocked that way), so `pnpm arch` is blind to it.
     Fix: Introduce a port (e.g. `NotificationSender.send(message: string): Promise<void>` in vendor/shared/adapters.ts or modules/pulls/types.ts), implement it as an adapter under adapters/, add a getter on Container and a mock in adapters/mocks.ts, and call the port from PrNotifyService instead of `fetch` directly.
  server/src/modules/pulls/notify.ts:19  [agent conventions · onion-architecture §7 (§3.7 / §4 Secrets)]
     `const webhookUrl = process.env.SLACK_WEBHOOK_URL` reads a secret-equivalent credential (posting to the URL is enough to send messages as the app) straight from process.env. Checklist item 'No secret in AppConfig or process.env (§3.7)' is violated, and CLAUDE.md's 'Secrets never pass through process.env or AppConfig' states the same rule directly — this is the class of finding severity.md marks critical because it 'cannot be undone by a later commit.'
     Fix: Resolve the URL through SecretsProvider instead: `const webhookUrl = await container.secrets.get('SLACK_WEBHOOK_URL')`, following the pattern at platform/container.ts:361-363.

MAJOR — 2
  .claude/skills/react-testing-library/SKILL.md:603  [gate registry]
     SKILL.md is 603 lines, over the 500-line cap in .claude/skills/README.md
     Fix: move detail into a topic file and link it from the navigation table
  server/src/modules/pulls/notify.ts:19  [agent security · security §A04 Cryptographic Failures]
     `webhookUrl` is read straight from `process.env.SLACK_WEBHOOK_URL`, bypassing the repo's one secrets chokepoint. `platform/config.ts:9-14` states explicitly: 'Feature code must access secrets through SecretsProvider, never via process.env or AppConfig — the SecretsProvider is the one chokepoint that reads process.env directly,' and `SLACK_WEBHOOK_URL` is not even in `EnvSchema`, so it isn't validated either. `PrNotifyService` already holds `container` (which exposes `container.secrets`), so this isn't a missing capability, just an unwired one.
     Fix: Resolve the webhook URL via `await this.container.secrets.get('SLACK_WEBHOOK_URL')` instead of `process.env.SLACK_WEBHOOK_URL`, matching every other secret in this codebase (OPENAI_API_KEY, ANTHROPIC_API_KEY, GITHUB_TOKEN all go through the same chokepoint).

MINOR — 1
  server/src/modules/pulls/notify.ts:22  [agent conventions · typescript-expert §Code Review Checklist (Error Handling Patterns)]
     The `fetch` call to the Slack webhook has no try/catch or `.catch()`. A network failure rejects the promise, which propagates out of `notifyReviewComplete` uncaught by anything in this file — a best-effort notification can fail the flow that triggered it.
     Fix: Wrap the fetch call in try/catch (or append `.catch()`) so a failed Slack delivery is swallowed rather than rejecting notifyReviewComplete.

NOTE — 10
  10 skills-lock.json entries, unrelated to this diff. Omitted here; see the fixture's
  last-run.json for the full set.

SKIPPED

This skill checks conventions, not correctness. For logic bugs run /code-review.
