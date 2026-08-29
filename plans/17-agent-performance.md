# 17 — Agent Performance dashboard

**Spec:** [`specs/SPEC-07-agent-performance.md`](../specs/SPEC-07-agent-performance.md) (Approved 2026-08-29)
**Scope:** server · client
**Execution:** single-agent
**Status:** Implemented 2026-08-29

## Requirements as understood

| R# | Requirement | AC |
|---|---|---|
| R1 | Sidebar row + active highlight for `/agent-performance` | AC-1, AC-2 |
| R2 | Row action navigates to the agent's Stats tab | AC-3 |
| R3 | Three periods (1d / 30d / custom), URL-carried, half-open, 422 on a bad custom range, echoed back | AC-4…AC-9 |
| R4 | Counted-run rule: terminal statuses only, findings attributed by their run's `ran_at` | AC-10…AC-12 |
| R5 | Summary tiles: runs, cost (+ uncosted count), pooled accept rate (+ denominator), most-active agent | AC-13…AC-20 |
| R6 | Table: every agent, seven columns, zero-run row reads `0` and `—` | AC-21…AC-27 |
| R7 | Sorting client-side, small samples marked and demoted, threshold served by the API | AC-28…AC-31 |
| R8 | Cost breakdown reconciles to the total; deleted-agent and unknown-model buckets; estimate provenance stated | AC-32…AC-37 |
| R9 | Loading / error / two empty states, none of them printing a zero | AC-38…AC-42 |
| R10 | Zero LLM calls on every path of this screen | AC-43, AC-44 |
| R11 | The agent's Stats tab, served by the same aggregation, same periods | AC-45…AC-47 |

Every AC in SPEC-07 is covered by an R# above. Nothing is deferred.

## Constraints, and the file that mandates each

| Constraint | Source |
|---|---|
| A route validates, resolves tenancy, delegates. SQL lives in `repository.ts` or `repository/` | `.claude/skills/onion-architecture/SKILL.md` § 3.1-3.2, `server/.dependency-cruiser.cjs` `no-db-from-routes`, `no-sql-outside-repository` |
| A service takes its repository as a defaulted constructor parameter | onion § 3.3 |
| No import across `modules/<slice>/` boundaries | `no-cross-module` |
| Pure transforms go in `helpers.ts` and are where the unit tests point | onion § 2 |
| Contracts are edited in `server/src/vendor/shared/` first, then mirrored to `client/` | root `CLAUDE.md` § *Do not touch*, `shared-sync.yml` |
| Client data goes through a TanStack Query hook, never `fetch` in a component | `client/AGENTS.md` |
| Responsive properties belong in `globals.css` keyed on a `dd-` class, never in `styles.ts` | `client/AGENTS.md` |
| The design is an acceptance criterion; divergences are recorded, not resolved silently | `client/AGENTS.md`, and the walk beside the mockup |
| `vendor/ui` may gain a prop for a shape more than one caller needs — not for one screen's spacing | `client/AGENTS.md` |
| Integration tests are `*.it.test.ts` and run serially against a real Postgres | `TESTING.md` |

## Work

### P1 — contract (`server/src/vendor/shared/contracts/productionize.ts`, mirrored)

Rewrite the Agent Performance block, which has no consumer today:

- `PerfRange` (`1d` / `30d` / `custom`), `PerfPeriod` (`kind`, `from`, `to`).
- `AgentPerfRow` gains `judged`, `low_sample`, `prev_accept_rate`, `runs_with_cost`,
  `runs_without_cost`, `avg_duration_ms`, `pending`; loses `trend` (the mockup's table has no
  sparkline) and `avg_latency_ms` (renamed to say what it measures).
- `AgentPerf.summary` gains `runs_without_agent`, `prev_total_cost_usd`, `accepted`, `dismissed`,
  `judged`, `runs_with_cost`, `runs_without_cost`, `cost_basis`, `runs_trend`; `most_active_agent`
  becomes an object.
- `AgentPerf` gains `period` and `min_decisions_for_rank`.
- `AgentPerfDetail` — the Stats-tab response: `period`, `agent: AgentPerfRow`, `cost_basis`,
  `runs_trend`, `min_decisions_for_rank`.

