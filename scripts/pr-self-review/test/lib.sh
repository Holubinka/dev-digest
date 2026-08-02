#!/usr/bin/env bash
# Assertions and fixtures for the pr-self-review script tests.
# Deliberately not `set -e`: a failing assertion must not abort the file.

PASSED=0
FAILED=0

assert_eq() { # actual expected label
  if [ "$1" = "$2" ]; then
    PASSED=$((PASSED + 1))
    printf '  ok   %s\n' "$3"
  else
    FAILED=$((FAILED + 1))
    printf '  FAIL %s\n       expected: %s\n       actual:   %s\n' "$3" "$2" "$1"
  fi
}

assert_contains() { # haystack needle label
  case "$1" in
    *"$2"*)
      PASSED=$((PASSED + 1))
      printf '  ok   %s\n' "$3"
      ;;
    *)
      FAILED=$((FAILED + 1))
      printf '  FAIL %s\n       %s\n       does not contain: %s\n' "$3" "$1" "$2"
      ;;
  esac
}

assert_json() { # json jq-filter expected label
  local actual
  actual="$(printf '%s' "$1" | jq -r "$2")"
  assert_eq "$actual" "$3" "$4"
}

finish() {
  printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
  [ "$FAILED" -eq 0 ]
}

# The repository these tests live in. Never a legal target for `sgit`.
#
# Derived from BASH_SOURCE, not from the current directory. `git rev-parse
# --show-toplevel` answers about wherever the suite happens to be run from, and
# outside a git repository it fails: with no `set -e` here, REAL_ROOT was then
# the empty string and the `[ "$top" = "$REAL_ROOT" ]` guard below could never
# match anything — the guard silently switched itself off in exactly the
# situation it exists for. This walk cannot fail and cannot come back empty.
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REAL_ROOT="$(cd "$LIB_DIR/../../.." && pwd)"

# And the repository the suite was *launched* from, when that is a different
# one — running these tests from another checkout must not make that checkout
# a legal target either. Empty when the cwd is not a git repo, and the guard
# treats an empty value as "no second root", never as a match.
CWD_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || printf '')"

# Run git inside a throwaway repo, and refuse anything else.
#
# `git -C "" …` does not fail — it operates on the current directory. So a
# `$repo` that came back empty turns every `git -C "$repo" checkout -qb feat/x`
# in this suite into a real branch, real commits, and a swept `git add -A` in
# the developer's own checkout. That happened once. This makes it impossible
# rather than unlikely.
sgit() {
  local dir="$1" top
  shift
  if [ -z "$dir" ]; then
    printf 'sgit: empty repo path — refusing to run git against the real tree\n' >&2
    exit 1
  fi
  if ! top="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)"; then
    printf 'sgit: %s is not a git repository\n' "$dir" >&2
    exit 1
  fi
  if [ "$top" = "$REAL_ROOT" ]; then
    printf 'sgit: refusing to mutate the real repository at %s\n' "$REAL_ROOT" >&2
    exit 1
  fi
  if [ -n "$CWD_ROOT" ] && [ "$top" = "$CWD_ROOT" ]; then
    printf 'sgit: refusing to mutate the repository the suite was launched from, at %s\n' "$CWD_ROOT" >&2
    exit 1
  fi
  git -C "$dir" "$@"
}

# Print the path to a throwaway git repo containing one commit on `main`.
# Callers are responsible for `rm -rf`.
#
# Dies rather than returning an empty path: every caller interpolates the
# result straight into `sgit "$repo"` / `cd "$repo"`, and an empty string is
# silently the current directory in both.
make_repo() {
  local dir
  if ! dir="$(mktemp -d)" || [ -z "$dir" ] || [ ! -d "$dir" ]; then
    printf 'make_repo: could not create a scratch directory\n' >&2
    exit 1
  fi
  git -C "$dir" init -q -b main
  git -C "$dir" config user.email "test@example.com"
  git -C "$dir" config user.name "Test"
  git -C "$dir" config commit.gpgsign false
  printf 'seed\n' >"$dir/README.md"
  git -C "$dir" add -A
  git -C "$dir" commit -qm "init"
  printf '%s' "$dir"
}
