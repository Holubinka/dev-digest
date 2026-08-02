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

# What a real `full` run's bookkeeping looks like. The fixture routes one file,
# so a `full` payload needs a dispatched agent to be a pass at all — see the
# rule-4-second-half block below.
okagent='[{"name":"frontend","status":"ok","files":1}]'

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

# --- rule 7: a printed FAIL can never be a recorded pass -----------------------
# The C1 defect, in the shape it was measured in: a report printing
# `FAIL repo registry 2 inconsistent entries` under the header
# `PR Self-Review — PASS`, with `verdict: pass` on disk. The verdict was
# computed from .findings alone, and a finding is a droppable thing — `--freeze`
# had dropped these. A gate status is not droppable, so the verdict reads it.
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(payload gates '[]' '[]')" |
  jq '.gates = [{package:"repo",name:"registry",status:"fail",detail:"2 inconsistent entries"}]' |
  bash "$REPORT")"
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'blocked' \
  'a failed gate blocks even with no finding beside it'
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.pushBlocked' 'true' \
  'and it stops the push, because Track A is critical by definition'
assert_contains "$out" 'FAIL' 'the report still prints the failure'
rm -rf "$repo"

# --- the push/PR split: which critical stops which command ---------------------
# severity.md: a Track A critical stops `git push` AND `gh pr create`; a Track B
# critical stops only the PR. gate.sh refuses a PR on any non-pass verdict, so
# the verdict stays `blocked` for both and `pushBlocked` is what separates them.
# Track B's grading is not trustworthy enough to stop a push — the acceptance
# run had the security agent grade a real path traversal `minor`.
agentcrit='{"severity":"critical","source":"agent security · security §path traversal","file":"client/src/a.tsx","line":1,"message":"traversal","fix":"normalize the path"}'
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(payload full "[$agentcrit]" "$okagent")" | bash "$REPORT")"
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'blocked' \
  'a Track B critical still blocks the PR'
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.pushBlocked' 'false' \
  'but not the push'
assert_contains "$out" 'not `git push`' 'and the report says which command it stops'
rm -rf "$repo"

repo="$(make_repo)"
( cd "$repo" && printf '%s' "$(payload full "[$crit]" "$okagent")" | bash "$REPORT" >/dev/null )
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.pushBlocked' 'true' \
  'a gate-sourced critical stops the push too'
rm -rf "$repo"

repo="$(make_repo)"
scopeflag='{"severity":"critical","source":"gate scope","file":".env","line":1,"message":"a committed .env can only be a secret","fix":"git rm --cached .env"}'
( cd "$repo" && printf '%s' "$(payload full "[$scopeflag]" "$okagent")" | bash "$REPORT" >/dev/null )
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.pushBlocked' 'true' \
  'and so does a committed secret, which is deterministic too'
rm -rf "$repo"

repo="$(make_repo)"
( cd "$repo" && printf '%s' "$(payload full '[]' '[{"name":"frontend","status":"failed","files":2}]')" |
  bash "$REPORT" >/dev/null )
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.pushBlocked' 'true' \
  'an incomplete run stops the push whatever the findings say'
rm -rf "$repo"

# --- rule 4's third half: a full run whose roster is not what ran --------------
# SKILL.md called this hole unclosable. scope.json carries the Track B roster in
# .scope.routed[].domains, so a `full` run whose .agents[].name is not exactly
# that set reviewed some routed file with nobody, or recorded something else as
# coverage. It is the shape a real dispatch fails in: one of two agents
# forgotten, not zero agents.
#
# report.sh is domain-agnostic — it compares two sets of strings and never
# names an agent — so the names in these payloads are arbitrary. The real
# roster, `security` and `conventions`, meets this check in seam.test.sh, where
# scope.sh writes it and report.sh reads it back.
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(payload full '[]' "$okagent")" |
  jq '.scope.routed += [{path:"server/src/modules/x/routes.ts",domains:["backend","security"],lines:[1]}]' |
  bash "$REPORT")"
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'incomplete' \
  'a domain with routed files and no agent is not a pass'
assert_contains "$out" 'PARTIAL COVERAGE' 'and the report says so'
assert_contains "$out" 'backend' 'naming the domains that were never covered'
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.uncovered | sort | join(",")' \
  'backend,security' 'and recording them for the next run'
