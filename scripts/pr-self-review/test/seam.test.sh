#!/usr/bin/env bash
#
# The seam test: scope.sh -> gates.sh -> baseline.sh -> report.sh -> gate.sh,
# composed exactly as SKILL.md §3 composes them, over a real fixture repo.
#
# Every other file here tests one script against a hand-written fixture of what
# the previous one is believed to emit. That leaves every cross-script contract
# restated on both sides, so both sides can drift together and the suite stays
# green. Three contract-breaking mutations passed all 237 assertions at once:
#
#   1. scope.sh's `source:"gate scope"` -> "agent scope". Through the real
#      baseline.sh the committed-secret critical comes back
#      {"severity":"note","anchored":false} — that one string literal is the
#      single point of failure for every Tier-2 critical in the system.
#   2. report.sh's `headSha` / `worktreeHash` -> any other key. Those are the
#      two fields gate.sh reads for freshness, and gate.test.sh hand-writes
#      latest.json rather than producing it with report.sh.
#   3. gates.sh's `[ "$pkg" != "repo" ] &&` dropped. The vendor mirror gate
#      then reports `skip` on every branch and silently never runs.
#
# Only the model half — findings.json and agents.json — is fixture here,
# because no test can dispatch a subagent. Everything else is the real chain.
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
. "$HERE/lib.sh"
SCRIPTS="$HERE/.."

# A fake gate runner, as in gates.test.sh: exits 1 for anything in FAIL_LIST.
runner="$(mktemp)"
cat >"$runner" <<'RUNNER'
#!/usr/bin/env bash
case " ${FAIL_LIST:-} " in
  *" $2 "*) printf 'boom: %s failed\n' "$2"; exit 1 ;;
esac
printf 'ok\n'; exit 0
RUNNER
chmod +x "$runner"

# A branch with one pre-existing client component edited on line 2. The file
# must pre-date the branch, or every line counts as touched and the demotion
# assertion below means nothing.
fixture_repo() { # [with-secret] -> path
  local repo
  repo="$(make_repo)"
  printf '.pr-self-review/\n' >"$repo/.gitignore"
  mkdir -p "$repo/client/src"
  printf 'export const a = 1\nexport const b = 2\nexport const c = 3\n' >"$repo/client/src/a.tsx"
  sgit "$repo" add -A
  sgit "$repo" commit -qm "a.tsx predates the branch"
  sgit "$repo" checkout -qb feat/x
  printf 'export const a = 1\nexport const b = 22\nexport const c = 3\n' >"$repo/client/src/a.tsx"
  if [ "${1:-}" = with-secret ]; then
    printf 'OPENAI_API_KEY=sk-real\n' >"$repo/client/.env.local"
    sgit "$repo" add -Af client/.env.local
  fi
  sgit "$repo" add client/src/a.tsx
  sgit "$repo" commit -qm "edit line 2"
  printf '%s' "$repo"
}

# The five scripts, wired the way SKILL.md wires them. No shortcuts: the merge
# and render expressions are the ones in §3.5 and §3.6.
chain() { # repo mode findings-json agents-json [FAIL_LIST]
  local repo="$1" mode="$2" tmp
  tmp="$repo/.pr-self-review/run"
  mkdir -p "$tmp"
  printf '%s' "$3" >"$tmp/findings.json"
  printf '%s' "$4" >"$tmp/agents.json"
  (
    cd "$repo" || exit 1
    bash "$SCRIPTS/scope.sh" >"$tmp/scope.json" || exit 1
    FAIL_LIST="${5:-}" PR_SELF_REVIEW_RUNNER="$runner" \
      bash "$SCRIPTS/gates.sh" <"$tmp/scope.json" >"$tmp/gates.json" || exit 1

    jq -n --slurpfile s "$tmp/scope.json" --slurpfile g "$tmp/gates.json" \
          --slurpfile a "$tmp/findings.json" \
      '{ scope: $s[0], findings: ($s[0].flagged + $g[0].findings + $a[0]) }' \
      | bash "$SCRIPTS/baseline.sh" >"$tmp/final.json" || exit 1

    jq -n --slurpfile s "$tmp/scope.json" --slurpfile g "$tmp/gates.json" \
          --slurpfile f "$tmp/final.json" --slurpfile a "$tmp/agents.json" --arg mode "$mode" \
      '{mode: $mode, scope: $s[0], gates: $g[0].gates, findings: $f[0], agents: $a[0]}' \
      | bash "$SCRIPTS/report.sh" >/dev/null
  )
}

hook() { # repo command -> exit code
  local code
  printf '%s' "$(jq -n --arg c "$2" '{tool_name:"Bash", tool_input:{command:$c}}')" |
    ( cd "$1" && bash "$SCRIPTS/gate.sh" >/dev/null 2>&1 )
  code=$?
  printf '%s' "$code"
}

on_line() { # line severity -> one agent finding on client/src/a.tsx
  jq -nc --argjson l "$1" --arg s "$2" \
    '{severity:$s, source:"agent frontend · react-best-practices §Derive",
      file:"client/src/a.tsx", line:$l,
      message:("something at line " + ($l | tostring)), fix:"fix it"}'
}

# =============================================================================
# 1. The full case: a committed secret, a red gate, and two agent findings —
#    one on a touched line, one off it.
# =============================================================================
repo="$(fixture_repo with-secret)"
chain "$repo" full "[$(on_line 2 critical), $(on_line 99 critical)]" \
  '[{"name":"frontend","status":"ok","files":1},{"name":"security","status":"ok","files":1}]' \
  lint
latest="$(cat "$repo/.pr-self-review/latest.json")"

