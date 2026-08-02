#!/usr/bin/env bash
#
# Runs every pr-self-review script test. Local and CI entry point.
#
#   bash scripts/pr-self-review/test/run.sh
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
status=0

# Canary. Every test is supposed to work only inside a throwaway repo from
# make_repo, and `sgit` enforces that at each call site. This catches an escape
# by any route the guard does not cover — a stray `cd`, a subshell, a helper
# added later — by comparing the real repository before and after the suite.
# It once escaped for real: a branch and four commits landed in the developer's
# own checkout, and nothing failed.
before_head="$(git rev-parse HEAD)"
before_branches="$(git for-each-ref --format='%(refname)' refs/heads)"

for file in "$HERE"/*.test.sh; do
  [ -e "$file" ] || continue
  printf '\n%s\n' "$(basename "$file")"
  bash "$file" || status=1
done

if [ "$(git rev-parse HEAD)" != "$before_head" ]; then
  printf '\nESCAPED: the suite moved HEAD in the real repository\n' >&2
  status=1
fi
if [ "$(git for-each-ref --format='%(refname)' refs/heads)" != "$before_branches" ]; then
  printf '\nESCAPED: the suite changed the branches of the real repository\n' >&2
  git for-each-ref --format='  %(refname)' refs/heads >&2
  status=1
fi

printf '\n'
if [ "$status" -eq 0 ]; then
  printf 'all pr-self-review script tests passed\n'
else
  printf 'pr-self-review script tests FAILED\n'
fi
exit "$status"
