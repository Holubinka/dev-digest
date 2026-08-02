#!/usr/bin/env bash
#
# Keeps only the findings this branch is responsible for.
#
#   frozen    a fingerprint in .pr-self-review/baseline.json is dropped
#   off-diff  a finding on a line the branch did not touch drops to `note`
#             and is marked anchored:false — visible, unable to block
#
# `line: 0` means "belongs to no single line" (a whole-package gate failure)
# and is exempt from anchoring. Always exits 0.
#
#   baseline.sh            filter, print the survivors
#   baseline.sh --freeze   record today's findings as the baseline instead
#
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

STORE=".pr-self-review/baseline.json"
payload="$(cat)"
findings="$(printf '%s' "$payload" | jq '.findings')"

if [ "${1:-}" = "--freeze" ]; then
  mkdir -p "$(dirname "$STORE")"
  printf '%s' "$findings" |
    jq 'map({file, line, message})' >"$STORE"
  printf 'froze %s findings into %s\n' "$(printf '%s' "$findings" | jq length)" "$STORE" >&2
  exit 0
fi

frozen='[]'
[ -f "$STORE" ] && frozen="$(cat "$STORE")"

printf '%s' "$payload" | jq \
  --argjson frozen "$frozen" '
  ( [ .scope.routed[] | { key: .path, value: .lines } ] | from_entries ) as $touched
  | [ .findings[]
      | . as $f
      | select(
          ($frozen | any(.file == $f.file and .line == $f.line and .message == $f.message)) | not
        )
      | if .line == 0 then
          .
        elif ($touched[.file] // []) | index($f.line) then
          .
        else
          .severity = "note" | .anchored = false
        end
    ]'
