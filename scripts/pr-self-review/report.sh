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
#   4. a subagent that failed — or that a `full` run never dispatched over
#      routed files at all — is visible and forces `incomplete`, which blocks
#   5. the report states what it does not do: conventions, not correctness
#   6. a payload the script cannot read — anything but an object whose
#      .scope is an object and whose .findings, .gates, .agents and
#      .scope.skipped are arrays of objects — is `incomplete`, never `pass`
#
# Rule 6 guards a whole class rather than one bug. The verdict is computed
# from those keys, and everything upstream is a chain of jq steps over slurped
# files written partly by a model. Six separate defects in this feature's own
# history ended the same way: a step failed or a file came back empty, `null`
# or a bare string reached a `+`, an iteration or a `.status` read, and a
# `pass` was written from nothing. Guarding each site as it is found has lost
# every time. So the last station on the line refuses to call a payload it
# cannot read a clean run.
#
# Every key it reads, not just .findings, because each one alone can forge a
# pass:
#   .findings  null/absent — the original case
#   .gates     null — a 0-byte gates.json makes $g[0].gates null, and the run
#              reports PASS with an empty GATES section: no Track A at all
#   .agents    null or a non-array — `.agents[]?` swallows it, $broken is 0,
#              and a run whose crashed-subagent bookkeeping was lost reports
#              clean, defeating rule 4
#   .scope     null, {} or any object without .skipped — every field of the
#              header comes back null and the SKIPPED section prints EMPTY on
#              a green report, which is exactly what rule 3 calls lying
#
# The ELEMENTS are checked too, not only the container, and that half is the
# newest. `{"agents":["frontend crashed"]}` is an array, so a container-only
# rule 6 waved it through; `[.agents[]? | select(.status != "ok")]` then raised
# `Cannot index string with "status"`, the jq computing the verdict died under
# set -e, and NO latest.json was written — leaving a PASSING verdict from an
# earlier run over the same tree on disk byte-identical, same headSha, same
# worktreeHash, which gate.sh honours. `{"findings":["prose"]}` is the same
# hole one bracket away; a string in .gates loses the whole GATES section
# instead. agents.json and findings.json are written freehand by a model, so a
# bare string where an object belongs is an ordinary slip, not an exotic input.
#
# It is deliberately narrow: `.findings: []` is still `pass`, because an empty
# report is a legitimate result here and rule 6 must not break that. Only a
# missing, null, non-array or non-object-element value trips it.
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
# Rule 4 has a second half for the same reason rule 6 exists at all. A payload
# saying `mode: "full"` with an EMPTY .agents over a NON-EMPTY .scope.routed is
# a run that reviewed no file with a subagent and then claimed the mode a PR
# requires. gate.sh checks `mode != full` and nothing else — it never reads
# .coverage.agents — so such a verdict opens a PR on a review that ran Track A
# only. The path is ordinary rather than exotic: seeding findings.json and
# agents.json as `[]` before step 3 (which is what lets a --gates run reach the
# report at all) means a full run whose step 3 was skipped or never dispatched
# now sails through where it used to die.
#
# The rule is narrow on purpose. An empty .agents is LEGITIMATE when there was
# nothing to review — a diff of nothing but lockfiles routes no file, and that
# run is a real `full` pass. Only routed files unreviewed by any agent trips
# it, and `mode: "gates"` never does: that mode already means "enough for a
# push, not enough for a PR", which is exactly what this run is.
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

# --- rule 6: the input must be an object the script can actually read -------
# Checked before anything reads it, and repaired rather than fatal, so that
# every later step still runs and still writes a verdict — see the header.
STUB='{"mode":null,"scope":{"skipped":[]},"findings":[],"gates":[],"agents":[]}'
input_ok=1

if [ -z "$payload" ] || ! printf '%s' "$payload" | jq -e 'type == "object"' >/dev/null 2>&1; then
  # Empty or unparseable stdin. Must be caught HERE: jq on empty input exits 0
  # printing nothing, so a repair expression would hand back an empty payload
  # and latest.json would be written as a bare newline — no verdict at all.
  input_ok=0
  payload="$STUB"
