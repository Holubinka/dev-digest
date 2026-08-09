#!/usr/bin/env bash
#
# Lesson 03 — Smart Diff. One command that proves the risk classification is
# right, without opening the UI and clicking through a PR.
#
#   ./scripts/verify-l03.sh              # classifier + viewer (hermetic, fast)
#   ./scripts/verify-l03.sh --with-db    # …plus the route, on a Testcontainers pg
#
# What it proves, and where:
#
#   server/test/smart-diff.test.ts        classifyPath + buildSmartDiff — a lock
#                                         file is boilerplate from any depth,
#                                         dist/index.js is boilerplate and not a
#                                         barrel, core is the default, groups come
#                                         out core → wiring → boilerplate, the file
#                                         carrying findings sorts to the top, and
#                                         too_big flips one line past the threshold.
#   client .../SmartDiffViewer            the half a unit test cannot see: core is
#                                         expanded on mount while the lock file is
#                                         collapsed whatever its size, and a
#                                         severity chip sits on the line it cites.
#   client .../FindingsPanel              the other end of a chip click — the
#                                         targeted finding is the one revealed.
#   server/test/smart-diff.it.test.ts     (--with-db) the route itself, including
#                                         the assertion that three GETs create no
#                                         `agent_runs` row: Smart Diff calls no model.
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
    -h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $arg (try --help)" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

step "classifier — server/test/smart-diff.test.ts"
(cd server && pnpm exec vitest run test/smart-diff.test.ts)

step "viewer + jump-to-finding — client component tests"
(cd client && pnpm exec vitest run \
  "src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer" \
  "src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel")

if [ "$WITH_DB" -eq 1 ]; then
  if docker info >/dev/null 2>&1; then
    step "route — server/test/smart-diff.it.test.ts (Testcontainers pg)"
    (cd server && pnpm exec vitest run test/smart-diff.it.test.ts)
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

printf '\n\033[32m✓ Smart Diff verified\033[0m\n'
