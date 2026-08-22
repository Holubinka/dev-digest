## Review findings: `server/src/modules/pulls/notify.ts` + `repository.ts`

**1. Secret read via `process.env` instead of `SecretsProvider`** — `notify.ts` ~line 19. *Major.* Root `CLAUDE.md` states explicitly that secrets never pass through `process.env`/`AppConfig` and must go through `SecretsProvider`. A Slack webhook URL is a bearer credential and belongs there like `GITHUB_TOKEN`/`OPENAI_API_KEY`, not read raw from the environment.

**2. Raw `fetch` to an external service, not behind a port/adapter** — `notify.ts` ~lines 21-27. *Major.* Every other outbound call in this codebase (GitHub, LLM providers, embeddings) goes through an adapter behind a port, wired in `container.ts`, overridable in tests via `ContainerOverrides`/`adapters/mocks.ts`. This class calls the global `fetch` directly, so it's not mockable and not unit-testable per `TESTING.md`'s "mock the outside world" rule.

**3. The service is unwired and can't legally be called from its likely trigger point** — whole file, plus `container.ts`/`modules/index.ts`. *Major.* `PrNotifyService` has no `container.notify` getter and no caller anywhere in the repo. Its natural trigger — "review finished" — lives in `modules/reviews/`, but the enforced `no-cross-module` dependency-cruiser rule forbids `reviews/**` from importing `pulls/**` directly.

**4. File naming escapes the enforced arch rules; constructor deviates from the established service idiom** — `notify.ts` lines 1-14. *Convention.* `.dependency-cruiser.cjs`'s `no-service-to-adapter-impl`/`no-fs-in-service` rules only match `(service|.*-executor)\.ts$`; `notify.ts` matches neither, so `pnpm arch` can't see it. Also, unlike `IntentService`/`BlastService`/`BriefService` (which take a narrow `*Container` port + a repository passed in as a parameter), this class stores the whole concrete `Container` and builds its own `new PullsRepository(container.db)` instead of reusing `container.pullsRepo`.

**5. No error handling, no logging, no timeout on the Slack call** — `notify.ts` ~lines 21-27. *Major.* Unlike every GitHub call in `routes.ts` (wrapped in try/catch + `app.log.warn`), this `fetch` is unguarded.

**6. No tests added** for the new service. *Minor*, blocked on fixing #2 first to make it mockable.

**7. Minor duplication**: `findById` in `repository.ts` duplicates a query already inlined twice in `routes.ts`.

No correctness bugs in the SQL itself, and no injection/SSRF issue (webhook URL is operator-configured, message text is safely JSON-encoded).