`AgentStats` in `observability.ts` is left exactly as it is: it is another lesson's stub, it has no
consumer, and touching it widens this diff for nothing.

Mirror: `cp` the file to `client/src/vendor/shared/contracts/`, verify with
`diff -r server/src/vendor/shared client/src/vendor/shared`.

### P2 — server module `modules/performance/`

A new slice rather than a wing of `agents/`: it aggregates `agent_runs`, `reviews` and `findings`,
which the `agents` slice does not own, and `agents/service.ts` (211 lines) and
`agents/repository.ts` (282) are already at the size where the skill says to split.

| File | Ring | Holds |
|---|---|---|
| `constants.ts` | core | `MIN_DECISIONS_FOR_RANK`, `COUNTED_RUN_STATUSES`, trend bucket counts |
| `helpers.ts` | core | period resolution, rate maths, most-active pick with its tiebreak, bucket assembly, row/DTO construction. No I/O — this is what the unit tests hit |
| `repository.ts` | application | five Drizzle aggregates, all workspace- and period-scoped |
| `service.ts` | application | `constructor(container, repo = new PerformanceRepository(container.db))`; composes current + previous window into the two DTOs |
| `routes.ts` | infrastructure | `GET /agents/performance`, `GET /agents/:id/stats`; Zod query schema; 404 on an unknown agent |

Registered in `modules/index.ts` as `performance`. `GET /agents/performance` and `GET /agents/:id`
coexist: find-my-way resolves a static segment before a parametric one.

### P3 — client

- `vendor/ui/nav.ts` — the GLOBAL row (no `gKey`: every `gKey` owes a `SHORTCUTS` entry and no
  criterion asks for a shortcut). `nav.test.ts` updated for the new row count.
- `vendor/ui/charts/MetricCard.tsx` — `deltaGood`, `deltaPrefix`, `corner`, all optional and all
  defaulting to today's behaviour.
- `lib/hooks/performance.ts` — `useAgentPerformance(period)`, `useAgentPerfDetail(id, period)`.
- `lib/types.ts` — re-export the new types.
- `app/agent-performance/page.tsx` + `_components/AgentPerformanceView/` with
  `PeriodPicker`, `SummaryTiles`, `AgentTable` (+ `AgentRow`), `CostBreakdown`, and a colocated
  `helpers.ts` for sorting and formatting.
- `app/agents/[id]/.../AgentEditor` — a `stats` tab rendering `StatsTab`, which mounts the SAME
  row component the dashboard table expands to. `constants.ts` gains the tab; `?tab=stats` already
  routes.
- `messages/en/agentPerformance.json` — extended, existing keys kept.
- `app/globals.css` — the two breakpoints this screen needs, keyed on `dd-perf-*`.

### P4 — tests

| Suite | Covers |
|---|---|
| `server` unit — `modules/performance/helpers.test.ts` | period resolution incl. the 422 cases, pooled accept rate and its null, most-active tiebreak, breakdown reconciliation, `low_sample`, the deleted-agent and unknown-model buckets |
| `server` integration — `modules/performance/performance.it.test.ts` | real rows through both routes; **asserts the Stats response equals the dashboard's row for that agent** (R11 / AC-46), that `queued`/`running` runs are excluded, and that both donuts sum to the total |
| `client` — `AgentPerformanceView.test.tsx` | skeleton with no zeros, error with no zeros, both empty states, denominators rendered, low-sample marked and demoted, sorting issues no request, expanding issues no request |
| `client` — `StatsTab.test.tsx` | the tab renders the agent's row and respects the period |

## Verification

```sh
cd server && pnpm arch && pnpm typecheck && pnpm test:unit
cd server && pnpm test:it -- performance
cd client && pnpm lint && pnpm typecheck && pnpm test
diff -r server/src/vendor/shared client/src/vendor/shared
```

Then the screen itself, against the mockup and the walk, with the API running.

## Out of scope

The `Memory` sidebar row (`SPEC-05 § N7`), Weekly Digest, reconciling cost against a provider's
billing API, a drill-down list of individual runs, CSV export.
