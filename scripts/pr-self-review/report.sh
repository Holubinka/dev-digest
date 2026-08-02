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
#   6. a payload that is not an object carrying three arrays — .findings,
#      .gates and .agents — is `incomplete`, never `pass`
#
# Rule 6 guards a whole class rather than one bug. The verdict is computed
# from those three keys, and everything upstream is a chain of jq steps over
# slurped files. Four separate defects in this feature's own history ended the
# same way: a step failed or a file came back empty, `null` reached a `+` or an
# iteration, jq absorbed it silently, and a `pass` was written from nothing.
# Guarding each site as it is found has lost every time. So the last station on
# the line refuses to call a payload it cannot read a clean run.
#
# All three keys, not just .findings, because each one alone can forge a pass:
#   .findings  null/absent — the original case
#   .gates     null — a 0-byte gates.json makes $g[0].gates null, and the run
#              reports PASS with an empty GATES section: no Track A at all
#   .agents    null or a non-array — `.agents[]?` swallows it, $broken is 0,
#              and a run whose crashed-subagent bookkeeping was lost reports
#              clean, defeating rule 4
#
# It is deliberately narrow: `.findings: []` is still `pass`, because an empty
# report is a legitimate result here and rule 6 must not break that. Only a
# missing, null, or non-array value trips it.
#
# Crashing instead would not do. A crash writes no latest.json, and if a
# PASSING verdict from an earlier run over the same tree is already on disk,
# gate.sh finds it fresh — same headSha, same worktreeHash — and allows the
# push. Overwriting it with `incomplete` is what actually blocks. That is why
# the empty-stdin case below is handled before the repair rather than by it:
# `jq '.findings = []'` on empty input exits 0 printing nothing, so the repair
# silently produced an empty payload and latest.json became a bare newline —
# no verdict recorded at all.
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

# --- rule 6: the input must be an object carrying three arrays --------------
# Checked before anything reads it, and repaired rather than fatal, so that
# every later step still runs and still writes a verdict — see the header.
STUB='{"mode":null,"scope":{},"findings":[],"gates":[],"agents":[]}'
input_ok=1

if [ -z "$payload" ] || ! printf '%s' "$payload" | jq -e 'type == "object"' >/dev/null 2>&1; then
  # Empty or unparseable stdin. Must be caught HERE: jq on empty input exits 0
  # printing nothing, so a repair expression would hand back an empty payload
  # and latest.json would be written as a bare newline — no verdict at all.
  input_ok=0
  payload="$STUB"
elif ! printf '%s' "$payload" | jq -e '
        (.findings | type) == "array"
    and (.gates    | type) == "array"
    and (.agents   | type) == "array"' >/dev/null 2>&1; then
  input_ok=0
  payload="$(printf '%s' "$payload" | jq '
      .findings = (if (.findings | type) == "array" then .findings else [] end)
    | .gates    = (if (.gates    | type) == "array" then .gates    else [] end)
    | .agents   = (if (.agents   | type) == "array" then .agents   else [] end)' 2>/dev/null)" ||
    payload="$STUB"
  [ -n "$payload" ] || payload="$STUB"
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
    printf '\nBROKEN INPUT — this script was not handed a readable payload.\n'
    printf '  It needs an object with .findings, .gates and .agents all arrays.\n'
    printf '  The counts and gates above are not a review result. Some step\n'
    printf '  between scope.sh and here failed or produced an empty file, so the\n'
    printf '  verdict is incomplete rather than pass. Re-run the review.\n'
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
