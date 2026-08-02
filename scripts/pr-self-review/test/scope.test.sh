#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
. "$HERE/lib.sh"
SCOPE="$HERE/../scope.sh"

# --- a changed client component routes, to the one Track B agent there is ------
repo="$(make_repo)"
sgit "$repo" checkout -qb feat/x
mkdir -p "$repo/client/src/app"
printf 'export const A = 1\n' >"$repo/client/src/app/a.tsx"
sgit "$repo" add -A && sgit "$repo" commit -qm "add a"

out="$(cd "$repo" && bash "$SCOPE")"
assert_json "$out" '.routed | length' '1' 'one routed file'
assert_json "$out" '.routed[0].path' 'client/src/app/a.tsx' 'the component is routed'
assert_json "$out" '.routed[0].domains | sort | join(",")' 'conventions,security' \
  'and carries the two-agent Track B roster — the five partitioned domains are gone'
assert_json "$out" '.packages | index("client") != null' 'true' 'client is in packages'
assert_json "$out" '.branch' 'feat/x' 'the branch is reported'
rm -rf "$repo"

# --- narrowing Track B must not narrow what gets reviewed ----------------------
# `security` used to be appended to whichever of five domains matched, so those
# five patterns were the routing test itself. Deleting them would have returned
# empty for every path, emptied routed[] and dispatched the surviving agents
# over zero files while the run still printed a verdict. This pins the property
# that replaced them: every shape the five used to carry is still routed, and
# each carries the roster and nothing else.
repo="$(make_repo)"
sgit "$repo" checkout -qb feat/x
mkdir -p "$repo/client/src/lib" "$repo/client/src/app/_components" \
         "$repo/server/src/modules/pulls" "$repo/server/src/adapters" \
         "$repo/server/src/platform" "$repo/server/src/db" "$repo/reviewer-core/src"
for f in client/src/lib/urls.ts \
         client/src/app/_components/Card.test.tsx \
         server/src/modules/pulls/routes.ts \
         server/src/adapters/github.ts \
         server/src/platform/config.ts \
         server/src/db/schema.ts \
         reviewer-core/src/review.ts; do
  printf 'export const x = 1\n' >"$repo/$f"
done
sgit "$repo" add -A && sgit "$repo" commit -qm "one file per old domain"

out="$(cd "$repo" && bash "$SCOPE")"
assert_json "$out" '.routed | length' '7' \
  'every shape the five partitioned domains used to route is still routed'
assert_json "$out" '[.routed[].domains[]] | unique | join(",")' 'conventions,security' \
  'and the roster is the only thing any of them carries'
assert_json "$out" '[.routed[] | select((.domains | sort) != ["conventions","security"])] | length' \
  '0' 'every routed file carries both agents — neither is partitioned'

# `security` standing on its own merits, not inherited from a deleted arm:
# server/src wiring outside modules/, adapters/, platform/ and db/ matched none
# of the five and so used to reach checklist[], reviewed by nobody.
printf 'export const boot = 1\n' >"$repo/server/src/index.ts"
mkdir -p "$repo/server/src/lib" && printf 'export const h = 1\n' >"$repo/server/src/lib/hash.ts"
sgit "$repo" add -A && sgit "$repo" commit -qm "server wiring outside the old four"

out="$(cd "$repo" && bash "$SCOPE")"
assert_json "$out" \
  '[.routed[] | select(.path == "server/src/index.ts")][0].domains | sort | join(",")' \
  'conventions,security' \
  'server/src wiring outside the old four domains is routed on its own merits'
assert_json "$out" '[.checklist[] | select(. == "server/src/lib/hash.ts")] | length' '0' \
  'and a server/src module that reached no domain before is no longer checklist-only'
rm -rf "$repo"

# --- drizzle snapshots are generated, and are skipped where they really live ----
# `server/drizzle/` does not exist here: drizzle.config.ts sets
# out: './src/db/migrations'. The old `server/drizzle/meta/*` skip matched
# nothing, and now that server/src/** routes whole, the snapshots would be handed
# to the agent as source.
repo="$(make_repo)"
sgit "$repo" checkout -qb feat/x
mkdir -p "$repo/server/src/db/migrations/meta"
printf 'CREATE TABLE t (id int);\n' >"$repo/server/src/db/migrations/0001_x.sql"
printf '{"version":"7"}\n'          >"$repo/server/src/db/migrations/meta/0001_snapshot.json"
sgit "$repo" add -A && sgit "$repo" commit -qm "migration"

