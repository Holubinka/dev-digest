#!/usr/bin/env bash
#
# Lesson 06 — Eval Pipeline. One command that proves a reviewer agent can be
# scored against a saved case set, without opening the UI and paying for a batch.
#
#   ./scripts/verify-l06.sh              # scoring, guards, runner, client (hermetic, fast)
#   ./scripts/verify-l06.sh --with-db    # …plus the routes, on a Testcontainers pg
#
# What it proves, and where:
#
#   server/test/eval-scoring.test.ts      AC-38 … AC-51 — the metrics, in pure code:
#                                         crediting is file path + intersecting range
#                                         and nothing else, one finding per expectation
#                                         and one expectation per finding, a must_not_flag
#                                         hit is noise, a dropped finding leaves precision's
#                                         denominator, an empty case scores 1 without
#                                         entering a pooled denominator, and pooling is the
#                                         micro-average over merged counters — never the
#                                         mean of per-case values. It builds no container
#                                         and no provider, which is the evidence for AC-38.
#   server/test/eval-fragment.test.ts     AC-4, AC-6, AC-12, AC-23 — the input guards:
#                                         the fragment is the cited file's hunks and an
#                                         absent path is refused rather than widened to the
#                                         whole diff, input_files is derived from the stored
#                                         fragment, a finding range anchored to no hunk is
#                                         caught, and a --stat summary, an over-claiming
#                                         hunk header or a removal-only diff is not runnable.
#   server/test/eval-batch.test.ts        AC-24 … AC-37 — the batch runner on a stubbed
#                                         provider: one row per case, the envelope
#                                         (batch, agent, version, provider, model, skills,
#                                         findings, dropped), the aggregate written into
#                                         every row, a mid-batch failure that does not stop
#                                         the batch and an all-errored batch that writes no
#                                         aggregate, the missing provider key refused before
#                                         the loop, never more than one call in flight, and
#                                         a prompt that carries the diff and the PR body only
#                                         inside the engine's untrusted fences and is
#                                         byte-identical across two runs.
#   server/test/eval-helpers.test.ts      `toCaseRow`'s `last_run.skills` — a well-formed
#                                         array carried through as-is, an empty array read
#                                         as "no skills linked" rather than unknown, a row
#                                         written before this field existed reading as
#                                         empty rather than throwing, and a malformed entry
#                                         dropped without losing its well-formed siblings.
#   client FindingCard                    AC-3 — the half a route test cannot see: «Turn into
#                                         eval case» is live on an accepted and on a dismissed
#                                         finding, and disabled with the reason in its
#                                         accessible name while the finding is undecided.
#   client EvalsTab + case editor         AC-14 … AC-20 — three last-run states rather than
#                                         two, the N / M passing badge, the fixed input in
#                                         three tabs, expected_output parsed by the same
#                                         contract the route parses with so a bad one blocks
#                                         the save, and Run on save.
#   client evals dashboard + compare      AC-53 … AC-63 — the per-agent cards and the
#                                         all-agents table, deltas and the banner only above
#                                         two completed batches, the date range bounding
#                                         chart and table alike, Compare enabled at exactly
#                                         two selected rows, the four old → new tiles, the
#                                         prompt diff versus the same-version statement, and
#                                         the not-like-for-like warning.
#   server/test/eval-routes.it.test.ts    (--with-db) the routes themselves: case creation
#                                         from a decided finding, the slug suffix, the
#                                         provenance that outlives the PR, a single-case run,
#                                         the delete cascade, the four pre-flight refusals
#                                         before any model call, and the cross-workspace 404
#                                         (AC-1 … AC-11, AC-21, AC-22, AC-27 … AC-29,
#                                         AC-67 … AC-70).
#
# Exits non-zero on the first failing suite. `server/` and `client/` are pnpm —
# do not swap in npm (see the root AGENTS.md).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WITH_DB=0
for arg in "$@"; do
  case "$arg" in
    --with-db) WITH_DB=1 ;;
    -h|--help) sed -n '2,65p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $arg (try --help)" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

step "scoring, AC-38 … AC-51 — server/test/eval-scoring.test.ts"
(cd server && pnpm exec vitest run test/eval-scoring.test.ts)

step "fragment + diff guards, AC-4 · AC-6 · AC-12 · AC-23 — server/test/eval-fragment.test.ts"
(cd server && pnpm exec vitest run test/eval-fragment.test.ts)

step "batch runner on a stubbed provider, AC-24 … AC-37 — server/test/eval-batch.test.ts"
(cd server && pnpm exec vitest run test/eval-batch.test.ts)

step "last_run.skills guard — server/test/eval-helpers.test.ts"
(cd server && pnpm exec vitest run test/eval-helpers.test.ts)

step "client, AC-3 · AC-14 … AC-20 · AC-53 … AC-63 — FindingCard, Evals tab + case editor, dashboard, compare"
(cd client && pnpm exec vitest run \
  "src/app/repos/[repoId]/pulls/[number]/_components/FindingCard" \
  "src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab" \
  "src/app/evals/")

if [ "$WITH_DB" -eq 1 ]; then
  if docker info >/dev/null 2>&1; then
    step "routes, AC-1 … AC-11 · AC-21 · AC-22 · AC-27 … AC-29 · AC-67 … AC-70 — server/test/eval-routes.it.test.ts (Testcontainers pg)"
    (cd server && pnpm exec vitest run test/eval-routes.it.test.ts)
  else
    echo
    echo "✗ --with-db was asked for, but Docker is not running." >&2
    echo "  The route suite needs it (Testcontainers). Start Docker and re-run." >&2
    exit 1
  fi
else
  echo
  echo "note: the route suite was NOT run. It needs Docker; add --with-db to include it."
fi

printf '\n\033[32m✓ Eval Pipeline verified\033[0m\n'
