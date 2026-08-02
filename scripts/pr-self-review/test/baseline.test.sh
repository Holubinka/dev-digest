#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
. "$HERE/lib.sh"
BASELINE="$HERE/../baseline.sh"

input() { # findings-json -> {scope, findings} with one file changed on lines 40,41
  jq -n --argjson f "$1" \
    '{scope: {routed: [{path:"server/src/modules/pulls/routes.ts",
                        domains:["backend"], lines:[40,41]}],
              checklist: [], skipped: [], flagged: []},
      findings: $f}'
}

on_line() { # line severity -> one finding
  jq -n --argjson l "$1" --arg s "$2" \
    '{severity:$s, source:"agent backend", file:"server/src/modules/pulls/routes.ts",
      line:$l, message:("container.db at line " + ($l | tostring)), fix:"move it"}'
}

# --- a finding on a changed line survives at full severity ---------------------
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(input "[$(on_line 40 critical)]")" | bash "$BASELINE")"
assert_json "$out" 'length' '1' 'the finding survives'
assert_json "$out" '.[0].severity' 'critical' 'a finding on a changed line keeps its severity'
rm -rf "$repo"

# --- a finding on an untouched line is demoted, not dropped --------------------
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(input "[$(on_line 300 critical)]")" | bash "$BASELINE")"
assert_json "$out" 'length' '1' 'the pre-existing finding is still visible'
assert_json "$out" '.[0].severity' 'note' 'a finding off the diff cannot block'
assert_json "$out" '.[0].anchored' 'false' 'and it is marked unanchored'
rm -rf "$repo"

# --- a whole-package gate failure is never demoted -----------------------------
repo="$(make_repo)"
gate='{"severity":"critical","source":"gate lint","file":"client","line":0,"message":"2 errors","fix":"pnpm lint"}'
out="$(cd "$repo" && printf '%s' "$(input "[$gate]")" | bash "$BASELINE")"
assert_json "$out" '.[0].severity' 'critical' 'a line-0 finding is exempt from anchoring'
rm -rf "$repo"

# --- --freeze writes the baseline ----------------------------------------------
repo="$(make_repo)"
( cd "$repo" && printf '%s' "$(input "[$(on_line 40 critical)]")" | bash "$BASELINE" --freeze )
assert_eq "$([ -f "$repo/.pr-self-review/baseline.json" ] && printf yes || printf no)" yes \
  '--freeze creates the baseline file'
assert_json "$(cat "$repo/.pr-self-review/baseline.json")" 'length' '1' 'and records the finding'
rm -rf "$repo"

# --- a frozen finding is dropped entirely --------------------------------------
repo="$(make_repo)"
( cd "$repo" && printf '%s' "$(input "[$(on_line 40 critical)]")" | bash "$BASELINE" --freeze )
out="$(cd "$repo" && printf '%s' "$(input "[$(on_line 40 critical)]")" | bash "$BASELINE")"
assert_json "$out" 'length' '0' 'a frozen finding does not come back'
rm -rf "$repo"

# --- a new finding on the same file still reports ------------------------------
repo="$(make_repo)"
( cd "$repo" && printf '%s' "$(input "[$(on_line 40 critical)]")" | bash "$BASELINE" --freeze )
out="$(cd "$repo" && printf '%s' "$(input "[$(on_line 41 critical)]")" | bash "$BASELINE")"
assert_json "$out" 'length' '1' 'freezing one line does not silence its neighbour'
assert_json "$out" '.[0].severity' 'critical' 'and the new one still blocks'
rm -rf "$repo"

finish
