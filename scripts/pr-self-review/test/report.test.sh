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
