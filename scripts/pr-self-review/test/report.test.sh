#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
. "$HERE/lib.sh"
REPORT="$HERE/../report.sh"

payload() { # mode findings agents
  jq -n --arg m "$1" --argjson f "$2" --argjson a "$3" \
    '{mode:$m,
      scope: {branch:"feat/x", base:"aaaaaaa", head:"bbbbbbb", worktreeHash:"h",
              packages:["client"], routed:[{path:"client/src/a.tsx",domains:["frontend"],lines:[1]}],
              checklist:[], skipped:[{path:"client/pnpm-lock.yaml",reason:"lockfile"}], flagged:[]},
      gates: [{package:"client", name:"lint", status:"ok", detail:""}],
      findings: $f, agents: $a}'
}

crit='{"severity":"critical","source":"gate lint","file":"client/src/a.tsx","line":1,"message":"bad","fix":"pnpm lint --fix"}'

# --- a clean full run passes ---------------------------------------------------
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(payload full '[]' '[{"name":"frontend","status":"ok","files":1}]')" | bash "$REPORT")"
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'pass' 'no findings means pass'
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.mode' 'full' 'the mode is recorded'
assert_contains "$out" '0 critical' 'zero findings print as zero, not as silence'
assert_contains "$out" 'pnpm-lock.yaml' 'skipped files are always printed'
assert_contains "$out" '/code-review' 'the report says what it does not do'
rm -rf "$repo"

# --- a critical blocks ---------------------------------------------------------
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(payload full "[$crit]" '[{"name":"frontend","status":"ok","files":1}]')" | bash "$REPORT")"
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'blocked' 'a critical blocks'
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.counts.critical' '1' 'the count is recorded'
assert_contains "$out" 'pnpm lint --fix' 'every critical carries its fix line'
rm -rf "$repo"

# --- a crashed subagent forces incomplete, which also blocks -------------------
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(payload full '[]' '[{"name":"frontend","status":"failed","files":11}]')" | bash "$REPORT")"
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'incomplete' \
  'a failed agent is not a pass'
assert_contains "$out" '11 files unreviewed' 'and the unreviewed files are named'
rm -rf "$repo"

# --- a failed agent outranks a critical: incomplete, not blocked ---------------
# The whole point of the rule. If this ever resolves to "blocked", breaking a
# subagent becomes cheaper than fixing a finding.
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(payload full "[$crit]" '[{"name":"frontend","status":"failed","files":4}]')" | bash "$REPORT")"
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'incomplete' \
  'a failed agent outranks a critical finding'
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.counts.critical' '1' \
  'and the critical is still counted, not swallowed'
rm -rf "$repo"

# --- a gates run records its mode, so the PR hook can refuse it ----------------
repo="$(make_repo)"
( cd "$repo" && printf '%s' "$(payload gates '[]' '[]')" | bash "$REPORT" >/dev/null )
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.mode' 'gates' 'a gates run says so'
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'pass' \
  'an empty agent list is not incomplete in gates mode'
rm -rf "$repo"

# --- report.md is written beside the JSON --------------------------------------
repo="$(make_repo)"
( cd "$repo" && printf '%s' "$(payload full "[$crit]" '[]')" | bash "$REPORT" >/dev/null )
assert_eq "$([ -f "$repo/.pr-self-review/report.md" ] && printf yes || printf no)" yes \
  'report.md is written'
rm -rf "$repo"

# --- a payload missing .gates still exits 0 and still writes a report ----------
# .gates[] used to be the one unguarded iteration on the render path — a
# payload without it crashed under set -e and left report.md truncated with
# no marker that it was incomplete. Exit 2 is reserved for gate.sh alone.
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(payload full '[]' '[]')" | jq 'del(.gates)' | bash "$REPORT")"
code=$?
assert_eq "$code" '0' 'a payload missing .gates does not crash the script'
assert_eq "$([ -f "$repo/.pr-self-review/report.md" ] && printf yes || printf no)" yes \
  'the report is still written when .gates is missing'
rm -rf "$repo"

