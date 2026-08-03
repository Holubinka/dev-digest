#!/usr/bin/env bash
# Package docs/skills/flakiness-patterns/ as an archive for the Skills import demo.
#
# The zip is NOT committed: a binary in git is not diffable, and the tests build
# their own archives in memory with fflate. This exists so a human can run the
# real import path against a real file.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$root/docs/skills/flakiness-patterns"
out="${1:-/tmp/flakiness-patterns.zip}"

[ -d "$src" ] || { echo "missing $src" >&2; exit 1; }

rm -f "$out"
( cd "$src" && zip -q -r "$out" . )

echo "wrote $out"
echo
echo "Import it from Skills → Add Skill → Import from file. Expect:"
echo "  body   ← SKILL.md"
echo "  kept   ← README.md, reference.md (evidence)"
echo "  skipped ← scripts/check.sh, lint.py (executable), diagram.svg (not Markdown)"