out="$(cd "$repo" && bash "$SCOPE")"
assert_json "$out" \
  '[.skipped[] | select(.path == "server/src/db/migrations/meta/0001_snapshot.json")][0].reason' \
  'generated' 'the real snapshot location is skipped as generated'
assert_json "$out" \
  '[.routed[] | select(.path == "server/src/db/migrations/0001_x.sql")] | length' '1' \
  'while the migration itself is still reviewed'
rm -rf "$repo"

# --- a lockfile is skipped, never routed ---------------------------------------
repo="$(make_repo)"
sgit "$repo" checkout -qb feat/x
mkdir -p "$repo/client"
printf 'lockfileVersion: 9\n' >"$repo/client/pnpm-lock.yaml"
sgit "$repo" add -A && sgit "$repo" commit -qm "lock"

out="$(cd "$repo" && bash "$SCOPE")"
assert_json "$out" '.routed | length' '0' 'the lockfile is not routed'
assert_json "$out" '[.skipped[] | select(.path == "client/pnpm-lock.yaml")] | length' '1' \
  'the lockfile is reported as skipped'
assert_json "$out" '[.skipped[] | select(.path == "client/pnpm-lock.yaml")][0].reason' \
  'lockfile' 'the skip reason is named'
rm -rf "$repo"

# --- a committed .env is a critical flag, and its contents are never read -------
repo="$(make_repo)"
sgit "$repo" checkout -qb feat/x
printf 'OPENAI_API_KEY=sk-real\n' >"$repo/.env"
sgit "$repo" add -f .env && sgit "$repo" commit -qm "env"

out="$(cd "$repo" && bash "$SCOPE")"
assert_json "$out" '[.flagged[] | select(.file == ".env")] | length' '1' 'the .env is flagged'
assert_json "$out" '[.flagged[] | select(.file == ".env")][0].severity' 'critical' \
  'a committed .env is critical'
assert_json "$out" '.routed | length' '0' 'a flagged file is never routed'
rm -rf "$repo"

# --- and so is every other .env variant, plus the conventional secret names -----
# The pattern used to be `.env|*/.env|*.env` — the bare name and nothing else.
# `client/.env.local` is the standard Next.js secrets file and this is a
# Next.js app; it, `.env.production`, `client/.env.development.local`, `id_rsa`
# and `secrets.json` all fell through to checklist[] and were handed to a
# subagent as ordinary source files.
repo="$(make_repo)"
sgit "$repo" checkout -qb feat/x
mkdir -p "$repo/client"
for f in client/.env.local .env.production client/.env.development.local id_rsa secrets.json; do
  printf 'OPENAI_API_KEY=sk-real\n' >"$repo/$f"
done
sgit "$repo" add -Af . && sgit "$repo" commit -qm "secrets"

out="$(cd "$repo" && bash "$SCOPE")"
for f in client/.env.local .env.production client/.env.development.local id_rsa secrets.json; do
  assert_json "$out" "[.flagged[] | select(.file == \"$f\")][0].severity" 'critical' \
    "$f is flagged critical"
  assert_json "$out" "[.checklist[] | select(. == \"$f\")] | length" '0' \
    "$f is never handed to a subagent as ordinary source"
done
rm -rf "$repo"

# --- .env.example is ordinary, and lands on the checklist -----------------------
# This also exercises the `.example` guard, which the old pattern made
# unreachable: nothing ending in `.example` could match `.env|*/.env|*.env` in
# the first place, so the guard protected nothing. It is live now.
repo="$(make_repo)"
sgit "$repo" checkout -qb feat/x
printf 'OPENAI_API_KEY=\n' >"$repo/.env.example"
sgit "$repo" add -A && sgit "$repo" commit -qm "example"

out="$(cd "$repo" && bash "$SCOPE")"
assert_json "$out" '.flagged | length' '0' '.env.example is not a secret'
assert_json "$out" '[.checklist[] | select(. == ".env.example")] | length' '1' \
  '.env.example is checklist-only'
rm -rf "$repo"

# --- PR_SELF_REVIEW_BASE is recorded, because it narrows what can be found ------
# Measured on a real branch, PR_SELF_REVIEW_BASE=HEAD took routed 61 -> 1 and
# flagged 2 -> 0: the committed-secret criticals simply stopped existing. A
# silent narrowing is a bypass whether or not it was meant as one, so it goes
# in the same file PR_SELF_REVIEW_SKIP does and report.sh prints it.
repo="$(make_repo)"
sgit "$repo" checkout -qb feat/x
printf 'OPENAI_API_KEY=sk-real\n' >"$repo/.env"
sgit "$repo" add -f .env && sgit "$repo" commit -qm "env"

