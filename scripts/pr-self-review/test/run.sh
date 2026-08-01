#!/usr/bin/env bash
#
# Runs every pr-self-review script test. Local and CI entry point.
#
#   bash scripts/pr-self-review/test/run.sh
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
status=0

for file in "$HERE"/*.test.sh; do
  [ -e "$file" ] || continue
  printf '\n%s\n' "$(basename "$file")"
  bash "$file" || status=1
done

printf '\n'
if [ "$status" -eq 0 ]; then
  printf 'all pr-self-review script tests passed\n'
else
  printf 'pr-self-review script tests FAILED\n'
fi
exit "$status"
