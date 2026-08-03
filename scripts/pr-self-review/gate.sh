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
# the brief. A --dry-run/--help exemption lived here for two rounds and was
# removed: it matched the flag anywhere in the string, including inside a
# quoted argument value — `gh pr create --title "feat: add --dry-run flag"`
# was exempt and opened an unreviewed PR. The asymmetry decides the design:
# a command that's merely REFUSED because it looks like a push costs one
# wasted turn; a push or PR that gets through unreviewed costs the whole
# guarantee. So the only exemption left is the read-only-tool allowlist
# below, anchored to the first token — nothing later in the string can forge
# that.
#
# Known holes, left as-is:
#   false negatives (a real push/PR that slips through unguarded):
#     git -C <path> push, git --git-dir=<dir> push, git  push (extra spaces),
#     gh api -X POST .../pulls
#   false positives (a harmless command still refused):
#     git push --dry-run, gh pr create --help — the accepted cost of closing
#     the quoted-value hole above; and anything other than the allowlisted
#     read-only tools below that merely contains the phrase, e.g. a commit
#     message or heredoc quoting it.
case "$command" in
  *"git push"*)                    guard=push ;;
  *"gh pr create"*|*"gh pr ready"*) guard=pr ;;
  *)                               exit 0 ;;
esac

# A read-only text tool (grep, cat, ...) inspecting a file that happens to
# contain the phrase "git push" or "gh pr create" cannot publish anything —
# but only when it's the *whole* command. Any separator (&&, ||, ;, |, &, a
# newline, a backtick, or a $( substitution) means a second command could
# ride along, so its presence anywhere disqualifies the exemption before the
# first token is even looked at.
case "$command" in
  *"&&"*|*"||"*|*";"*|*"|"*|*"&"*|*$'\n'*|*'`'*|*'$('*) ;;   # compound — no exemption
  *)
    read -r first_token _ <<<"$command"
    case "$first_token" in
      grep|rg|ag|ack|cat|less|head|tail|awk|sed|echo|printf) exit 0 ;;
    esac
    ;;
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
# Fails closed by construction: anything but the literal `false` — a missing
# key on an older verdict, a null, a string — leaves this set to something
# other than "false" and the push is refused. Only report.sh writes it.
push_blocked="$(jq -r '.pushBlocked' "$LATEST")"
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
  #
  # check-ignore's exit status is 0 (ignored), 1 (not ignored), or >=128 (a
  # git-level failure unrelated to ignore status). Both stdout and stderr are
  # redirected — an unredirected git fatal would otherwise prepend a raw
  # diagnostic onto the refusal the model reads, the same leak class as the
  # corrupt-JSON case above. Matching status 1 specifically, rather than
  # "anything nonzero", keeps a >=128 git failure from being misreported as
  # "not ignored" — it falls through to the generic stale message instead,
  # which is at least not actively wrong.
  git check-ignore -q .pr-self-review/ >/dev/null 2>&1
  if [ $? -eq 1 ]; then
    refuse "the verdict can never look fresh — .pr-self-review/ is not gitignored, so its own output changes the hash it is compared against. Add .pr-self-review/ to .gitignore, then re-run the review."
  fi
  refuse "the verdict is stale — the working tree changed since it was written"
fi

# --- a PR needs the expensive mode; a push accepts either ------------------
if [ "$guard" = pr ] && [ "$mode" != full ]; then
  refuse "the last run was mode \"$mode\"; opening a PR needs a full run"
fi

# --- and, mode aside, the verdict itself must be a pass ---------------------
# One exception, and it is the whole push/PR split: `blocked` on Track B
# criticals alone stops `gh pr create` and not `git push`. severity.md says a
# Track B critical never stops a push — it is a model's opinion, graded by the
# same machinery that graded a real path traversal `minor` in the acceptance
# run, and a `gates`-mode push never sees Track B at all. A gate failure, a
# committed secret, a registry inconsistency — anything deterministic — still
# refuses both, and report.sh is what tells them apart via `pushBlocked`.
# Missing or non-`false` means blocked: an older verdict fails closed.
case "$verdict" in
  pass) exit 0 ;;
  blocked)
    if [ "$guard" = push ] && [ "$push_blocked" = false ]; then
      exit 0
    fi
    refuse "the last run ended $verdict" ;;
  *) refuse "the last run ended $verdict" ;;
esac