out="$(cd "$repo" && PR_SELF_REVIEW_BASE=HEAD bash "$SCOPE")"
assert_json "$out" '.flagged | length' '0' \
  'PR_SELF_REVIEW_BASE=HEAD really does hide the committed .env'
assert_contains "$(cat "$repo/.pr-self-review/bypassed" 2>/dev/null || printf none)" \
  'PR_SELF_REVIEW_BASE=HEAD' 'so the override is written down where the report will show it'

out="$(cd "$repo" && bash "$SCOPE")"
assert_json "$out" '[.flagged[] | select(.file == ".env")] | length' '1' \
  'and without the override the same tree still flags it'
rm -rf "$repo"

# --- an uncommitted edit is in scope, and moves the worktree hash ---------------
repo="$(make_repo)"
sgit "$repo" checkout -qb feat/x
mkdir -p "$repo/server/src/modules/pulls"
printf 'export const s = 1\n' >"$repo/server/src/modules/pulls/service.ts"
sgit "$repo" add -A && sgit "$repo" commit -qm "service"
before="$(cd "$repo" && bash "$SCOPE" | jq -r '.worktreeHash')"
printf 'export const s = 2\n' >"$repo/server/src/modules/pulls/service.ts"

out="$(cd "$repo" && bash "$SCOPE")"
assert_json "$out" \
  '[.routed[] | select(.path | endswith("service.ts"))][0].domains | sort | join(",")' \
  'conventions,security' 'a service file goes to both Track B agents'
after="$(printf '%s' "$out" | jq -r '.worktreeHash')"
if [ "$before" != "$after" ]; then
  assert_eq ok ok 'an uncommitted edit changes the worktree hash'
else
  assert_eq "$after" "different from $before" 'an uncommitted edit changes the worktree hash'
fi
rm -rf "$repo"

# --- changed lines are recorded, so findings can be anchored to them ------------
# The file must pre-date the branch. A file *created* on the branch has every
# line changed relative to the merge-base, which is correct and would make the
# "untouched line" assertion below meaningless.
repo="$(make_repo)"
mkdir -p "$repo/client/src"
printf 'a\nb\nc\nd\n' >"$repo/client/src/x.ts"
sgit "$repo" add -A && sgit "$repo" commit -qm "x predates the branch"
sgit "$repo" checkout -qb feat/x
printf 'a\nb\nCHANGED\nd\n' >"$repo/client/src/x.ts"
sgit "$repo" add -A && sgit "$repo" commit -qm "edit line 3"
printf 'a\nb\nCHANGED\nALSO-CHANGED\n' >"$repo/client/src/x.ts"   # uncommitted, line 4

out="$(cd "$repo" && bash "$SCOPE")"
lines='[.routed[] | select(.path == "client/src/x.ts")][0].lines'
assert_json "$out" "$lines | index(3) != null" 'true' \
  'a line committed on the branch is in scope'
assert_json "$out" "$lines | index(4) != null" 'true' \
  'an uncommitted edit is in scope too'
assert_json "$out" "$lines | index(1)" 'null' \
  'a line the branch never touched is not in scope'
rm -rf "$repo"

# --- a deleted routed file yields no lines and does not crash ------------------
# `git ls-files --error-unmatch` is false for a removed path, so the untracked
# branch used to read a file that is no longer on disk. A deletion stays routed:
# the spec makes a test deleted to green a gate a critical finding.
repo="$(make_repo)"
mkdir -p "$repo/client/src"
printf 'a\nb\n' >"$repo/client/src/gone.ts"
sgit "$repo" add -A && sgit "$repo" commit -qm "gone.ts predates the branch"
sgit "$repo" checkout -qb feat/x
sgit "$repo" rm -q "client/src/gone.ts"

out="$(cd "$repo" && bash "$SCOPE")"; code=$?
assert_eq "$code" '0' 'a staged deletion does not crash scope.sh'
assert_json "$out" '[.routed[] | select(.path == "client/src/gone.ts")] | length' '1' \
  'a deleted file stays routed so the deletion itself can be reviewed'
assert_json "$out" '[.routed[] | select(.path == "client/src/gone.ts")][0].lines | length' '0' \
  'and carries no lines, because there is nothing left to anchor to'

sgit "$repo" commit -qm "delete gone.ts"
out="$(cd "$repo" && bash "$SCOPE")"; code=$?
assert_eq "$code" '0' 'a committed deletion does not crash scope.sh either'
rm -rf "$repo"

finish
