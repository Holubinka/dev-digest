#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
. "$HERE/lib.sh"
GATE="$HERE/../gate.sh"

hook() { jq -n --arg c "$1" '{tool_name:"Bash", tool_input:{command:$c}}'; }

# make_repo's throwaway repo has no .gitignore, so .pr-self-review/latest.json
# would itself show up as an untracked file the moment it is written — and
# scope.sh's worktree hash includes untracked file contents, so recording a
# verdict would immediately make itself look stale. Task 7 wires a real
# .gitignore entry for this into the repo; mirror that here so gate.sh is
# tested against the environment it actually runs in.
new_repo() { # -> path, on branch feat/x, .pr-self-review already gitignored
  local repo
  repo="$(make_repo)"
  sgit "$repo" checkout -qb feat/x
  printf '.pr-self-review/\n' >"$repo/.gitignore"
  sgit "$repo" add -A
  sgit "$repo" commit -qm "ignore .pr-self-review"
  printf '%s' "$repo"
}

write_verdict() { # repo mode verdict [headSha] [worktreeHash]
  local repo="$1" head="${4:-}" hash="${5:-}"
  [ -n "$head" ] || head="$(sgit "$repo" rev-parse HEAD)"
  [ -n "$hash" ] || hash="$(cd "$repo" && bash "$HERE/../scope.sh" | jq -r '.worktreeHash')"
  mkdir -p "$repo/.pr-self-review"
  jq -n --arg m "$2" --arg v "$3" --arg h "$head" --arg w "$hash" \
    '{mode:$m, verdict:$v, headSha:$h, worktreeHash:$w, counts:{critical:0}}' \
    >"$repo/.pr-self-review/latest.json"
}

run() { # repo command -> "exit<TAB>stderr"
  local err code
  err="$(cd "$2" && printf '%s' "$(hook "$3")" | bash "$GATE" 2>&1 >/dev/null)"; code=$?
  # refuse()'s message is deliberately multi-line (readable for the model on
  # the other end). `cut -f1`/`cut -f2` split on tab per *line*, so any line
  # after the first — having no tab — passes straight through untouched for
  # every -f, corrupting the exit-code field. Collapse newlines first so the
  # whole thing is one cut-safe line; no assertion needle below spans a
  # newline, so the substitution never hides one.
  printf '%s\t%s' "$code" "${err//$'\n'/ }"
}

# --- an unrelated command is never touched -------------------------------------
repo="$(new_repo)"
assert_eq "$(run x "$repo" 'ls -la' | cut -f1)" '0' 'the hook ignores commands it does not guard'
rm -rf "$repo"

# --- a read-only text tool that merely mentions the phrase is not guarded ------
# grep/rg/cat/etc. inspecting a file cannot publish anything. This replaced a
# --dry-run/--help flag exemption that lived here for two rounds: it matched
# the flag anywhere in the string, including inside a quoted argument value,
# so `gh pr create --title "feat: add --dry-run flag"` was exempt and would
# have opened an unreviewed PR. The allowlist below is anchored to the first
# token instead — nothing later in the string can satisfy it.
repo="$(new_repo)"
assert_eq "$(run x "$repo" 'grep -rn "git push" AGENTS.md' | cut -f1)" '0' \
  'grep inspecting a file that mentions git push is not a push'
rm -rf "$repo"

# --- but the allowlist is anchored: a separator disqualifies it immediately ----
repo="$(new_repo)"
assert_eq "$(run x "$repo" 'grep -rn "git push" AGENTS.md && git push' | cut -f1)" '2' \
  'a real push riding along after the grep is still guarded'
rm -rf "$repo"

# --- the flag exemption is gone: this is the accepted cost, not a hole ---------
# git is not on the read-only allowlist, so a dry run is refused just like a
# real one. Cheaper than the alternative: an exemption keyed on the flag text
# cannot distinguish a real --dry-run from one quoted inside an unrelated
# argument (see the next test) — that hole is worse than this false positive.
repo="$(new_repo)"
assert_eq "$(run x "$repo" 'git push --dry-run' | cut -f1)" '2' \
  'git push --dry-run is guarded again, deliberately — do not re-add this exemption'
rm -rf "$repo"

# --- the quoted-value hole the old exemption opened is now closed --------------
repo="$(new_repo)"
assert_eq "$(run x "$repo" 'gh pr create --title "feat: add --dry-run flag"' | cut -f1)" '2' \
  'a --dry-run mention inside a quoted title no longer exempts the PR'
rm -rf "$repo"

