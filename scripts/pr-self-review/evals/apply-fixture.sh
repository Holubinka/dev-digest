#!/usr/bin/env bash
#
# Checks out a pr-self-review eval fixture as a real branch, so /pr-self-review --full has an
# actual diff to scope. Fixtures (the patch + the answer key) live in
# .claude/skills/pr-self-review/eval-fixtures/fixtures/<name>/ — this script is the repo-specific git
# plumbing that folder deliberately does not carry, so packaging the skill folder alone still
# ships every test case with it.
#
#   bash scripts/pr-self-review/evals/apply-fixture.sh <fixture-name>
#
# Leaves the repo on branch eval/pr-self-review/<fixture-name>, one commit ahead of `main`, with
# the fixture's diff.patch applied. From there: run /pr-self-review --full in Claude Code, then
# bash scripts/pr-self-review/evals/grade.sh <fixture-name>.
#
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

name="${1:?usage: apply-fixture.sh <fixture-name>}"
FIXTURES_DIR=".claude/skills/pr-self-review/eval-fixtures/fixtures"
patch="$FIXTURES_DIR/$name/diff.patch"

[ -f "$patch" ] || {
  echo "no such fixture: $patch" >&2
  echo "available: $(ls "$FIXTURES_DIR" 2>/dev/null | tr '\n' ' ')" >&2
  exit 1
}

if [ -n "$(git status --porcelain)" ]; then
  echo "working tree is not clean — commit, stash, or discard before applying a fixture" >&2
  exit 1
fi

branch="eval/pr-self-review/$name"

# The -D is scoped to our own eval/pr-self-review/* namespace only, so re-running a fixture
# against a moved `main` is a fresh checkout rather than a stale, once-applied branch.
git checkout main >/dev/null
git branch -D "$branch" >/dev/null 2>&1 || true
git checkout -b "$branch" >/dev/null

git apply "$patch"
git add -A
git commit -q -m "eval fixture: $name"

echo "on $branch — run /pr-self-review --full now, then:"
echo "  bash scripts/pr-self-review/evals/grade.sh $name"
