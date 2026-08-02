#!/usr/bin/env bash
#
# Renders the verdict. Writes .pr-self-review/latest.json for the hook and
# .pr-self-review/report.md for people, prints the short form, exits 0.
#
# Five rules the output obeys:
#   1. no finding without file:line and a source
#   2. every critical carries one concrete Fix: line
#   3. skipped files are always printed — a green report with no skipped
#      list is lying
#   4. a failed subagent is visible and forces `incomplete`, which blocks
#   5. the report states what it does not do: conventions, not correctness
#
# Zero findings print as zero. Inventing one so the run looks worthwhile is
# prohibited; INSIGHTS.md records that reviews here legitimately find nothing.
#
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
OUT=".pr-self-review"
mkdir -p "$OUT"

payload="$(cat)"
mode="$(printf '%s' "$payload" | jq -r '.mode')"

# gate.sh appends one line per bypass; a report consumes and clears them, so a
# bypass is reported exactly once, on the next run after it happened.
bypassed='[]'
[ -f "$OUT/bypassed" ] && bypassed="$(jq -R . "$OUT/bypassed" | jq -s .)"

latest="$(printf '%s' "$payload" | jq \
  --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson bypassed "$bypassed" '
  ( [.findings[] | select(.severity == "critical")] | length ) as $c
  | ( [.agents[]? | select(.status != "ok")] | length ) as $broken
  | {
      mode: .mode,
      verdict: (if $broken > 0 then "incomplete" elif $c > 0 then "blocked" else "pass" end),
      baseSha: .scope.base, headSha: .scope.head, worktreeHash: .scope.worktreeHash,
      branch: .scope.branch, generatedAt: $t,
      counts: {
        critical: $c,
        major: ([.findings[] | select(.severity == "major")] | length),
        minor: ([.findings[] | select(.severity == "minor")] | length),
        note:  ([.findings[] | select(.severity == "note")]  | length)
      },
      findings: .findings, gates: .gates,
      skipped: .scope.skipped, coverage: {agents: (.agents // [])},
      bypassed: $bypassed
    }')"

printf '%s\n' "$latest" >"$OUT/latest.json"
rm -f "$OUT/bypassed"

render() {
  local verdict counts
  verdict="$(printf '%s' "$latest" | jq -r '.verdict | ascii_upcase')"
  counts="$(printf '%s' "$latest" | jq -r \
    '"\(.counts.critical) critical · \(.counts.major) major · \(.counts.minor) minor"')"

  printf 'PR Self-Review — %s        %s\n' "$verdict" "$counts"
  printf '%s\n' "$(printf '%s' "$latest" | jq -r \
    '"base \(.baseSha[0:7]) → HEAD \(.headSha[0:7]) · branch \(.branch) · mode \(.mode)"')"
  printf '\nGATES\n'
  printf '%s' "$payload" | jq -r '.gates[]? |
    "  \(if .status == "ok" then "ok  " elif .status == "fail" then "FAIL" else "--  " end)  \(.package)  \(.name)  \(.detail)"'

  for sev in critical major minor note; do
    local n
    n="$(printf '%s' "$payload" | jq --arg s "$sev" '[.findings[]? | select(.severity == $s)] | length')"
    [ "$n" -eq 0 ] && continue
    printf '\n%s — %s\n' "$(printf '%s' "$sev" | tr '[:lower:]' '[:upper:]')" "$n"
    printf '%s' "$payload" | jq -r --arg s "$sev" '.findings[]? | select(.severity == $s) |
      "  \(.file):\(.line)  [\(.source)]\n     \(.message)" +
      (if .verifier then "\n     Verifier: \(.verifier)" else "" end) +
      (if .fix then "\n     Fix: \(.fix)" else "" end)'
  done

  printf '\nSKIPPED\n'
  printf '%s' "$payload" | jq -r '.scope.skipped[]? | "  \(.path) (\(.reason))"'
  printf '%s' "$payload" | jq -r '.agents[]? | select(.status != "ok") |
    "  \(.name) agent \(.status) — \(.files) files unreviewed"'

  if [ "$(printf '%s' "$latest" | jq '.bypassed | length')" -gt 0 ]; then
    printf '\nBYPASSED SINCE THE LAST REPORT\n'
    printf '%s' "$latest" | jq -r '.bypassed[] | "  " + .'
  fi

  printf '\nThis skill checks conventions, not correctness. For logic bugs run /code-review.\n'
}

# The verdict reaches the caller through latest.json and this text, never
# through this script's own exit code — exit 2 belongs exclusively to
# gate.sh, so a non-zero status from render or tee must not escape here.
render | tee "$OUT/report.md" || true
exit 0