# --- rule 6: a payload with no findings array is incomplete, never pass --------
# The class guard. Three defects in this feature's history ended the same way:
# a jq step failed or a slurped file came back empty, `null` reached a `+`, jq
# took null as the identity, and an empty findings array produced `pass`. Every
# case below would have been a clean `pass` before this rule existed.
#
# .gates and .agents are checked too, because each alone can forge a pass:
# a null .gates reports PASS with an empty GATES section — no Track A at all —
# and a null or non-array .agents is swallowed by `.agents[]?`, so $broken is 0
# and a run whose crashed-subagent bookkeeping was lost reads clean, which
# defeats rule 4.
for missing in 'del(.findings)' '.findings = null' '.findings = {}' '.findings = "none"' \
               'del(.gates)'    '.gates = null'    '.gates = "x"' \
               'del(.agents)'   '.agents = null'   '.agents = "crashed"'; do
  repo="$(make_repo)"
  out="$(cd "$repo" && printf '%s' "$(payload full '[]' '[]')" | jq "$missing" | bash "$REPORT")"
  code=$?
  assert_eq "$code" '0' "[$missing] still exits 0"
  assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'incomplete' \
    "[$missing] is incomplete, not pass"
  assert_contains "$out" 'BROKEN INPUT' "[$missing] says so in the report"
  rm -rf "$repo"
done

# --- but an empty findings array is still a pass -------------------------------
# Rule 6 must not break the rule it sits next to: an empty report is a valid
# result here, and zero findings print as zero.
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(payload full '[]' '[]')" | bash "$REPORT")"
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'pass' \
  'an empty findings array is still a pass'
assert_contains "$out" '0 critical' 'and it still prints zero'
case "$out" in
  *'BROKEN INPUT'*) assert_eq 'marked broken' 'not marked' 'an empty array is not a broken input' ;;
  *)               assert_eq 'not marked' 'not marked' 'an empty array is not a broken input' ;;
esac
rm -rf "$repo"

# --- rule 6 on empty and unparseable stdin -------------------------------------
# The input rule 6 was written for, and the one its repair could not handle:
# `jq '.findings = []'` on empty stdin exits 0 printing nothing, so the repair
# handed back an empty payload and latest.json was written as a bare newline —
# 1 byte, not valid JSON, no verdict recorded. It failed safe only by accident,
# because gate.sh happens to refuse a corrupt verdict file.
for bad_stdin in '' 'not json at all' '[1,2,3]' 'null'; do
  repo="$(make_repo)"
  out="$(cd "$repo" && printf '%s' "$bad_stdin" | bash "$REPORT")"
  code=$?
  label="$([ -z "$bad_stdin" ] && printf '(empty)' || printf '%s' "$bad_stdin")"
  assert_eq "$code" '0' "[$label] still exits 0"
  assert_eq "$(jq -e . "$repo/.pr-self-review/latest.json" >/dev/null 2>&1 && printf yes || printf no)" \
    yes "[$label] writes valid JSON, not a bare newline"
  assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'incomplete' \
    "[$label] records incomplete"
  assert_contains "$out" 'BROKEN INPUT' "[$label] says so in the report"
  rm -rf "$repo"
done

# --- rule 6 overwrites a stale passing verdict rather than leaving it ----------
# Crashing would not be enough. gate.sh reads latest.json, and a pass from an
# earlier run over the same tree is still fresh — same headSha, same
# worktreeHash — so it would be honoured. The file must be rewritten.
repo="$(make_repo)"
( cd "$repo" && printf '%s' "$(payload full '[]' '[]')" | bash "$REPORT" >/dev/null )
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'pass' 'the earlier run passed'
( cd "$repo" && printf '%s' "$(payload full '[]' '[]')" | jq 'del(.findings)' | bash "$REPORT" >/dev/null )
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'incomplete' \
  'the broken run overwrites the stale pass'
rm -rf "$repo"

# --- a recorded bypass surfaces once, then is cleared --------------------------
repo="$(make_repo)"
mkdir -p "$repo/.pr-self-review"
printf '2026-08-02T10:00:00Z git push (verdict blocked)\n' >"$repo/.pr-self-review/bypassed"
out="$(cd "$repo" && printf '%s' "$(payload full '[]' '[]')" | bash "$REPORT")"
assert_contains "$out" 'BYPASSED' 'a bypass is reported on the next run'
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.bypassed | length' '1' \
  'and recorded in the verdict'
assert_eq "$([ -f "$repo/.pr-self-review/bypassed" ] && printf yes || printf no)" no \
  'the bypass log is consumed, so it is reported exactly once'
rm -rf "$repo"

finish