elif ! printf '%s' "$payload" | jq -e '
      def arr_of_obj: if type == "array" then all(type == "object") else false end;
        (.findings | arr_of_obj)
    and (.gates    | arr_of_obj)
    and (.agents   | arr_of_obj)
    and (if (.scope | type) == "object"
         then (.scope.skipped | arr_of_obj) else false end)' >/dev/null 2>&1; then
  # Each branch is written `if … else … end` rather than leaning on jq's
  # short-circuiting `and`, so that a non-array never reaches `all` and a
  # non-object .scope never reaches `.scope.skipped`. A predicate that raises
  # is a predicate that cannot report.
  input_ok=0
  payload="$(printf '%s' "$payload" | jq '
      def objs: if type == "array" then [ .[] | select(type == "object") ] else [] end;
      .findings |= objs
    | .gates    |= objs
    | .agents   |= objs
    | .scope    = (if (.scope | type) == "object" then .scope else {} end)
    | .scope.skipped |= objs' 2>/dev/null)" ||
    payload="$STUB"
  [ -n "$payload" ] || payload="$STUB"
  # The repair keeps every element it can read and drops only the ones it
  # cannot, so a well-formed critical sitting beside a stray string is still
  # printed. It can never turn the run green: input_ok is already 0.
fi

# --- rule 4, second half: a `full` run that dispatched nothing --------------
# Evaluated only on a readable payload: a repaired .agents is empty for a
# reason BROKEN INPUT already explains, and stacking two banners would blame
# the wrong step.
unrun=0
routed_n=0
if [ "$input_ok" -eq 1 ]; then
  routed_n="$(printf '%s' "$payload" | jq '.scope.routed | length' 2>/dev/null)" || routed_n=0
  [ -n "$routed_n" ] || routed_n=0
  if printf '%s' "$payload" | jq -e '
        .mode == "full"
    and (.agents | length) == 0
    and (.scope.routed | length) > 0' >/dev/null 2>&1; then
    unrun=1
  fi
fi

# gate.sh appends one line per bypass; a report consumes and clears them, so a
# bypass is reported exactly once, on the next run after it happened.
bypassed='[]'
[ -f "$OUT/bypassed" ] && bypassed="$(jq -R . "$OUT/bypassed" | jq -s .)"

latest="$(printf '%s' "$payload" | jq \
  --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson bypassed "$bypassed" \
  --argjson inputOk "$input_ok" --argjson unrun "$unrun" '
  ( [.findings[] | select(.severity == "critical")] | length ) as $c
  | ( [.agents[]? | select(.status != "ok")] | length ) as $broken
  | {
      mode: .mode,
      verdict: (if $inputOk == 0 or $broken > 0 or $unrun == 1 then "incomplete"
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
    printf '  It needs an object whose .scope is an object and whose .findings,\n'
    printf '  .gates, .agents and .scope.skipped are each an array of objects.\n'
    printf '  Anything it could not read has been dropped from the sections below.\n'
    printf '  The counts and gates above are not a review result. Some step\n'
    printf '  between scope.sh and here failed or produced an empty file, so the\n'
    printf '  verdict is incomplete rather than pass. Re-run the review.\n'
  fi

  # Rule 4's other half. Also loud, and for the same reason: the counts are a
  # true summary of Track A and say nothing at all about the half that is
  # missing.
  if [ "$unrun" -eq 1 ]; then
    printf '\nNO SUBAGENT RAN — mode is "full", but agents[] is empty and the diff\n'
    printf '  routed %s file(s) for review. A full run means both tracks covered the\n' "$routed_n"
    printf '  whole diff; this one covered Track A only, so the verdict is incomplete\n'
    printf '  rather than pass. Either dispatch step 3 and re-run, or record the run\n'
    printf '  honestly as mode "gates" — enough for a push, not enough for a PR.\n'
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
