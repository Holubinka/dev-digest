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

# PR_SELF_REVIEW_BASE narrows what a review can possibly see, so it is recorded
# in the same place PR_SELF_REVIEW_SKIP is: .pr-self-review/bypassed, which
# report.sh folds into latest.json and prints. Measured on a real branch,
# `PR_SELF_REVIEW_BASE=HEAD` took routed 61 -> 1 and flagged 2 -> 0, so a
# committed-secret critical simply stopped existing — a silent narrowing is a
# bypass whether or not it was meant as one. The directory is gitignored, so
# writing here cannot move worktreeHash.
if [ -n "${PR_SELF_REVIEW_BASE:-}" ]; then
  mkdir -p .pr-self-review
  printf '%s PR_SELF_REVIEW_BASE=%s — the review diffed against this instead of main\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PR_SELF_REVIEW_BASE" >>.pr-self-review/bypassed
fi

# Bounded on purpose. This runs inside gate.sh, which runs as a PreToolUse hook,
# and a hook that times out is a NON-blocking error in Claude Code: it degrades
# to allow. So the slow path here is a hole in the gate, not just a slow gate.
# The old version cat'ed every untracked file whole — one large untracked
# artefact and the push goes through unreviewed.
#
# The cap keeps the hash sensitive to the changes that matter: the byte size is
# hashed alongside the first 256 KiB, so any growth, truncation or edit within
# that window still moves it. An edit that changes bytes past 256 KiB while
# keeping the file exactly the same size is the one thing it can miss, and no
# source file this review reads is that shape.
#
# -z / read -d '' rather than a bare line loop: a filename containing a newline
# would otherwise be read as two paths and the second `cat` would fail.
HASH_CAP=262144
worktree_hash() {
  {
    git diff "$head"
    git ls-files --others --exclude-standard -z | while IFS= read -r -d '' f; do
      printf '%s %s\n' "$f" "$(wc -c <"$f" 2>/dev/null || printf 0)"
      head -c "$HASH_CAP" "$f" 2>/dev/null
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
    # Drizzle's snapshots. `server/drizzle/` does not exist in this repo —
    # `server/drizzle.config.ts` sets `out: './src/db/migrations'` — so the old
    # `server/drizzle/meta/*` pattern matched nothing and the real snapshots,
    # `server/src/db/migrations/meta/*.json`, were routed to a subagent as
    # ordinary source. Both shapes are named so the skip survives a config move.
    */drizzle/meta/*|*/migrations/meta/*)       printf 'generated' ;;
    *.snap)                                     printf 'snapshot' ;;
    *.png|*.jpg|*.jpeg|*.svg|*.webp|*.ico|*.pdf|*.woff|*.woff2) printf 'binary' ;;
    *)                                          printf '' ;;
  esac
}

flag_for() { # path -> "severity<TAB>message<TAB>fix", or empty
  local p="$1"
  case "$p" in
    # Every .env variant, in any directory. The old pattern was `.env|*/.env|*.env`
    # — the bare name and nothing else. `client/.env.local` is the standard
    # Next.js secrets file and this is a Next.js app; it, `.env.production` and
    # `client/.env.development.local` all fell through to checklist[] and were
    # reviewed as ordinary files.
    #
    # The suffix guard below is what keeps `.env.example` out, and it is only
    # reachable now: under the old pattern nothing ending in `.example` could
    # match in the first place, so the guard was dead code protecting nothing.
    .env|.env.*|*/.env|*/.env.*)
      case "$p" in
        *.example|*.sample|*.template|*.dist) return 0 ;;
      esac
      printf 'critical\t%s is a committed .env — it can only be a secret\tgit rm --cached %s and move the value into ~/.devdigest/secrets.json' "$p" "$p" ;;
    *.env)
      printf 'critical\t%s is a committed .env — it can only be a secret\tgit rm --cached %s and move the value into ~/.devdigest/secrets.json' "$p" "$p" ;;
    # Private keys and the conventional secret filenames. id_rsa and
    # secrets.json were measured falling through to checklist[]; the latter is
    # the exact filename CLAUDE.md names as the store secrets belong in.
    *.key|*.pem|*.p12|*.pfx|*.jks|*.keystore)
      printf 'critical\t%s is a private key\tgit rm --cached %s\n' "$p" "$p" ;;
    id_rsa|*/id_rsa|id_dsa|*/id_dsa|id_ecdsa|*/id_ecdsa|id_ed25519|*/id_ed25519)
      printf 'critical\t%s is an SSH private key\tgit rm --cached %s\n' "$p" "$p" ;;
    secrets.json|*/secrets.json|*.secrets.json|credentials.json|*/credentials.json)
      printf 'critical\t%s holds secrets by convention — CLAUDE.md keeps them in ~/.devdigest/secrets.json, never in the repo\tgit rm --cached %s and move the values into ~/.devdigest/secrets.json' "$p" "$p" ;;
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

TRACK_B="security conventions"   # the roster; report.sh's coverage check reads it back

domains_for() { # path -> the Track B roster, or empty when the file is checklist-only
  # Track B is two agents — `security` and `conventions` — since the acceptance
  # run measured the five partitioned ones (`frontend`, `frontend-tests`,
  # `backend`, `data`, `core`) at 509k tokens for twelve findings, none blocking,
  # and the one finding worth having came from a real `Review checklist`.
  # README.md §9.
  #
  # Both see the whole routed set, so `domains` is the same pair on every entry:
  # it is no longer a per-file routing decision, it is where the roster is
  # written down, and report.sh reads it back to check that both agents ran.
  #
  # `security` used to have no criteria of its own: it was *appended* to
  # whichever of the five matched. Those five patterns, not the domain names,
  # were what decided whether a file was reviewed at all, so deleting the arms
  # would have returned empty for everything, emptied routed[], and left the
  # surviving agents dispatched over zero files while the run still printed a
  # verdict. 61 files to 0, silently. So the narrowing is a rewrite of this
  # function, and what is left is a positive rule: the source of the three
  # packages this repo gates.
  #
  # skip_reason and flag_for have already run by the time a path reaches here,
  # so dependencies, build output, generated snapshots, binaries, secrets,
  # vendored copies and locked skills are gone. What is left under those roots
  # is source, and source is what a review reads.
  #
  # It is a superset of the five it replaces, by one shape: `server/src/**`
  # outside `modules/`, `adapters/`, `platform/` and `db/` — `server/src/index.ts`
  # among it — used to reach no domain and so was reviewed by nobody. Measured on
  # this branch the two rules route the same 61 files; the difference is a hole
  # closed, not a change of subject.
  case "$1" in
    client/src/*.ts|client/src/*.tsx|client/*.test.ts|client/*.test.tsx) ;;
    server/src/*|reviewer-core/src/*)                                   ;;
    # `contracts` was the sixth domain and could never fire here: there are no
    # `*.schema.ts` files, and every `contracts/` directory sits under
    # `*/vendor/shared/`, which flag_for diverts before routing. The arm stays
    # because a non-vendored one would be source like any other — it just no
    # longer names a domain nothing dispatches.
    */contracts/*|*.schema.ts)                                          ;;
    *) return 0 ;;
  esac
  printf '%s' "$TRACK_B"
}

changed_lines() { # path -> JSON array of line numbers touched on this branch
  if git ls-files --error-unmatch "$1" >/dev/null 2>&1; then
    git diff -U0 --no-color "$base" -- "$1" |
      awk '/^@@/ {
             match($0, /\+[0-9]+(,[0-9]+)?/);
             spec = substr($0, RSTART + 1, RLENGTH - 1);
             split(spec, p, ",");
             count = (p[2] == "" ? 1 : p[2]);
             for (i = 0; i < count; i++) print p[1] + i
           }' | jq -R . | jq -s 'map(tonumber)'
  elif [ -f "$1" ]; then
    awk 'END { for (i = 1; i <= NR; i++) print i }' "$1" | jq -R . | jq -s 'map(tonumber)'
  else
    printf '[]'
  fi
}

routed="[]"; checklist="[]"; skipped="[]"; flagged="[]"; packages="[]"

while IFS= read -r path; do
  [ -n "$path" ] || continue

  # Which packages Track A gates, decided BEFORE the two `continue`s below.
  # `packages` used to be appended after them, so a path that was skipped or
  # flagged never contributed its package — and a branch that touched *only*
  # such paths produced `packages: []`, which gates.sh reads as "no package in
  # the diff" and answers with `skip` on all eight package gates. Measured on a
  # branch editing `server/src/vendor/shared/` and `client/src/vendor/shared/`
  # in step: no typecheck, no tests, no subagent, `verdict pass`, push allowed —
  # on the file class CLAUDE.md protects hardest, where a one-sided contract
  # edit is exactly what must not reach main untyped.
  #
  # A gate is cheap and a package in the diff is a fact about the diff, not
  # about whether this script chose to read the file. Erring toward running the
  # gates is the safe direction: the worst case is that a lockfile or a PNG
  # under client/ costs one typecheck.
  case "$path" in
    client/*)        packages="$(printf '%s' "$packages" | jq '. + ["client"]')" ;;
    server/*)        packages="$(printf '%s' "$packages" | jq '. + ["server"]')" ;;
    reviewer-core/*) packages="$(printf '%s' "$packages" | jq '. + ["reviewer-core"]')" ;;
  esac

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
