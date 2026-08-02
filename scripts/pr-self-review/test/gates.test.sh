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

# --- only the packages in scope are gated --------------------------------------
out="$(printf '%s' "$(scope_json '["client"]')" | PR_SELF_REVIEW_RUNNER="$runner" bash "$GATES")"
assert_json "$out" '[.gates[] | select(.package == "server" and .status != "skip")] | length' '0' \
  'server gates do not run for a client-only diff'
assert_json "$out" '[.gates[] | select(.package == "server")][0].status' 'skip' \
  'a skipped gate is still reported'
assert_json "$out" '[.gates[] | select(.package == "client" and .name == "lint")][0].status' 'ok' \
  'the client lint gate runs'

# --- the registry gate always runs, package or not -----------------------------
assert_json "$out" '[.gates[] | select(.name == "registry")] | length' '1' \
  'the registry gate is not package-scoped'

# --- a failing gate produces exactly one critical, anchored to no line ----------
out="$(printf '%s' "$(scope_json '["client"]')" |
  FAIL_LIST="lint" PR_SELF_REVIEW_RUNNER="$runner" bash "$GATES")"
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
out="$(printf '%s' "$(scope_json '["server"]')" | PR_SELF_REVIEW_RUNNER="$runner" bash "$GATES")"
assert_json "$out" '[.gates[] | select(.name | test("it.test|integration"))] | length' '0' \
  'integration tests stay in CI'

# --- gates.sh exits 0 even when a gate fails -----------------------------------
printf '%s' "$(scope_json '["client"]')" |
  FAIL_LIST="lint typecheck" PR_SELF_REVIEW_RUNNER="$runner" bash "$GATES" >/dev/null
assert_eq "$?" '0' 'gates.sh leaves the verdict to the caller'

rm -f "$runner"
finish