# --- the substring-matching contract, pinned so hardening cannot drift it ------
# These are documented gaps, not bugs: `guard=push` only fires on a literal,
# contiguous "git push" — see the comment above the case in gate.sh.
repo="$(new_repo)"
assert_eq "$(run x "$repo" 'git -C /tmp/foo push' | cut -f1)" '0' \
  'git -C <path> push is a known false negative — unguarded today, on record'
assert_eq "$(run x "$repo" 'gh pr list' | cut -f1)" '0' \
  'gh pr list is not a publishing command and stays ignored'
rm -rf "$repo"

# --- no verdict at all blocks the push -----------------------------------------
repo="$(new_repo)"
res="$(run x "$repo" 'git push origin feat/x')"
assert_eq "$(printf '%s' "$res" | cut -f1)" '2' 'a push with no review is blocked'
assert_contains "$(printf '%s' "$res" | cut -f2)" 'pr-self-review' 'and the model is told what to run'
rm -rf "$repo"

# --- a fresh gates run is enough for a push ------------------------------------
repo="$(new_repo)"
write_verdict "$repo" gates pass
assert_eq "$(run x "$repo" 'git push' | cut -f1)" '0' 'a fresh gates run lets the push through'
rm -rf "$repo"

# --- but not for a PR ----------------------------------------------------------
repo="$(new_repo)"
write_verdict "$repo" gates pass
res="$(run x "$repo" 'gh pr create --fill')"
assert_eq "$(printf '%s' "$res" | cut -f1)" '2' 'gh pr create needs a full run'
assert_contains "$(printf '%s' "$res" | cut -f2)" 'full' 'and says which mode is missing'
rm -rf "$repo"

# --- a fresh full pass DOES allow a PR (the fourth cell of the 2x2) ------------
repo="$(new_repo)"
write_verdict "$repo" full pass
assert_eq "$(run x "$repo" 'gh pr create' | cut -f1)" '0' 'a fresh full pass lets gh pr create through'
rm -rf "$repo"

# --- a blocked verdict stops both ----------------------------------------------
# No pushBlocked key at all: an older or hand-written verdict must fail closed,
# which is why the check below is `= false` and not `!= true`.
repo="$(new_repo)"
write_verdict "$repo" full blocked
assert_eq "$(run x "$repo" 'gh pr create' | cut -f1)" '2' 'a blocked verdict stops the PR'
assert_eq "$(run x "$repo" 'git push' | cut -f1)" '2' \
  'and a verdict with no pushBlocked key fails closed on the push'
rm -rf "$repo"

# --- the push/PR split: a Track B critical stops the PR and not the push -------
# severity.md §"The two sources are not equal": a Track A failure is critical by
# definition and stops both; a Track B critical is a model's opinion that never
# reached a `gates`-mode push, and the acceptance run had the security agent
# grade a real path traversal `minor`, so it is not trustworthy enough to stop
# one. report.sh decides which is which and records `pushBlocked`.
patch_verdict() { # repo jq-expr
  local tmp; tmp="$(mktemp)"
  jq "$2" "$1/.pr-self-review/latest.json" >"$tmp" && mv "$tmp" "$1/.pr-self-review/latest.json"
}

repo="$(new_repo)"
write_verdict "$repo" full blocked
patch_verdict "$repo" '.pushBlocked = false'
assert_eq "$(run x "$repo" 'git push' | cut -f1)" '0' \
  'a blocked verdict whose criticals are all Track B lets the push through'
res="$(run x "$repo" 'gh pr create')"
assert_eq "$(printf '%s' "$res" | cut -f1)" '2' 'and still refuses the PR'
assert_contains "$(printf '%s' "$res" | cut -f2)" 'blocked' 'naming the verdict'
rm -rf "$repo"

repo="$(new_repo)"
write_verdict "$repo" full blocked
patch_verdict "$repo" '.pushBlocked = true'
assert_eq "$(run x "$repo" 'git push' | cut -f1)" '2' \
  'a deterministic critical stops the push as well'
rm -rf "$repo"

# --- but incomplete is never negotiable ----------------------------------------
# A crashed subagent is not a Track B opinion about a line; it is a review that
# did not happen. pushBlocked is only ever consulted on `blocked`.
repo="$(new_repo)"
write_verdict "$repo" full incomplete
patch_verdict "$repo" '.pushBlocked = false'
assert_eq "$(run x "$repo" 'git push' | cut -f1)" '2' \
  'incomplete blocks the push whatever pushBlocked says'
rm -rf "$repo"

# --- incomplete blocks, exactly like blocked -----------------------------------
repo="$(new_repo)"
write_verdict "$repo" full incomplete
assert_eq "$(run x "$repo" 'gh pr create' | cut -f1)" '2' 'incomplete is not a pass'
rm -rf "$repo"

