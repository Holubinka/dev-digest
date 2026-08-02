#!/usr/bin/env bash
#
# Renders the verdict. Writes .pr-self-review/latest.json for the hook and
# .pr-self-review/report.md for people, prints the short form, exits 0.
#
# Six rules the output obeys:
#   1. no finding without file:line and a source
#   2. every critical carries one concrete Fix: line
#   3. skipped files are always printed — a green report with no skipped
#      list is lying
#   4. a failed subagent is visible and forces `incomplete`, which blocks
#   5. the report states what it does not do: conventions, not correctness
#   6. a payload with no usable `.findings` array is `incomplete`, never `pass`
#
# Rule 6 guards a whole class rather than one bug. The verdict is computed
# from .findings, and everything upstream is a chain of jq steps over slurped
# files. Three separate defects in this feature's own history ended the same
# way: a step failed or a file came back empty, `null` reached a `+`, jq took
# null as the identity for it, and an empty findings array produced `pass`.
# Guarding each site as it is found has lost three times. So the last station
# on the line refuses to call a payload it cannot read a clean run.
#
# It is deliberately narrow: `.findings: []` is still `pass`, because an empty
# report is a legitimate result here and rule 6 must not break that. Only an
# absent, null, or non-array `.findings` trips it.
#
# Crashing instead would not do. A crash writes no latest.json, and if a
# PASSING verdict from an earlier run over the same tree is already on disk,
# gate.sh finds it fresh — same headSha, same worktreeHash — and allows the
# push. Overwriting it with `incomplete` is what actually blocks.
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

# --- rule 6: the input must carry a findings array --------------------------
# Checked before anything reads it, and repaired rather than fatal, so that
# every later step still runs and still writes a verdict — see the header.
input_ok=1
if ! printf '%s' "$payload" | jq -e '(.findings | type) == "array"' >/dev/null 2>&1; then
  input_ok=0
  payload="$(printf '%s' "$payload" | jq '.findings = []' 2>/dev/null)" ||
    payload='{"mode":null,"findings":[]}'
fi

# gate.sh appends one line per bypass; a report consumes and clears them, so a
# bypass is reported exactly once, on the next run after it happened.
bypassed='[]'
[ -f "$OUT/bypassed" ] && bypassed="$(jq -R . "$OUT/bypassed" | jq -s .)"

latest="$(printf '%s' "$payload" | jq \
  --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson bypassed "$bypassed" \
  --argjson inputOk "$input_ok" '
  ( [.findings[] | select(.severity == "critical")] | length ) as $c
  | ( [.agents[]? | select(.status != "ok")] | length ) as $broken
  | {
      mode: .mode,
      verdict: (if $inputOk == 0 or $broken > 0 then "incomplete"
                elif $c > 0 then "blocked"
                else "pass" end),
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

  # Rule 6. Loud, and above the gates: this is not a review result, it is a
  # broken pipeline, and the counts printed on the line above mean nothing.
  if [ "$input_ok" -eq 0 ]; then
    printf '\nBROKEN INPUT — no findings array reached this script.\n'
    printf '  The counts above are not a review result. Some step between\n'
    printf '  scope.sh and here failed or produced an empty file, so the verdict\n'
    printf '  is incomplete rather than pass. Re-run the review.\n'
  fi

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
