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

# `file` is written by the same model as `source`, and $touched[.file] raises
# "Cannot index object with null" on a missing key and "... with number" on a
# non-string. Same blast radius: the whole payload, deterministic criticals
# included.
repo="$(make_repo)"
nofile='{"severity":"major","source":"agent backend · onion-architecture §3.2","line":300,"message":"no file key"}'
out="$(cd "$repo" && printf '%s' "$(input "[$nofile,$flag]")" | bash "$BASELINE")"; code=$?
assert_eq "$code" 0 'a finding with no file does not abort the script'
assert_json "$out" 'length' '2' 'and the payload survives intact'
assert_json "$out" '[.[] | select(.file == ".env")][0].severity' 'critical' \
  'the deterministic critical beside it is not lost'
assert_json "$out" '[.[] | select(.message == "no file key")][0].severity' 'note' \
  'the fileless model finding matches no touched path, so it is demoted'
rm -rf "$repo"

repo="$(make_repo)"
numfile='{"severity":"major","source":"agent backend · x","file":42,"line":300,"message":"numeric file"}'
out="$(cd "$repo" && printf '%s' "$(input "[$numfile,$flag]")" | bash "$BASELINE")"; code=$?
assert_eq "$code" 0 'a non-string file does not abort the script either'
assert_json "$out" 'length' '2' 'and that payload survives too'
rm -rf "$repo"

repo="$(make_repo)"
odd_type='{"severity":"minor","source":42,"file":"server/src/modules/pulls/routes.ts","line":300,"message":"numeric source"}'
out="$(cd "$repo" && printf '%s' "$(input "[$odd_type]")" | bash "$BASELINE")"; code=$?
assert_eq "$code" 0 'a non-string source does not abort the script either'
assert_json "$out" '.[0].severity' 'minor' 'and it is treated as deterministic'
rm -rf "$repo"

# --- a deterministic finding cannot be frozen, from either side ----------------
# The C1 defect. `--freeze` is the documented day-one remedy, and it used to
# freeze whatever it was handed — so freezing this repo's two standing
# `gate registry` criticals dropped them from every later payload while
# .gates[] went on reporting `fail`, and report.sh printed
# `FAIL repo registry 2 inconsistent entries` under the header `PASS`.
# A Track A failure is critical by definition; a red gate is fixed, not frozen.
#
# Both halves are pinned: the freeze records nothing, AND a store that already
# holds the fingerprint (written by an older freeze, or by hand) cannot drop it
# either.
repo="$(make_repo)"
( cd "$repo" && printf '%s' "$(input "[$flag]")" | bash "$BASELINE" --freeze 2>/dev/null )
assert_json "$(cat "$repo/.pr-self-review/baseline.json")" 'length' '0' \
  '--freeze records no deterministic finding'
out="$(cd "$repo" && printf '%s' "$(input "[$flag]")" | bash "$BASELINE")"
assert_json "$out" 'length' '1' 'and the committed-.env critical survives the freeze'
assert_json "$out" '.[0].severity' 'critical' 'at full severity'
rm -rf "$repo"

repo="$(make_repo)"
mkdir -p "$repo/.pr-self-review"
printf '[{"file":".env","line":1,"message":"a committed .env can only be a secret"}]' \
  >"$repo/.pr-self-review/baseline.json"
out="$(cd "$repo" && printf '%s' "$(input "[$flag]")" | bash "$BASELINE")"
assert_json "$out" 'length' '1' 'a pre-existing baseline entry cannot silence a deterministic finding'
assert_json "$out" '.[0].severity' 'critical' 'and it still blocks'
rm -rf "$repo"

# --- a broken payload is passed through, never turned into a clean [] ----------
# baseline.sh:68 iterated .scope.routed blind: {"scope":null}, {"scope":{}},
# {"scope":{"routed":"x"}} and a bare null each raised "Cannot iterate over
# null" and exited 5 with EMPTY stdout — one station upstream of the guard that
# catches this class. Emitting `[]` here would be worse than the crash: an
# empty array is indistinguishable from a clean run at every later station.
# So a findings array that survives is filtered but unanchored, and a findings
# value that does not is handed on as-is for report.sh rule 6 to refuse.
repo="$(make_repo)"
for broken in '{"scope":null,"findings":[FLAG]}' '{"scope":{},"findings":[FLAG]}' \
              '{"scope":{"routed":"x"},"findings":[FLAG]}'; do
  payload="${broken/FLAG/$flag}"
  out="$(cd "$repo" && printf '%s' "$payload" | bash "$BASELINE" 2>/dev/null)"; code=$?
  assert_eq "$code" '0' "[$broken] does not crash baseline.sh"
  assert_json "$out" 'length' '1' "[$broken] keeps the finding it was given"
  assert_json "$out" '.[0].severity' 'critical' "[$broken] keeps it at full severity"
done
rm -rf "$repo"

repo="$(make_repo)"
for broken in 'null' '{"scope":{"routed":[]}}' '{"scope":{"routed":[]},"findings":null}' \
              '{"scope":{"routed":[]},"findings":"lost"}'; do
  out="$(cd "$repo" && printf '%s' "$broken" | bash "$BASELINE" 2>/dev/null)"; code=$?
  assert_eq "$code" '0' "[$broken] does not crash baseline.sh"
  assert_eq "$(printf '%s' "$out" | jq -r 'if type == "array" then "an array" else "not an array" end')" \
    'not an array' "[$broken] hands the unreadable value on rather than inventing []"
done
rm -rf "$repo"

# --- and a freeze on a broken payload writes nothing at all --------------------
# The baseline only ever shrinks, so recording one from a truncated payload is
# unrecoverable. modes.md guards this before the call; this is the second lock.
repo="$(make_repo)"
( cd "$repo" && printf '%s' '{"scope":{"routed":[]},"findings":null}' | bash "$BASELINE" --freeze 2>/dev/null )
assert_eq "$([ -f "$repo/.pr-self-review/baseline.json" ] && printf yes || printf no)" no \
  'a freeze on an unreadable payload records no baseline'
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