rm -rf "$repo"

repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(payload full '[]' "$okagent")" |
  jq '.scope.routed += [{path:"server/src/modules/x/routes.ts",domains:["backend"],lines:[1]}]
      | .agents += [{name:"backend",status:"ok",files:1}]' | bash "$REPORT")"
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'pass' \
  'every roster agent covered is a pass'
case "$out" in
  *'PARTIAL COVERAGE'*) assert_eq 'marked' 'not marked' 'full coverage is not a coverage gap' ;;
  *)                    assert_eq 'not marked' 'not marked' 'full coverage is not a coverage gap' ;;
esac
rm -rf "$repo"

repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(payload gates '[]' '[]')" | bash "$REPORT")"
case "$out" in
  *'PARTIAL COVERAGE'*) assert_eq 'marked' 'not marked' 'a gates run is never a coverage gap' ;;
  *)                    assert_eq 'not marked' 'not marked' 'a gates run is never a coverage gap' ;;
esac
rm -rf "$repo"

# The other side of the equality: an agent nobody asked for. A subset test
# passes this payload — every routed domain has an agent — and it is still a run
# whose agents[] does not describe what reviewed the diff, so the check is a set
# equality and this is the half that proves it.
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(payload full '[]' "$okagent")" |
  jq '.agents += [{name:"verifier",status:"ok",files:1}]' | bash "$REPORT")"
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'incomplete' \
  'an agent that is not on the roster is incomplete, not a pass'
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.unexpected | join(",")' 'verifier' \
  'and latest.json records which one'
assert_contains "$out" 'UNEXPECTED AGENT' 'and the report names it'
case "$out" in
  *'PARTIAL COVERAGE'*) assert_eq 'marked' 'not marked' 'without claiming anything was missed' ;;
  *)                    assert_eq 'not marked' 'not marked' 'without claiming anything was missed' ;;
esac
rm -rf "$repo"

# And the case the equality cannot decide: a diff that routed nothing. The
# roster is only ever written inside `.scope.routed[].domains`, so a docs-only
# branch has an EMPTY one — and `$ran - []` is then every agent that ran, while
# SKILL.md §3.3 says to record both of them unconditionally. Measured on a
# branch touching only `docs/a.md` and `scripts/x.sh`: `UNEXPECTED AGENT —
# agents[] records conventions, security`, verdict `incomplete`, push and PR
# both refused, and the diagnosis naming as strangers the two agents that ARE
# the roster. That is the shape of this feature's own documentation commits.
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(payload full '[]' \
  '[{"name":"security","status":"ok","files":0},{"name":"conventions","status":"ok","files":0}]')" |
  jq '.scope.routed = []' | bash "$REPORT")"
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'pass' \
  'a full run whose diff routed nothing passes, whatever agents[] recorded'
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.unexpected | length' '0' \
  'an empty roster calls no agent unexpected'
case "$out" in
  *'UNEXPECTED AGENT'*) assert_eq 'marked' 'not marked' 'and the report does not accuse the roster' ;;
  *)                    assert_eq 'not marked' 'not marked' 'and the report does not accuse the roster' ;;
esac
rm -rf "$repo"

# A gates run is exempt from both halves — Track B did not run, and saying so
# honestly in `mode` is the whole point of the mode.
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(payload gates '[]' '[{"name":"security","status":"ok","files":1}]')" |
  bash "$REPORT")"
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.unexpected | length' '0' \
  'a gates run is never an unexpected-agent gap'
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
# What this case pins is the exit-0-and-a-file-on-disk contract, which must
# hold for every input however broken: exit 2 is reserved for gate.sh alone,
# and the hook needs a verdict to read. It no longer pins anything about the
# render path it was written for — `.gates[]` was once the one unguarded
# iteration there, and a payload without it crashed under set -e — because the
# same input is now caught earlier, by rule 6, and recorded as `incomplete`.
# The loop below asserts that half.
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(payload full '[]' '[]')" | jq 'del(.gates)' | bash "$REPORT")"
code=$?
assert_eq "$code" '0' 'a payload missing .gates does not crash the script'
assert_eq "$([ -f "$repo/.pr-self-review/report.md" ] && printf yes || printf no)" yes \
  'the report is still written when .gates is missing'