# --- a new commit makes the verdict stale --------------------------------------
repo="$(new_repo)"
write_verdict "$repo" full pass
printf 'more\n' >"$repo/README.md"
sgit "$repo" add -A && sgit "$repo" commit -qm "later"
res="$(run x "$repo" 'git push')"
assert_eq "$(printf '%s' "$res" | cut -f1)" '2' 'a commit after the review invalidates it'
assert_contains "$(printf '%s' "$res" | cut -f2)" 'stale' 'and the reason is named'
rm -rf "$repo"

# --- an uncommitted edit makes it stale too ------------------------------------
# .pr-self-review/ IS gitignored here (new_repo), so this exercises the
# generic arm of the staleness branch, not the check-ignore one below. Pin
# its message too: both arms exit 2, so if check-ignore detection ever
# regressed (path form changed, trailing slash dropped), a genuinely stale
# verdict here would silently start reporting the misleading "add
# .pr-self-review/ to .gitignore" message instead, with the suite still green
# on the exit-code-only assertion above.
repo="$(new_repo)"
write_verdict "$repo" full pass
printf 'dirty\n' >>"$repo/README.md"
res="$(run x "$repo" 'git push')"
assert_eq "$(printf '%s' "$res" | cut -f1)" '2' 'an uncommitted edit invalidates it'
assert_contains "$(printf '%s' "$res" | cut -f2)" 'working tree changed' \
  'with the genuine-staleness message, not the gitignore one'
rm -rf "$repo"

# --- an un-ignored .pr-self-review names its own defect, not a phantom edit ----
# Plain make_repo, not new_repo: no .gitignore, so latest.json becomes an
# untracked file the instant write_verdict writes it, and the hash it records
# (taken before the write) can never match a hash taken after. Without the
# check-ignore guard in gate.sh this would report "the working tree changed"
# forever — an unsatisfiable loop, since re-running the review only rewrites
# the same self-invalidating file.
repo="$(make_repo)"; sgit "$repo" checkout -qb feat/x
write_verdict "$repo" full pass
res="$(run x "$repo" 'git push')"
assert_eq "$(printf '%s' "$res" | cut -f1)" '2' 'an un-ignored .pr-self-review still blocks'
assert_contains "$(printf '%s' "$res" | cut -f2)" 'gitignore' \
  'but names the real, fixable cause instead of a phantom worktree edit'
rm -rf "$repo"

# --- a corrupt verdict file blocks honestly, not with a made-up reason ---------
repo="$(new_repo)"
mkdir -p "$repo/.pr-self-review"
printf '{"mode":"full", "verd' >"$repo/.pr-self-review/latest.json"
res="$(run x "$repo" 'git push')"
assert_eq "$(printf '%s' "$res" | cut -f1)" '2' 'a corrupt verdict file still blocks'
assert_contains "$(printf '%s' "$res" | cut -f2)" 'corrupt' 'and says so, not "HEAD moved"'
rm -rf "$repo"

# --- the escape hatch works ----------------------------------------------------
repo="$(new_repo)"
write_verdict "$repo" full blocked
code="$(cd "$repo" && printf '%s' "$(hook 'git push')" | PR_SELF_REVIEW_SKIP=1 bash "$GATE" >/dev/null 2>&1; printf '%s' $?)"
assert_eq "$code" '0' 'PR_SELF_REVIEW_SKIP lets an urgent push through'
assert_eq "$([ -f "$repo/.pr-self-review/bypassed" ] && printf yes || printf no)" yes \
  'and the bypass is written down rather than passing silently'
assert_contains "$(cat "$repo/.pr-self-review/bypassed")" 'git push' \
  'the record names the command that was let through'
rm -rf "$repo"

# --- a multi-line bypassed command still writes exactly one log line -----------
# report.sh reads .pr-self-review/bypassed with `jq -R . | jq -s .` — one
# entry per line. A raw multi-line command would fragment into several
# bypass entries on the next report.
repo="$(new_repo)"
write_verdict "$repo" full blocked
multiline_cmd=$'git push\nrm -rf /tmp/whatever'
code="$(cd "$repo" && printf '%s' "$(hook "$multiline_cmd")" | PR_SELF_REVIEW_SKIP=1 bash "$GATE" >/dev/null 2>&1; printf '%s' $?)"
assert_eq "$code" '0' 'a multi-line bypassed command still bypasses'
assert_eq "$(wc -l <"$repo/.pr-self-review/bypassed" | tr -d ' ')" '1' \
  "the bypass log keeps report.sh's one-entry-per-line contract"
rm -rf "$repo"

finish
