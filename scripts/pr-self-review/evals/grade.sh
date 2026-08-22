#!/usr/bin/env bash
#
# Grades a pr-self-review run against one fixture's answer key.
#
#   bash scripts/pr-self-review/evals/grade.sh <fixture-name> [path-to-report.json]
#
# Defaults to .pr-self-review/latest.json (report.sh's output — the same file gate.sh reads) —
# pass a second argument to grade something else instead, e.g. a fixture's own last-run.json to
# replay a past result without a live run. Reads
# .claude/skills/pr-self-review/eval-fixtures/fixtures/<name>/expected.json. For each expected finding,
# checks whether some finding in the report lands on the same file, at or above min_severity,
# with `message` containing at least one keyword (case-insensitive substring — grading a model's
# prose exactly would make the fixture brittle for no reason). Exits 1 if anything is missing,
# so this is CI-exit-code ready once the loop is wired to a real /pr-self-review run.
#
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

name="${1:?usage: grade.sh <fixture-name> [path-to-report.json]}"
expected=".claude/skills/pr-self-review/eval-fixtures/fixtures/$name/expected.json"
latest="${2:-.pr-self-review/latest.json}"

[ -f "$expected" ] || { echo "no such fixture: $expected" >&2; exit 1; }
[ -f "$latest" ] || { echo "$latest not found — run /pr-self-review --full first" >&2; exit 1; }

rank() { # severity -> ordinal, higher is worse
  case "$1" in
    critical) echo 3 ;;
    major)    echo 2 ;;
    minor)    echo 1 ;;
    note)     echo 0 ;;
    *)        echo -1 ;;
  esac
}

pass=0
fail=0

count="$(jq '.expected_findings | length' "$expected")"
for i in $(seq 0 $((count - 1))); do
  item="$(jq -c ".expected_findings[$i]" "$expected")"
  id="$(jq -r '.id' <<<"$item")"
  file="$(jq -r '.file' <<<"$item")"
  min_sev="$(jq -r '.min_severity' <<<"$item")"
  min_rank="$(rank "$min_sev")"
  keywords="$(jq -r '.keywords[]' <<<"$item")"

  hit=""
  while IFS= read -r finding; do
    [ -z "$finding" ] && continue
    f_file="$(jq -r '.file' <<<"$finding")"
    f_sev="$(jq -r '.severity' <<<"$finding")"
    f_msg="$(jq -r '.message' <<<"$finding" | tr '[:upper:]' '[:lower:]')"
    f_rank="$(rank "$f_sev")"

    case "$f_file" in
      *"$file")
        if [ "$f_rank" -ge "$min_rank" ]; then
          while IFS= read -r kw; do
            kw_lower="$(printf '%s' "$kw" | tr '[:upper:]' '[:lower:]')"
            case "$f_msg" in
              *"$kw_lower"*) hit="$f_sev" ;;
            esac
            [ -n "$hit" ] && break
          done <<<"$keywords"
        fi
        ;;
    esac
    [ -n "$hit" ] && break
  done < <(jq -c '.findings[]' "$latest")

  if [ -n "$hit" ]; then
    pass=$((pass + 1))
    printf '  ok   %-32s found as %s\n' "$id" "$hit"
  else
    fail=$((fail + 1))
    printf '  FAIL %-32s no finding on %s >= %s matching its keywords\n' "$id" "$file" "$min_sev"
  fi
done

printf '\n%s: %d/%d expected findings caught\n' "$name" "$pass" "$((pass + fail))"
[ "$fail" -eq 0 ]
