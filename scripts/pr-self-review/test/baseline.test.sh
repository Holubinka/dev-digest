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

# --- a Tier-2 flag keeps its severity, though its path is never routed ---------
# The committed-.env case, and the one that matters most: scope.sh emits these
# at line 1 and `continue`s before routing, so the path can never be in
# .routed[]. Anchoring it made the verdict read `pass` on a leaked secret.
repo="$(make_repo)"
flag='{"severity":"critical","source":"gate scope","file":".env","line":1,"message":"a committed .env can only be a secret","fix":"git rm --cached .env"}'
out="$(cd "$repo" && printf '%s' "$(input "[$flag]")" | bash "$BASELINE")"
assert_json "$out" '.[0].severity' 'critical' 'a gate scope flag on an unrouted path still blocks'
assert_json "$out" '.[0].anchored' 'null' 'and it is not marked unanchored'
rm -rf "$repo"

# --- a registry finding keeps its severity, on a file no branch touches --------
repo="$(make_repo)"
reg='{"severity":"critical","source":"gate registry","file":"skills-lock.json","line":1,"message":"pins \"ghost\" but the directory does not exist","fix":"drop the entry"}'
out="$(cd "$repo" && printf '%s' "$(input "[$reg]")" | bash "$BASELINE")"
assert_json "$out" '.[0].severity' 'critical' 'a gate registry finding on an untouched file still blocks'
rm -rf "$repo"

# --- but a model finding off the diff is still demoted -------------------------
# The behaviour the baseline exists for. It must not regress: this is the
# sixteen pre-existing container.db calls the report would otherwise drown in.
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(input "[$(on_line 300 critical)]")" | bash "$BASELINE")"
assert_json "$out" '.[0].source' 'agent backend' 'the demoted finding is the model one'
assert_json "$out" '.[0].severity' 'note' 'an agent finding off the diff is still demoted'
assert_json "$out" '.[0].anchored' 'false' 'and still marked unanchored'
rm -rf "$repo"

# --- and a model finding on a touched line still keeps its severity ------------
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(input "[$(on_line 41 critical)]")" | bash "$BASELINE")"
assert_json "$out" '.[0].severity' 'critical' 'an agent finding on a changed line still blocks'
rm -rf "$repo"

# --- an unrecognised source is treated as deterministic ------------------------
# Pins the one soft edge of the rule: a subagent that drops the "agent "
# prefix its brief mandates gets its finding exempted from anchoring rather
# than demoted. That is the safe direction for a leaked secret and the unsafe
# one for report noise, so SKILL.md fixes the prefix in the output contract.
# If this ever fires in anger, fix the contract, not this assertion.
repo="$(make_repo)"
odd='{"severity":"major","source":"onion-architecture §3.2","file":"server/src/modules/pulls/routes.ts","line":300,"message":"unprefixed","fix":"x"}'
out="$(cd "$repo" && printf '%s' "$(input "[$odd]")" | bash "$BASELINE")"
assert_json "$out" '.[0].severity' 'major' 'a source with no "agent " prefix is not anchored'
rm -rf "$repo"

# --- a malformed model finding does not take the payload with it ---------------
# Half the findings are written by a model, so `source` can be absent or the
# wrong type. A bare startswith() raises "requires string inputs" and `set -e`
# then discards the whole array — including the deterministic .env critical
# sitting beside it. The array must survive, and so must the critical.
repo="$(make_repo)"
bad='{"severity":"major","file":"server/src/modules/pulls/routes.ts","line":300,"message":"no source key"}'
out="$(cd "$repo" && printf '%s' "$(input "[$bad,$flag]")" | bash "$BASELINE")"; code=$?
assert_eq "$code" 0 'a finding with no source does not abort the script'
assert_json "$out" 'length' '2' 'and the payload survives intact'
assert_json "$out" '[.[] | select(.file == ".env")][0].severity' 'critical' \
  'the deterministic critical beside it is not lost'
rm -rf "$repo"

repo="$(make_repo)"
odd_type='{"severity":"minor","source":42,"file":"server/src/modules/pulls/routes.ts","line":300,"message":"numeric source"}'
out="$(cd "$repo" && printf '%s' "$(input "[$odd_type]")" | bash "$BASELINE")"; code=$?
assert_eq "$code" 0 'a non-string source does not abort the script either'
assert_json "$out" '.[0].severity' 'minor' 'and it is treated as deterministic'
rm -rf "$repo"

# --- a frozen finding is dropped whatever produced it --------------------------
repo="$(make_repo)"
( cd "$repo" && printf '%s' "$(input "[$flag]")" | bash "$BASELINE" --freeze )
out="$(cd "$repo" && printf '%s' "$(input "[$flag]")" | bash "$BASELINE")"
assert_json "$out" 'length' '0' 'freezing still applies to a gate source'
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
