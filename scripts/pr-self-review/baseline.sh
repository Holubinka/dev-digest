#!/usr/bin/env bash
#
# Keeps only the findings this branch is responsible for.
#
#   frozen    a fingerprint in .pr-self-review/baseline.json is dropped,
#             whatever produced it
#   off-diff  a *model* finding on a line the branch did not touch drops to
#             `note` and is marked anchored:false — visible, unable to block
#
# Anchoring applies only to what a model produced: `source` beginning with
# "agent ". Deterministic sources are exempt, because they were never about a
# diff line in the first place and already scope themselves —
#
#   gate arch      carries its own .dependency-cruiser-known-violations.json
#   gate registry  is repo-wide state, tied to no line at all
#   gate scope     is a Tier-2 flag: the fact of the change IS the finding, so
#                  the path is deliberately never in .routed[]
#
# Anchoring those silently turned a committed .env and two broken
# skills-lock.json entries into notes, and the verdict read `pass` on a branch
# that had three criticals. `line: 0` stays exempt for the same reason it
# always was: it means "belongs to no single line".
#
# The baseline exists for the sixteen pre-existing container.db calls in
# pulls/routes.ts, and those come from a subagent. Only model findings need it.
#
# Both the `source` and the `file` tests are defensive, and for the same
# reason: half the findings in the payload are written by a model, so any key
# can be absent or the wrong type. A bare startswith() on a missing `source`
# raises "requires string inputs"; a bare $touched[.file] on a missing `file`
# raises "Cannot index object with null". Under `set -e` either one discards
# the WHOLE payload — including the deterministic criticals sitting beside the
# malformed entry. One bad model finding must not take the committed .env with
# it.
#
# An entry with no usable source is treated as deterministic, and one with no
# usable file simply matches no touched path. Both are the safe direction: the
# finding stays visible at full severity instead of vanishing, and nothing else
# in the array is affected.
#
# Always exits 0.
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
      | if (((($f.source // "") | tostring) | startswith("agent ")) | not) then
          .
        elif .line == 0 then
          .
        elif ($touched[(($f.file // "") | tostring)] // []) | index($f.line) then
          .
        else
          .severity = "note" | .anchored = false
        end
    ]'
