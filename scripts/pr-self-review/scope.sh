#!/usr/bin/env bash
#
# Classifies everything the branch changed. Pure function over the working
# tree: no model, no network, always exits 0.
#
#   routed     reviewed by a subagent, with the domains that must see it
#   checklist  read, but no skill applies
#   skipped    never read; the reason is always reported
#   flagged    the change itself is the finding; contents are not reviewed
#
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

MAIN="${PR_SELF_REVIEW_BASE:-main}"
branch="$(git rev-parse --abbrev-ref HEAD)"
head="$(git rev-parse HEAD)"
base="$(git merge-base "$MAIN" HEAD 2>/dev/null || git rev-list --max-parents=0 HEAD | tail -1)"

worktree_hash() {
  {
    git diff "$head"
    git ls-files --others --exclude-standard | while IFS= read -r f; do
      printf '%s\n' "$f"
      cat "$f" 2>/dev/null
    done
  } | shasum -a 256 | cut -d' ' -f1
}

# --- every path the branch touches, committed or not --------------------------
paths="$(
  {
    git diff --name-only "$base"
    git ls-files --others --exclude-standard
  } | sort -u
)"

skip_reason() { # path -> reason, or empty when the file is read
  case "$1" in
    */node_modules/*|node_modules/*)            printf 'dependency' ;;
    */dist/*|dist/*|*/.next/*|.next/*)          printf 'build output' ;;
    */coverage/*|coverage/*)                    printf 'coverage output' ;;
    *pnpm-lock.yaml|*package-lock.json)         printf 'lockfile' ;;
    .screenshots/*)                             printf 'screenshot' ;;
    server/clones/*)                            printf 'runtime data' ;;
    server/drizzle/meta/*)                      printf 'generated' ;;
    *.snap)                                     printf 'snapshot' ;;
    *.png|*.jpg|*.jpeg|*.svg|*.webp|*.ico|*.pdf|*.woff|*.woff2) printf 'binary' ;;
    *)                                          printf '' ;;
  esac
}

flag_for() { # path -> "severity<TAB>message<TAB>fix", or empty
  local p="$1"
  case "$p" in
    .env|*/.env|*.env)
      [ "${p%.example}" = "$p" ] || return 0
      printf 'critical\ta committed .env can only be a secret\tgit rm --cached %s and move the value into ~/.devdigest/secrets.json' "$p" ;;
    *.key|*.pem)
      printf 'critical\t%s is a private key\tgit rm --cached %s\n' "$p" "$p" ;;
    server/src/vendor/*|client/src/vendor/*)
      printf 'major\t%s is a vendored copy — both copies must move together\tdiff -r server/src/vendor/shared client/src/vendor/shared' "$p" ;;
    e2e/specs/*.flow.json)
      printf 'major\t%s is a live browser scenario, not documentation\tconfirm the change was deliberate' "$p" ;;
    .claude/skills/*)
      local name="${p#.claude/skills/}"; name="${name%%/*}"
      if [ -f skills-lock.json ] && jq -e --arg n "$name" '.skills | has($n)' skills-lock.json >/dev/null 2>&1; then
        printf 'critical\t%s is pinned upstream in skills-lock.json\trevert it, or drop the lock entry if we now own the skill' "$p"
      fi ;;
  esac
}

domains_for() { # path -> space-separated domains, or empty for checklist-only
  local p="$1" d=""
  case "$p" in
    client/*.test.ts|client/*.test.tsx) d="frontend-tests" ;;
  esac
  [ -n "$d" ] || case "$p" in
    client/src/*.ts|client/src/*.tsx) d="frontend" ;;
  esac
  [ -n "$d" ] || case "$p" in
    server/src/modules/*|server/src/adapters/*|server/src/platform/*) d="backend" ;;
    server/src/db/*|*/schema.ts|server/drizzle/*.sql)               d="data" ;;
    reviewer-core/src/*)                                            d="core" ;;
    */contracts/*|*.schema.ts)                                      d="contracts" ;;
  esac
  if [ -n "$d" ]; then
    printf '%s security' "$d"
  fi
}

changed_lines() { # path -> JSON array of line numbers touched on this branch
  if git ls-files --error-unmatch "$1" >/dev/null 2>&1; then
    git diff -U0 --no-color "$head" -- "$1" |
      awk '/^@@/ {
             match($0, /\+[0-9]+(,[0-9]+)?/);
             spec = substr($0, RSTART + 1, RLENGTH - 1);
             split(spec, p, ",");
             count = (p[2] == "" ? 1 : p[2]);
             for (i = 0; i < count; i++) print p[1] + i
           }' | jq -R . | jq -s 'map(tonumber)'
  else
    awk 'END { for (i = 1; i <= NR; i++) print i }' "$1" | jq -R . | jq -s 'map(tonumber)'
  fi
}

routed="[]"; checklist="[]"; skipped="[]"; flagged="[]"; packages="[]"

while IFS= read -r path; do
  [ -n "$path" ] || continue

  reason="$(skip_reason "$path")"
  if [ -n "$reason" ]; then
    skipped="$(printf '%s' "$skipped" | jq --arg p "$path" --arg r "$reason" \
      '. + [{path:$p, reason:$r}]')"
    continue
  fi

  flag="$(flag_for "$path")"
  if [ -n "$flag" ]; then
    sev="$(printf '%s' "$flag" | cut -f1)"
    msg="$(printf '%s' "$flag" | cut -f2)"
    fix="$(printf '%s' "$flag" | cut -f3)"
    flagged="$(printf '%s' "$flagged" | jq \
      --arg s "$sev" --arg f "$path" --arg m "$msg" --arg x "$fix" \
      '. + [{severity:$s, source:"gate scope", file:$f, line:1, message:$m, fix:$x}]')"
    continue
  fi

  case "$path" in
    client/*)        packages="$(printf '%s' "$packages" | jq '. + ["client"]')" ;;
    server/*)        packages="$(printf '%s' "$packages" | jq '. + ["server"]')" ;;
    reviewer-core/*) packages="$(printf '%s' "$packages" | jq '. + ["reviewer-core"]')" ;;
  esac

  doms="$(domains_for "$path")"
  if [ -z "$doms" ]; then
    checklist="$(printf '%s' "$checklist" | jq --arg p "$path" '. + [$p]')"
    continue
  fi

  lines="$(changed_lines "$path")"
  routed="$(printf '%s' "$routed" | jq \
    --arg p "$path" --argjson l "$lines" --arg d "$doms" \
    '. + [{path:$p, domains:($d | split(" ")), lines:$l}]')"
done <<EOF
$paths
EOF

jq -n \
  --arg branch "$branch" --arg base "$base" --arg head "$head" \
  --arg hash "$(worktree_hash)" \
  --argjson routed "$routed" --argjson checklist "$checklist" \
  --argjson skipped "$skipped" --argjson flagged "$flagged" \
  --argjson packages "$packages" \
  '{branch:$branch, base:$base, head:$head, worktreeHash:$hash,
    packages:($packages | unique), routed:$routed, checklist:$checklist,
    skipped:$skipped, flagged:$flagged}'