rm -rf "$repo"

# --- rule 6: a payload the script cannot read is incomplete, never pass --------
# The class guard. Several defects in this feature's history ended the same
# way: a jq step failed or a slurped file came back empty, `null` reached a
# `+`, jq took null as the identity, and an empty findings array produced
# `pass`. Every case below would have been a clean `pass` before this rule
# existed — or worse, an exit 5 leaving an earlier `pass` on disk untouched.
#
# .gates, .agents and .scope are checked too, because each alone can forge a
# pass: a null .gates reports PASS with an empty GATES section — no Track A at
# all — a null or non-array .agents is swallowed by `.agents[]?`, so $broken is
# 0 and a run whose crashed-subagent bookkeeping was lost reads clean, which
# defeats rule 4; and a .scope that is null, {} or missing .skipped prints a
# green report with an EMPTY skipped list, which rule 3 calls lying.
#
# The ELEMENT shapes are the newest half, and the reason the container check
# was not enough. `["crashed"]` is an array, so it satisfied a container-only
# rule 6 and then raised `Cannot index string with "status"` in the jq that
# computes the verdict — no latest.json written at all, so a `pass` from an
# earlier run over the same tree survived and gate.sh honoured it. Both shapes
# are pinned here, "crashed" and ["crashed"], because they are one bracket
# apart and the bracketed one is worse.
for missing in 'del(.findings)' '.findings = null' '.findings = {}' '.findings = "none"' \
               '.findings = ["prose, not a finding"]' \
               'del(.gates)'    '.gates = null'    '.gates = "x"' \
               '.gates = ["lint blew up"]' \
               'del(.agents)'   '.agents = null'   '.agents = "crashed"' \
               '.agents = ["frontend crashed"]' \
               'del(.scope)'    '.scope = null'    '.scope = "nope"' \
               '.scope = {}'    '.scope = {"flagged":[]}' \
               '.scope.skipped = null' '.scope.skipped = "lockfile"' \
               '.scope.skipped = ["client/pnpm-lock.yaml"]' \
               'del(.scope.routed)' '.scope.routed = null' '.scope.routed = "a.tsx"' \
               '.scope.routed = ["client/src/a.tsx"]'; do
  # The base payload carries a dispatched agent so that rule 6 is the ONLY
  # reason any of these is incomplete — otherwise rule 4's second half would
  # answer for half the list and the assertions would stop discriminating.
  repo="$(make_repo)"
  out="$(cd "$repo" && printf '%s' "$(payload full '[]' "$okagent")" | jq "$missing" | bash "$REPORT")"
  code=$?
  assert_eq "$code" '0' "[$missing] still exits 0"
  assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'incomplete' \
    "[$missing] is incomplete, not pass"
  assert_contains "$out" 'BROKEN INPUT' "[$missing] says so in the report"
  rm -rf "$repo"
done

# --- rule 6, the severity vocabulary: a grade nothing counts is not a pass -----
# The last live member of the same defect class. The buckets are keyed by the
# four names, so a finding graded `"high"` is counted in none of them and
# printed in none of the four sections — it reached latest.json invisible and
# the run read `PASS  0 critical · 0 major · 0 minor`. Measured on exactly that
# payload, carrying a real path traversal. SKILL.md §3.3 states the consequence
# in prose; this is what enforces it. A subagent falling back on its own skill's
# CRITICAL/HIGH/MEDIUM vocabulary is the ordinary way it happens, and the
# acceptance run already had the security agent mis-grade a traversal.
for grade in '"high"' '"HIGH"' '"Critical"' '"blocker"' 'null' '5'; do
  repo="$(make_repo)"
  bad="$(jq -nc --argjson s "$grade" '{severity:$s, source:"agent security · security §path traversal",
          file:"client/src/a.tsx", line:1, message:"path traversal", fix:"normalize the path"}')"
  out="$(cd "$repo" && printf '%s' "$(payload full "[$bad]" "$okagent")" | bash "$REPORT")"
  code=$?
  assert_eq "$code" '0' "[severity $grade] still exits 0"
  assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'incomplete' \
    "[severity $grade] is incomplete, not pass"
  assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.pushBlocked' 'true' \
    "[severity $grade] stops the push, like every unreadable payload"
  assert_contains "$out" 'BROKEN INPUT' "[severity $grade] says so in the report"
  rm -rf "$repo"
