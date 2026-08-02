#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
. "$HERE/lib.sh"
SCOPE="$HERE/../scope.sh"

# --- a changed client component routes to frontend, and to security ------------
repo="$(make_repo)"
git -C "$repo" checkout -qb feat/x
mkdir -p "$repo/client/src/app"
printf 'export const A = 1\n' >"$repo/client/src/app/a.tsx"
git -C "$repo" add -A && git -C "$repo" commit -qm "add a"

out="$(cd "$repo" && bash "$SCOPE")"
assert_json "$out" '.routed | length' '1' 'one routed file'
assert_json "$out" '.routed[0].path' 'client/src/app/a.tsx' 'the component is routed'
assert_json "$out" '[.routed[0].domains[] | select(. == "frontend")] | length' '1' \
  'a client component goes to the frontend agent'
assert_json "$out" '[.routed[0].domains[] | select(. == "security")] | length' '1' \
  'security is cross-cutting and sees every routed file'
assert_json "$out" '.packages | index("client") != null' 'true' 'client is in packages'
assert_json "$out" '.branch' 'feat/x' 'the branch is reported'
rm -rf "$repo"

# --- a lockfile is skipped, never routed ---------------------------------------
repo="$(make_repo)"
git -C "$repo" checkout -qb feat/x
mkdir -p "$repo/client"
printf 'lockfileVersion: 9\n' >"$repo/client/pnpm-lock.yaml"
git -C "$repo" add -A && git -C "$repo" commit -qm "lock"

out="$(cd "$repo" && bash "$SCOPE")"
assert_json "$out" '.routed | length' '0' 'the lockfile is not routed'
assert_json "$out" '[.skipped[] | select(.path == "client/pnpm-lock.yaml")] | length' '1' \
  'the lockfile is reported as skipped'
assert_json "$out" '[.skipped[] | select(.path == "client/pnpm-lock.yaml")][0].reason' \
  'lockfile' 'the skip reason is named'
rm -rf "$repo"

# --- a committed .env is a critical flag, and its contents are never read -------
repo="$(make_repo)"
git -C "$repo" checkout -qb feat/x
printf 'OPENAI_API_KEY=sk-real\n' >"$repo/.env"
git -C "$repo" add -f .env && git -C "$repo" commit -qm "env"

out="$(cd "$repo" && bash "$SCOPE")"
assert_json "$out" '[.flagged[] | select(.file == ".env")] | length' '1' 'the .env is flagged'
assert_json "$out" '[.flagged[] | select(.file == ".env")][0].severity' 'critical' \
  'a committed .env is critical'
assert_json "$out" '.routed | length' '0' 'a flagged file is never routed'
rm -rf "$repo"

# --- .env.example is ordinary, and lands on the checklist -----------------------
repo="$(make_repo)"
git -C "$repo" checkout -qb feat/x
printf 'OPENAI_API_KEY=\n' >"$repo/.env.example"
git -C "$repo" add -A && git -C "$repo" commit -qm "example"

out="$(cd "$repo" && bash "$SCOPE")"
assert_json "$out" '.flagged | length' '0' '.env.example is not a secret'
assert_json "$out" '[.checklist[] | select(. == ".env.example")] | length' '1' \
  '.env.example is checklist-only'
rm -rf "$repo"

# --- an uncommitted edit is in scope, and moves the worktree hash ---------------
repo="$(make_repo)"
git -C "$repo" checkout -qb feat/x
mkdir -p "$repo/server/src/modules/pulls"
printf 'export const s = 1\n' >"$repo/server/src/modules/pulls/service.ts"
git -C "$repo" add -A && git -C "$repo" commit -qm "service"
before="$(cd "$repo" && bash "$SCOPE" | jq -r '.worktreeHash')"
printf 'export const s = 2\n' >"$repo/server/src/modules/pulls/service.ts"

out="$(cd "$repo" && bash "$SCOPE")"
assert_json "$out" '[.routed[] | select(.path | endswith("service.ts"))][0].domains[0]' \
  'backend' 'a service file goes to the backend agent'
after="$(printf '%s' "$out" | jq -r '.worktreeHash')"
if [ "$before" != "$after" ]; then
  assert_eq ok ok 'an uncommitted edit changes the worktree hash'
else
  assert_eq "$after" "different from $before" 'an uncommitted edit changes the worktree hash'
fi
rm -rf "$repo"

# --- changed lines are recorded, so findings can be anchored to them ------------
repo="$(make_repo)"
git -C "$repo" checkout -qb feat/x
mkdir -p "$repo/client/src"
printf 'a\nb\nc\nd\n' >"$repo/client/src/x.ts"
git -C "$repo" add -A && git -C "$repo" commit -qm "x"
printf 'a\nb\nCHANGED\nd\n' >"$repo/client/src/x.ts"

out="$(cd "$repo" && bash "$SCOPE")"
assert_json "$out" '[.routed[] | select(.path == "client/src/x.ts")][0].lines | index(3) != null' \
  'true' 'the edited line is recorded'
assert_json "$out" '[.routed[] | select(.path == "client/src/x.ts")][0].lines | index(1)' \
  'null' 'an untouched line is not recorded'
rm -rf "$repo"

finish
