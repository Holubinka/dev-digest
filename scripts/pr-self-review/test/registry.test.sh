#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
. "$HERE/lib.sh"
REGISTRY="$HERE/../registry.sh"

# --- a lock entry with no directory is critical --------------------------------
repo="$(make_repo)"
mkdir -p "$repo/.claude/skills/present"
printf -- '---\nname: present\ndescription: "x"\n---\n# x\n' \
  >"$repo/.claude/skills/present/SKILL.md"
printf '{"version":1,"skills":{"present":{"source":"a"},"ghost":{"source":"b"}}}\n' \
  >"$repo/skills-lock.json"
ln -s ../.claude/skills "$repo/.cursor-skills-tmp" 2>/dev/null || true
mkdir -p "$repo/.cursor"
ln -s ../.claude/skills "$repo/.cursor/skills"

out="$(cd "$repo" && bash "$REGISTRY")"
assert_json "$out" '[.[] | select(.message | contains("ghost"))] | length' '1' \
  'reports the locked skill with no directory'
assert_json "$out" '[.[] | select(.message | contains("ghost"))][0].severity' 'critical' \
  'a missing locked directory is critical'
rm -rf "$repo"

# --- a frontmatter name that disagrees with the directory is critical -----------
repo="$(make_repo)"
mkdir -p "$repo/.claude/skills/alpha" "$repo/.cursor"
ln -s ../.claude/skills "$repo/.cursor/skills"
printf -- '---\nname: beta\ndescription: "x"\n---\n# x\n' \
  >"$repo/.claude/skills/alpha/SKILL.md"
printf '{"version":1,"skills":{}}\n' >"$repo/skills-lock.json"

out="$(cd "$repo" && bash "$REGISTRY")"
assert_json "$out" '[.[] | select(.message | contains("frontmatter name"))] | length' '1' \
  'reports the name/directory mismatch'
assert_json "$out" '[.[] | select(.message | contains("frontmatter name"))][0].severity' \
  'critical' 'a name mismatch is critical'
rm -rf "$repo"

# --- a missing .cursor/skills symlink is major ---------------------------------
repo="$(make_repo)"
mkdir -p "$repo/.claude/skills/alpha"
printf -- '---\nname: alpha\ndescription: "x"\n---\n# x\n' \
  >"$repo/.claude/skills/alpha/SKILL.md"
printf '{"version":1,"skills":{}}\n' >"$repo/skills-lock.json"

out="$(cd "$repo" && bash "$REGISTRY")"
assert_json "$out" '[.[] | select(.message | contains(".cursor/skills"))][0].severity' \
  'major' 'a missing .cursor/skills symlink is major'
rm -rf "$repo"

# --- a clean registry produces no critical -------------------------------------
repo="$(make_repo)"
mkdir -p "$repo/.claude/skills/alpha" "$repo/.cursor"
ln -s ../.claude/skills "$repo/.cursor/skills"
printf -- '---\nname: alpha\ndescription: "x"\n---\n# x\n' \
  >"$repo/.claude/skills/alpha/SKILL.md"
printf '{"version":1,"skills":{"alpha":{"source":"a"}}}\n' >"$repo/skills-lock.json"

out="$(cd "$repo" && bash "$REGISTRY")"
assert_json "$out" '[.[] | select(.severity == "critical")] | length' '0' \
  'a consistent registry has no critical finding'
rm -rf "$repo"

# --- an unlocked directory is a note, never a failure --------------------------
repo="$(make_repo)"
mkdir -p "$repo/.claude/skills/ours" "$repo/.cursor"
ln -s ../.claude/skills "$repo/.cursor/skills"
printf -- '---\nname: ours\ndescription: "x"\n---\n# x\n' \
  >"$repo/.claude/skills/ours/SKILL.md"
printf '{"version":1,"skills":{}}\n' >"$repo/skills-lock.json"

out="$(cd "$repo" && bash "$REGISTRY")"
assert_json "$out" '[.[] | select(.message | contains("not in skills-lock"))][0].severity' \
  'note' 'an unlocked directory is informational — CLAUDE.md says those are ours'
rm -rf "$repo"

finish
