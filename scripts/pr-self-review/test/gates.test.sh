#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
. "$HERE/lib.sh"
GATES="$HERE/../gates.sh"

# A fake runner: exits 1 for anything named in FAIL_LIST, 0 otherwise.
runner="$(mktemp)"
cat >"$runner" <<'RUNNER'
#!/usr/bin/env bash
# args: <package> <gate-name>
case " ${FAIL_LIST:-} " in
  *" $2 "*) printf 'boom: %s failed\n' "$2"; exit 1 ;;
esac
printf 'ok\n'; exit 0
RUNNER
chmod +x "$runner"

scope_json() { jq -n --argjson p "$1" '{packages:$p, routed:[], checklist:[], skipped:[], flagged:[]}'; }

# Every run happens inside a throwaway repo, like every other file in this
# suite. This one used to run in the developer's own checkout — the only file
# that did — and that is exactly why nobody noticed gates.sh resolving
# registry.sh through the REVIEWED repo's root instead of its own directory.
# Run from any other repository the script died `exit 127` under `set -e` with
# zero output, losing all of Track A, and this file went 0 passed, 11 failed
# while CI's comment claimed the suite was hermetic.
run_gates() { # scope-json [FAIL_LIST] -> gates.sh output
  local repo out
  repo="$(make_repo)"
  out="$(cd "$repo" && printf '%s' "$1" |
    FAIL_LIST="${2:-}" PR_SELF_REVIEW_RUNNER="$runner" bash "$GATES")"
  rm -rf "$repo"
  printf '%s' "$out"
}

# --- only the packages in scope are gated --------------------------------------
out="$(run_gates "$(scope_json '["client"]')")"
assert_json "$out" '[.gates[] | select(.package == "server" and .status != "skip")] | length' '0' \
  'server gates do not run for a client-only diff'
assert_json "$out" '[.gates[] | select(.package == "server")][0].status' 'skip' \
  'a skipped gate is still reported'
assert_json "$out" '[.gates[] | select(.package == "client" and .name == "lint")][0].status' 'ok' \
  'the client lint gate runs'

# --- the registry gate always runs, package or not -----------------------------
assert_json "$out" '[.gates[] | select(.name == "registry")] | length' '1' \
  'the registry gate is not package-scoped'

# --- and neither is the vendor mirror ------------------------------------------
# `repo` gates run whatever is in .packages. Drop the `[ "$pkg" != "repo" ] &&`
# from gates.sh and this gate reports `skip` on every branch — no diff ever
# contains a file under a package called `repo` — so the one gate that catches
# one-sided drift between the two vendor/shared copies silently never runs.
# The mutation passed the whole suite before this assertion existed.
assert_json "$out" '[.gates[] | select(.package == "repo" and .name == "vendor")][0].status' 'ok' \
  'the vendor mirror gate runs on a client-only diff'

# --- a failing gate produces exactly one critical, anchored to no line ----------
out="$(run_gates "$(scope_json '["client"]')" lint)"
assert_json "$out" '[.gates[] | select(.name == "lint")][0].status' 'fail' 'lint reports fail'
assert_json "$out" '[.findings[] | select(.source == "gate lint")] | length' '1' \
  'a failing gate yields one finding'
assert_json "$out" '[.findings[] | select(.source == "gate lint")][0].severity' 'critical' \
  'a Track A failure is critical by definition'
assert_json "$out" '[.findings[] | select(.source == "gate lint")][0].line' '0' \
  'a whole-package failure is anchored to no line'
assert_contains "$(printf '%s' "$out" | jq -r '[.findings[] | select(.source == "gate lint")][0].fix')" \
  'pnpm lint' 'the finding carries the command that reproduces it'

# --- integration tests are never a gate ----------------------------------------
out="$(run_gates "$(scope_json '["server"]')")"
assert_json "$out" '[.gates[] | select(.name | test("it.test|integration"))] | length' '0' \
  'integration tests stay in CI'

# --- gates.sh exits 0 even when a gate fails -----------------------------------
repo="$(make_repo)"
( cd "$repo" && printf '%s' "$(scope_json '["client"]')" |
  FAIL_LIST="lint typecheck" PR_SELF_REVIEW_RUNNER="$runner" bash "$GATES" >/dev/null )
assert_eq "$?" '0' 'gates.sh leaves the verdict to the caller'

# --- the runner override is recorded, not silent -------------------------------
# PR_SELF_REVIEW_RUNNER=/usr/bin/true turns all nine package gates green. That
# is a bypass whatever it was meant for, so it lands in the same
# .pr-self-review/bypassed file PR_SELF_REVIEW_SKIP uses, and report.sh folds
# it into latest.json and prints it.
assert_contains "$(cat "$repo/.pr-self-review/bypassed" 2>/dev/null || printf none)" \
  'PR_SELF_REVIEW_RUNNER' 'a forged Track A is written down'
rm -rf "$repo"

# --- registry.sh is found next to gates.sh, not through the reviewed repo -------
# The temp repo above has no scripts/ directory at all, so every assertion in
# this file already depends on the fix. This one names it: resolving through
# $ROOT was `exit 127` under set -e, zero output, all of Track A lost.
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(scope_json '[]')" | bash "$GATES")"; code=$?
assert_eq "$code" '0' 'gates.sh runs in a repo that has no copy of these scripts'
assert_json "$out" '[.gates[] | select(.name == "registry")][0].status' 'ok' \
  'and the registry gate still reports'
rm -rf "$repo"

rm -f "$runner"
finish
