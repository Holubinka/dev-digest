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

# Print the path to a throwaway git repo containing one commit on `main`.
# Callers are responsible for `rm -rf`.
make_repo() {
  local dir
  dir="$(mktemp -d)"
  git -C "$dir" init -q -b main
  git -C "$dir" config user.email "test@example.com"
  git -C "$dir" config user.name "Test"
  git -C "$dir" config commit.gpgsign false
  printf 'seed\n' >"$dir/README.md"
  git -C "$dir" add -A
  git -C "$dir" commit -qm "init"
  printf '%s' "$dir"
}
