#!/usr/bin/env bash
#
# Track A. Deterministic checks only — no model. Reads the scope object on
# stdin, runs one gate per row below for the packages actually in the diff,
# and prints {gates, findings}. Always exits 0.
#
# Integration tests (*.it.test.ts) are deliberately absent: they need
# testcontainers and cost minutes. CI owns them.
#
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

scope="$(cat)"
in_scope() { printf '%s' "$scope" | jq -e --arg p "$1" '.packages | index($p) != null' >/dev/null; }

# package<TAB>name<TAB>command
GATES="$(cat <<'ROWS'
server	arch	cd server && pnpm arch
server	typecheck	cd server && pnpm typecheck
server	test	cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'
client	lint	cd client && pnpm lint
client	typecheck	cd client && pnpm typecheck
client	test	cd client && pnpm test
reviewer-core	typecheck	cd reviewer-core && npm run typecheck
reviewer-core	test	cd reviewer-core && npm test
repo	vendor	diff -r server/src/vendor/shared client/src/vendor/shared
ROWS
)"

gates="[]"; findings="[]"

record() { # package name status detail
  gates="$(printf '%s' "$gates" | jq \
    --arg p "$1" --arg n "$2" --arg s "$3" --arg d "$4" \
    '. + [{package:$p, name:$n, status:$s, detail:$d}]')"
}

fail() { # package name command output
  findings="$(printf '%s' "$findings" | jq \
    --arg n "$2" --arg f "$1" --arg m "$4" --arg x "$3" \
    '. + [{severity:"critical", source:("gate " + $n), file:$f, line:0,
           message:$m, fix:$x}]')"
}

while IFS=$'\t' read -r pkg name cmd; do
  [ -n "${pkg:-}" ] || continue

  if [ "$pkg" != "repo" ] && ! in_scope "$pkg"; then
    record "$pkg" "$name" skip "not run — no $pkg file in the diff"
    continue
  fi

  # Under `set -e`, `out="$(cmd)"; code=$?` still aborts the script when cmd
  # fails: the assignment IS the simple command, so its exit status is the
  # substitution's. Route through && / || so the failure lands in `code`
  # instead of killing the script — gates are *expected* to fail sometimes.
  if [ -n "${PR_SELF_REVIEW_RUNNER:-}" ]; then
    out="$("$PR_SELF_REVIEW_RUNNER" "$pkg" "$name" 2>&1)" && code=0 || code=$?
  else
    out="$(bash -c "$cmd" 2>&1)" && code=0 || code=$?
  fi

  if [ "$code" -eq 0 ]; then
    record "$pkg" "$name" ok ""
  else
    record "$pkg" "$name" fail "exit $code"
    fail "$pkg" "$name" "$cmd" "$(printf '%s' "$out" | tail -20)"
  fi
done <<EOF
$GATES
EOF

# The registry gate is a script, not a package command, and always runs.
registry="$(bash "$ROOT/scripts/pr-self-review/registry.sh")"
reg_critical="$(printf '%s' "$registry" | jq '[.[] | select(.severity == "critical")] | length')"
if [ "$reg_critical" -eq 0 ]; then
  record repo registry ok "lock and directories agree"
else
  record repo registry fail "$reg_critical inconsistent entries"
fi
findings="$(jq -n --argjson a "$findings" --argjson b "$registry" '$a + $b')"

jq -n --argjson g "$gates" --argjson f "$findings" '{gates:$g, findings:$f}'
