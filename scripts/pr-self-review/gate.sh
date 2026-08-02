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

# --- is this a command we guard at all? -------------------------------------
# Substring matching is crude in both directions, and deliberately so — see
# the brief. Known holes, left as-is:
#   false negatives (a real push/PR that slips through unguarded):
#     git -C <path> push, git --git-dir=<dir> push, git  push (extra spaces),
#     gh api -X POST .../pulls
#   false positives (a harmless command merely containing the phrase):
#     grep/rg for "git push", a commit message or heredoc quoting it, etc.
# A missed push is a discipline gap the spec accepts; blocking a harmless
# command is worse — it burns the model's turn on a phantom refusal. The
# --dry-run/--help carve-out below claws back the cheapest, most common false
# positives; the rest of the false-positive surface is accepted, not fixed.
case "$command" in
  *"git push"*)                    guard=push ;;
  *"gh pr create"*|*"gh pr ready"*) guard=pr ;;
  *)                               exit 0 ;;
esac

# Neither flag can actually publish anything, so there is nothing to guard.
case "$command" in
  *"--dry-run"*|*"--help"*) exit 0 ;;
esac

# --- the escape hatch ------------------------------------------------------
if [ -n "${PR_SELF_REVIEW_SKIP:-}" ]; then
  # Recorded, not silent. report.sh consumes this file on the next run, so a
  # bypass shows up exactly once, in the next report anyone reads. report.sh
  # reads this file with `jq -R . | jq -s .`, which is one entry per line —
  # a raw multi-line command would fragment into several bypass entries, so
  # newlines are collapsed the same way run() does in the test.
  mkdir -p .pr-self-review
  printf '%s %s (verdict %s)\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${command//$'\n'/ }" \
    "$(jq -r '.verdict' .pr-self-review/latest.json 2>/dev/null || printf none)" \
    >>.pr-self-review/bypassed
  exit 0
fi

refuse() {
  printf 'PR Self-Review: %s\n\nRun /pr-self-review%s, fix every critical, then retry.\n' \
    "$1" "$([ "$guard" = pr ] && printf '' || printf ' --gates')" >&2
  exit 2
}

# --- a verdict must exist, and be readable ----------------------------------
LATEST=".pr-self-review/latest.json"
[ -f "$LATEST" ] || refuse "no review has been run for this branch"
# A truncated/corrupt file would otherwise make every read below silently
# fail empty, leaking raw `jq: parse error` lines to the model and blocking
# with a false diagnosis ("HEAD moved") instead of the true one.
jq -e . "$LATEST" >/dev/null 2>&1 ||
  refuse "the recorded verdict at $LATEST is corrupt or not valid JSON — re-run the review"

verdict="$(jq -r '.verdict' "$LATEST")"
mode="$(jq -r '.mode' "$LATEST")"
recorded_head="$(jq -r '.headSha' "$LATEST")"
recorded_hash="$(jq -r '.worktreeHash' "$LATEST")"

# --- and it must still be fresh --------------------------------------------
head="$(git rev-parse HEAD)"
hash="$(bash "$HERE/scope.sh" | jq -r '.worktreeHash')"

[ "$recorded_head" = "$head" ] || refuse "the verdict is stale — HEAD moved since it was written"

if [ "$recorded_hash" != "$hash" ]; then
  # scope.sh hashes every untracked file's content, .pr-self-review/latest.json
  # included. If that directory isn't gitignored, writing the verdict changes
  # the very hash the next check compares it against — no worktree edit could
  # ever satisfy this, and telling the model "the working tree changed" sends
  # it to re-run a review that regenerates the same unsatisfiable mismatch.
  # Name the real, fixable cause instead.
  git check-ignore -q .pr-self-review/ ||
    refuse "the verdict can never look fresh — .pr-self-review/ is not gitignored, so its own output changes the hash it is compared against. Add .pr-self-review/ to .gitignore, then re-run the review."
  refuse "the verdict is stale — the working tree changed since it was written"
fi

# --- a PR needs the expensive mode; a push accepts either ------------------
if [ "$guard" = pr ] && [ "$mode" != full ]; then
  refuse "the last run was mode \"$mode\"; opening a PR needs a full run"
fi

# --- and, mode aside, the verdict itself must be a pass ---------------------
case "$verdict" in
  pass)  exit 0 ;;
  *)     refuse "the last run ended $verdict" ;;
esac
