#!/usr/bin/env bash
#
# Keeps only the findings this branch is responsible for.
#
#   frozen    a *model* finding whose fingerprint is in
#             .pr-self-review/baseline.json is dropped
#   off-diff  a *model* finding on a line the branch did not touch drops to
#             `note` and is marked anchored:false — visible, unable to block
#
# Both rules apply to model findings only — `source` beginning "agent " — and
# for one reason: a Track A failure is critical by definition and nothing may
# downgrade it (severity.md, gates.md, plans/03). Freezing used to record
# whatever it was handed, so `--freeze`, the documented day-one remedy, froze
# this repo's two standing `gate registry` criticals; they vanished from every
# later payload while .gates[] went on reporting `fail`, and report.sh printed
# `FAIL repo registry` under the header `PASS`. The freeze side now records
# only model findings, and the filter side drops only model findings — so an
# older baseline.json that already holds a deterministic fingerprint cannot
# silence it either. report.sh closes the same hole from the other end by
# reading .gates[].status directly.
#
# A red gate gets fixed, not frozen. The baseline exists for the sixteen
# pre-existing container.db calls in pulls/routes.ts, and those come from a
# subagent.
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

# `.findings` written by a model, or lost by a jq step upstream, can be null, a
# bare string, or absent. Every branch below checks it rather than iterating
# blind: under `set -e` a raised jq error costs the WHOLE payload, and the
# deterministic criticals are exactly what is sitting in it.
findings_ok=0
printf '%s' "$findings" | jq -e 'type == "array"' >/dev/null 2>&1 && findings_ok=1

if [ "${1:-}" = "--freeze" ]; then
  if [ "$findings_ok" -eq 0 ]; then
    # Writing a baseline from an unreadable payload would record a SHORTER
    # baseline than the run saw, and the baseline only ever shrinks. Refuse,
    # loudly, and leave any existing store untouched — nothing is dropped as a
    # result, which is the safe direction.
    printf 'baseline.sh --freeze: .findings is missing, null or not an array — nothing frozen.\n' >&2
    printf '  The step that produced this payload lost the findings array. Fix it and re-run;\n' >&2
    printf '  freezing what a truncated file merged to would record a baseline shorter than\n' >&2
    printf '  the run actually saw, and the baseline only ever shrinks.\n' >&2
    exit 0
  fi
  mkdir -p "$(dirname "$STORE")"
  # Model findings only. A deterministic one — a failed gate, a registry
  # inconsistency, a committed .env — is critical by definition; freezing it
  # is the C1 defect, not a remedy.
  printf '%s' "$findings" |
    jq 'map(select((((.source // "") | tostring) | startswith("agent "))) | {file, line, message})' >"$STORE"
  printf 'froze %s of %s findings into %s (model findings only; a deterministic one is fixed, not frozen)\n' \
    "$(jq length "$STORE")" "$(printf '%s' "$findings" | jq length)" "$STORE" >&2
  exit 0
fi

frozen='[]'
if [ -f "$STORE" ]; then
  frozen="$(cat "$STORE")"
  printf '%s' "$frozen" | jq -e 'type == "array"' >/dev/null 2>&1 || frozen='[]'
fi

# `.findings` unreadable: pass the value through untouched rather than
# inventing an empty array. An empty array here is indistinguishable from a
# clean run at every later station, and that is precisely how six defects in
# this feature's history became a `pass` from nothing. Handed a null, report.sh
# rule 6 records `incomplete`; handed a string, the same. Exit stays 0 — only
# gate.sh exits non-zero.
if [ "$findings_ok" -eq 0 ]; then
  printf 'baseline.sh: .findings is missing, null or not an array — passing it through\n' >&2
  printf '  unfiltered so the next station can refuse it. Fix the step that wrote it.\n' >&2
  printf '%s\n' "$findings"
  exit 0
fi

# `.scope.routed` is just as model-adjacent, and it used to be iterated blind:
# `{"scope":null}`, `{"scope":{}}`, `{"scope":{"routed":"x"}}` and a bare `null`
# each raised "Cannot iterate over null" and exited 5 with EMPTY stdout — one
# station upstream of the guard that catches this class. An empty $touched
# anchors nothing, so every model finding keeps its severity: the safe
# direction, since a demoted critical is the failure that matters.
if ! printf '%s' "$payload" | jq -e '(.scope | type) == "object" and (.scope.routed | type) == "array"' \
     >/dev/null 2>&1; then
  printf 'baseline.sh: .scope.routed is missing or not an array — nothing could be\n' >&2
  printf '  diff-anchored, so every finding keeps the severity it arrived with.\n' >&2
fi

printf '%s' "$payload" | jq \
  --argjson frozen "$frozen" '
  ( if (.scope | type) == "object" and (.scope.routed | type) == "array"
    then ( [ .scope.routed[]
             | select(type == "object")
             | { key:   ((.path // "") | tostring),
                 value: (if (.lines | type) == "array" then .lines else [] end) } ]
           | from_entries )
    else {} end ) as $touched
  | [ .findings[]
      | . as $f
      | ((((($f.source // "") | tostring) | startswith("agent "))) ) as $model
      | select(
          ( $model
            and ($frozen | any(.file == $f.file and .line == $f.line and .message == $f.message))
          ) | not
        )
      | if ($model | not) then
          .
        elif .line == 0 then
          .
        elif ($touched[(($f.file // "") | tostring)] // []) | index($f.line) then
          .
        else
          .severity = "note" | .anchored = false
        end
    ]'
