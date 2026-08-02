#!/usr/bin/env bash
#
# The PreToolUse hook. Reads a verdict; never produces one — a Claude Code
# hook is a shell command and cannot call a model.
#
# exit 0  allow
# exit 2  block, and hand stderr back to the model
#
set -uo pipefail

# Captured before cd: the reviewed repo (ROOT, below) need not be the repo
# these scripts live in — the test repos aren't, and a hook pointed at a
# different project wouldn't be either. scope.sh is always found next to
# this script, never by a path relative to ROOT.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$ROOT"

payload="$(cat)"
command="$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')"

# --- is this a command we guard at all? -----------------------------------
case "$command" in
  *"git push"*)                    guard=push ;;
  *"gh pr create"*|*"gh pr ready"*) guard=pr ;;
  *)                               exit 0 ;;
esac

# --- the escape hatch ------------------------------------------------------
if [ -n "${PR_SELF_REVIEW_SKIP:-}" ]; then
  # Recorded, not silent. report.sh consumes this file on the next run, so a
  # bypass shows up exactly once, in the next report anyone reads.
  mkdir -p .pr-self-review
  printf '%s %s (verdict %s)\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$command" \
    "$(jq -r '.verdict' .pr-self-review/latest.json 2>/dev/null || printf none)" \
    >>.pr-self-review/bypassed
  exit 0
fi

refuse() {
  printf 'PR Self-Review: %s\n\nRun /pr-self-review%s, fix every critical, then retry.\n' \
    "$1" "$([ "$guard" = pr ] && printf '' || printf ' --gates')" >&2
  exit 2
}

# --- a verdict must exist -------------------------------------------------
LATEST=".pr-self-review/latest.json"
[ -f "$LATEST" ] || refuse "no review has been run for this branch"

verdict="$(jq -r '.verdict' "$LATEST")"
mode="$(jq -r '.mode' "$LATEST")"
recorded_head="$(jq -r '.headSha' "$LATEST")"
recorded_hash="$(jq -r '.worktreeHash' "$LATEST")"

# --- and it must still be fresh --------------------------------------------
head="$(git rev-parse HEAD)"
hash="$(bash "$HERE/scope.sh" | jq -r '.worktreeHash')"

[ "$recorded_head" = "$head" ] || refuse "the verdict is stale — HEAD moved since it was written"
[ "$recorded_hash" = "$hash" ] || refuse "the verdict is stale — the working tree changed since it was written"

# --- a PR needs the expensive mode; a push accepts either ------------------
if [ "$guard" = pr ] && [ "$mode" != full ]; then
  refuse "the last run was mode \"$mode\"; opening a PR needs a full run"
fi

# --- and, mode aside, the verdict itself must be a pass ---------------------
case "$verdict" in
  pass)  exit 0 ;;
  *)     refuse "the last run ended $verdict" ;;
esac