done

# And the finding itself is not lost on the way. Dropping it would delete the
# defect the rule just caught; regrading it would invent the decision the
# payload failed to make. It is printed whole, under its own section.
repo="$(make_repo)"
highcrit='{"severity":"high","source":"agent security · security §path traversal","file":"client/src/a.tsx","line":1,"message":"path traversal","fix":"normalize the path"}'
out="$(cd "$repo" && printf '%s' "$(payload full "[$highcrit]" "$okagent")" | bash "$REPORT")"
assert_contains "$out" 'UNGRADED — 1' 'an ungraded finding gets a section of its own'
assert_contains "$out" 'path traversal' 'and its message is printed, not swallowed'
assert_contains "$out" 'normalize the path' 'with the fix line beside it'
assert_contains "$out" '"high"' 'and the grade nothing counts, named as the reason'
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.findings | length' '1' \
  'and it is still in latest.json, not dropped by the repair'
rm -rf "$repo"

# The other side of the vocabulary: all four names are readable, and a payload
# graded with any of them prints no UNGRADED section. Drop one from the list in
# report.sh and this fails — the vocabulary is exactly four.
for grade in critical major minor note; do
  repo="$(make_repo)"
  ok_f="$(jq -nc --arg s "$grade" '{severity:$s, source:"gate lint", file:"client/src/a.tsx",
          line:1, message:"m", fix:"f"}')"
  out="$(cd "$repo" && printf '%s' "$(payload full "[$ok_f]" "$okagent")" | bash "$REPORT")"
  case "$out" in
    *'BROKEN INPUT'*) assert_eq "$grade broken" "$grade readable" "[severity $grade] is a legal grade" ;;
    *)                assert_eq "$grade readable" "$grade readable" "[severity $grade] is a legal grade" ;;
  esac
  case "$out" in
    *'UNGRADED'*) assert_eq 'marked' 'not marked' "[severity $grade] needs no UNGRADED section" ;;
    *)            assert_eq 'not marked' 'not marked' "[severity $grade] needs no UNGRADED section" ;;
  esac
  rm -rf "$repo"
done

# --- but an empty findings array is still a pass -------------------------------
# Rule 6 must not break the rule it sits next to: an empty report is a valid
# result here, and zero findings print as zero.
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(payload full '[]' "$okagent")" | bash "$REPORT")"
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
# Crashing would not be enough — it is the whole failure. gate.sh reads
# latest.json, and a pass from an earlier run over the same tree is still
# fresh — same headSha, same worktreeHash — so it would be honoured. A
# report.sh that dies writes nothing and leaves that pass in place
# byte-identical. The file must be rewritten, which means the script must
# reach the end, which means it must not exit non-zero on the way.
for breakage in 'del(.findings)' '.agents = ["frontend crashed"]' '.scope = null'; do
  repo="$(make_repo)"
  ( cd "$repo" && printf '%s' "$(payload full '[]' "$okagent")" | bash "$REPORT" >/dev/null )
  assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'pass' \
    "[$breakage] the earlier run over the same tree passed"
  ( cd "$repo" && printf '%s' "$(payload full '[]' "$okagent")" | jq "$breakage" | bash "$REPORT" >/dev/null )
  assert_eq "$?" '0' "[$breakage] the broken run still exits 0, so it reaches the write"
  assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'incomplete' \
    "[$breakage] the broken run overwrites the stale pass"
  rm -rf "$repo"
done

# --- the repair drops what it cannot read and keeps the rest -------------------
# Rule 6 blocks either way, so the repair is free to be generous: an unreadable
# element must not take the well-formed findings beside it down with it. That
# is the same reasoning baseline.sh states for its own defensive guards.
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(payload full "[$crit, \"prose, not a finding\"]" \
  '["frontend crashed", {"name":"backend","status":"ok","files":2}]')" | bash "$REPORT")"
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'incomplete' \
  'a stray string anywhere makes the run incomplete'
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.counts.critical' '1' \
  'and the readable critical beside it is still counted'