# Mutation 1. scope.sh emits `source:"gate scope"`, and that literal is the only
# thing telling baseline.sh this critical is a fact about the repo rather than a
# model's opinion about a line. Change it to "agent scope" and the real
# baseline.sh demotes a leaked secret to a note, because the path of a flagged
# file is deliberately never in .routed[].
assert_json "$latest" '[.findings[] | select(.file == "client/.env.local")] | length' '1' \
  'the committed secret reaches latest.json'
assert_json "$latest" '[.findings[] | select(.file == "client/.env.local")][0].severity' 'critical' \
  'still critical after the real baseline.sh — it was never a model opinion'
assert_json "$latest" '[.findings[] | select(.file == "client/.env.local")][0].source' 'gate scope' \
  'and it still carries the exact source literal baseline.sh keys on'
assert_json "$latest" '[.findings[] | select(.file == "client/.env.local")][0].anchored' 'null' \
  'so nothing marked it unanchored'

# Mutation 3. `repo` gates are not package-scoped. The diff here is client-only,
# so dropping the `[ "$pkg" != "repo" ]` guard makes the vendor mirror report
# `skip` — and it would report `skip` on every branch, since no diff contains a
# file under a package called `repo`.
assert_json "$latest" '[.gates[] | select(.package == "repo" and .name == "vendor")][0].status' 'ok' \
  'the vendor mirror gate ran on a client-only diff'
assert_json "$latest" '[.gates[] | select(.package == "repo" and .name == "registry")][0].status' 'ok' \
  'and so did the registry gate, resolved next to gates.sh'

# The model half, through the real baseline.sh.
assert_json "$latest" '[.findings[] | select(.line == 2 and (.source | startswith("agent ")))][0].severity' \
  'critical' 'an agent finding on a touched line keeps its severity'
assert_json "$latest" '[.findings[] | select(.line == 99)][0].severity' 'note' \
  'and one off the diff is demoted'
assert_json "$latest" '[.findings[] | select(.line == 99)][0].anchored' 'false' \
  'and marked unanchored'

# Track A, end to end.
assert_json "$latest" '[.gates[] | select(.name == "lint")][0].status' 'fail' 'the red gate is red'
assert_json "$latest" '.verdict' 'blocked' 'and the run is blocked'
assert_json "$latest" '.pushBlocked' 'true' 'with the push blocked, because Track A failed'
assert_json "$latest" '[.findings[] | select(.source == "gate lint")] | length' '1' \
  'the failed gate produced its finding'
assert_contains "$(cat "$repo/.pr-self-review/report.md")" 'FAIL' 'the report prints the failure'
assert_contains "$(cat "$repo/.pr-self-review/report.md")" 'BLOCKED' 'under a header that agrees with it'

# The override that forged Track A is recorded in the verdict it forged.
assert_json "$latest" '[.bypassed[] | select(contains("PR_SELF_REVIEW_RUNNER"))] | length' '1' \
  'the runner override is recorded in latest.json'

assert_eq "$(hook "$repo" 'git push')" '2' 'and the hook refuses the push'
assert_eq "$(hook "$repo" 'gh pr create')" '2' 'and the PR'
rm -rf "$repo"

# =============================================================================
# 2. The clean case. This is the producer/consumer pin: gate.sh reads .headSha
#    and .worktreeHash for freshness, and nothing else in the suite produces
#    those with report.sh. Rename either field and this push is refused as
#    stale.
# =============================================================================
repo="$(fixture_repo)"
chain "$repo" gates '[]' '[]'
latest="$(cat "$repo/.pr-self-review/latest.json")"

assert_json "$latest" '.verdict' 'pass' 'a clean chain run passes'
assert_json "$latest" '.headSha' "$(sgit "$repo" rev-parse HEAD)" \
  'latest.json records the HEAD gate.sh compares against'
assert_json "$latest" '.worktreeHash' \
  "$(cd "$repo" && bash "$SCRIPTS/scope.sh" | jq -r '.worktreeHash')" \
  'and the worktree hash gate.sh recomputes'
assert_eq "$(hook "$repo" 'git push')" '0' \
  'so the hook accepts a verdict this chain produced'
assert_eq "$(hook "$repo" 'gh pr create')" '2' 'and still refuses a PR on a gates run'

printf 'export const d = 4\n' >>"$repo/client/src/a.tsx"
assert_eq "$(hook "$repo" 'git push')" '2' 'one edit later, the same verdict is stale'
rm -rf "$repo"

# =============================================================================
# 3. The push/PR split, end to end: a Track B critical and nothing else.
# =============================================================================
repo="$(fixture_repo)"
chain "$repo" full "[$(on_line 2 critical)]" \
  '[{"name":"frontend","status":"ok","files":1},{"name":"security","status":"ok","files":1}]'
latest="$(cat "$repo/.pr-self-review/latest.json")"

assert_json "$latest" '.verdict' 'blocked' 'a surviving Track B critical blocks'
assert_json "$latest" '.pushBlocked' 'false' 'but only the PR half of it'
assert_eq "$(hook "$repo" 'git push')" '0' 'the push goes through'
assert_eq "$(hook "$repo" 'gh pr create')" '2' 'the PR does not'
rm -rf "$repo"

# =============================================================================
# 4. Coverage, end to end: the same run with the security agent forgotten.
# =============================================================================
repo="$(fixture_repo)"
chain "$repo" full "[$(on_line 2 minor)]" '[{"name":"frontend","status":"ok","files":1}]'
latest="$(cat "$repo/.pr-self-review/latest.json")"

assert_json "$latest" '.verdict' 'incomplete' \
  'a full run missing one domain agent is incomplete'
assert_json "$latest" '.uncovered | join(",")' 'security' 'and names the domain that was missed'
assert_eq "$(hook "$repo" 'git push')" '2' 'which blocks, like every incomplete run'
rm -rf "$repo"

rm -f "$runner"
finish