assert_contains "$out" 'pnpm lint --fix' 'and still printed with its fix line'
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.coverage.agents | length' '1' \
  'the readable agent entry survives too'
rm -rf "$repo"

# --- rule 4's other half: a `full` run that dispatched no subagent -------------
# `mode: "full"` is the mode gate.sh requires for a PR, and gate.sh checks the
# mode and NOTHING about coverage — it never reads .coverage.agents. So a full
# run with an empty agents[] over routed files opens a PR on a review that ran
# Track A only. It became reachable when findings.json and agents.json started
# being seeded as [] before step 3: the same run used to die at step 5.
#
# All three combinations are pinned, because the rule has to be narrow. An
# empty agents[] is LEGITIMATE when routed[] is empty — a diff of nothing but
# lockfiles routes no file, and that run really did cover everything.
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(payload full '[]' '[]')" | bash "$REPORT")"
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'incomplete' \
  'full + no agent + routed files is not a pass'
assert_contains "$out" 'NO SUBAGENT RAN' 'and the report says so, loudly'
assert_contains "$out" '1 file(s)' 'and names how many files went unreviewed'
rm -rf "$repo"

repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(payload full '[]' '[]')" | jq '.scope.routed = []' | bash "$REPORT")"
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'pass' \
  'full + no agent + NO routed files is a legitimate pass'
case "$out" in
  *'NO SUBAGENT RAN'*) assert_eq 'marked' 'not marked' 'nothing to review is not a coverage gap' ;;
  *)                   assert_eq 'not marked' 'not marked' 'nothing to review is not a coverage gap' ;;
esac
rm -rf "$repo"

repo="$(make_repo)"
( cd "$repo" && printf '%s' "$(payload full '[]' "$okagent")" | bash "$REPORT" >/dev/null )
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'pass' \
  'full + a dispatched agent + routed files still passes'
rm -rf "$repo"

repo="$(make_repo)"
( cd "$repo" && printf '%s' "$(payload gates '[]' '[]')" | bash "$REPORT" >/dev/null )
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'pass' \
  'a gates run with no agent is untouched — that mode already means half a review'
rm -rf "$repo"

# --- an empty .scope.skipped is a real payload, not a broken one ---------------
# scope.sh initialises skipped to [] and only ever appends, so a branch that
# skipped nothing produces exactly this. The payload() fixture always carries
# one entry, so without this assertion a future tightening of rule 6 to
# `(.skipped | length) > 0 and all(...)` would silently block every clean
# small branch and no test would notice.
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(payload full '[]' "$okagent")" | jq '.scope.skipped = []' | bash "$REPORT")"
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'pass' \
  'an empty skipped list is a pass, not a broken input'
case "$out" in
  *'BROKEN INPUT'*) assert_eq 'marked broken' 'not marked' 'an empty skipped list is not broken input' ;;
  *)                assert_eq 'not marked' 'not marked' 'an empty skipped list is not broken input' ;;
esac
rm -rf "$repo"

# --- a recorded bypass surfaces once, then is cleared --------------------------
# The payload must be one that PASSES. A bypass surfacing under an incomplete
# or blocked verdict proves little — those already print several loud sections.
# The case worth pinning is the quiet one: the run is green, and the earlier
# bypass is still reported.
repo="$(make_repo)"
mkdir -p "$repo/.pr-self-review"
printf '2026-08-02T10:00:00Z git push (verdict blocked)\n' >"$repo/.pr-self-review/bypassed"
out="$(cd "$repo" && printf '%s' "$(payload full '[]' "$okagent")" | bash "$REPORT")"
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'pass' \
  'the run this bypass surfaces on is a passing one'
assert_contains "$out" 'BYPASSED' 'a bypass is reported on the next run'
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.bypassed | length' '1' \
  'and recorded in the verdict'
assert_eq "$([ -f "$repo/.pr-self-review/bypassed" ] && printf yes || printf no)" no \
  'the bypass log is consumed, so it is reported exactly once'
rm -rf "$repo"

finish
