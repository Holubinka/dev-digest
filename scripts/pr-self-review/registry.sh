#!/usr/bin/env bash
#
# Skills-registry consistency check. Pure function over the working tree —
# no git history, no diff, no model. Prints a JSON array of findings and
# always exits 0; the caller decides what a finding means.
#
# Checks:
#   critical  a skills-lock.json entry with no directory
#   critical  SKILL.md frontmatter `name` disagreeing with its directory
#   major     the .cursor/skills symlink promised by .claude/skills/README.md
#   major     a SKILL.md over the 500-line authoring cap
#   note      a directory absent from skills-lock.json (CLAUDE.md: ours to edit)
#
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

SKILLS_DIR=".claude/skills"
LOCK="skills-lock.json"

findings="[]"

add() { # severity file line message fix
  findings="$(
    printf '%s' "$findings" | jq \
      --arg sev "$1" --arg file "$2" --argjson line "$3" \
      --arg msg "$4" --arg fix "$5" \
      '. + [{severity:$sev, source:"gate registry", file:$file,
             line:$line, message:$msg, fix:$fix}]'
  )"
}

# --- locked entries must have a directory -------------------------------------
if [ -f "$LOCK" ]; then
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    if [ ! -d "$SKILLS_DIR/$name" ]; then
      add critical "$LOCK" 1 \
        "skills-lock.json pins \"$name\" but $SKILLS_DIR/$name does not exist" \
        "restore the directory, or drop the entry from skills-lock.json"
    fi
  done < <(jq -r '.skills | keys[]' "$LOCK")
fi

# --- every skill directory ----------------------------------------------------
if [ -d "$SKILLS_DIR" ]; then
  for dir in "$SKILLS_DIR"/*/; do
    [ -d "$dir" ] || continue
    name="$(basename "$dir")"
    skill="$dir/SKILL.md"
    skill="${skill//\/\///}"

    if [ ! -f "$skill" ]; then
      add critical "$SKILLS_DIR/$name" 1 \
        "$name has no SKILL.md" \
        "add SKILL.md, or remove the directory"
      continue
    fi

    # frontmatter name must match the directory
    declared="$(sed -n '1,20{/^name:[[:space:]]*/{s/^name:[[:space:]]*//;s/^["'\'']//;s/["'\'']$//;p;q;};}' "$skill")"
    if [ "$declared" != "$name" ]; then
      add critical "$skill" 2 \
        "frontmatter name \"$declared\" disagrees with the directory \"$name\"" \
        "set name: $name — the Agent Skills spec requires they match"
    fi

    lines="$(wc -l <"$skill" | tr -d ' ')"
    if [ "$lines" -gt 500 ]; then
      add major "$skill" "$lines" \
        "SKILL.md is $lines lines, over the 500-line cap in .claude/skills/README.md" \
        "move detail into a topic file and link it from the navigation table"
    fi

    if [ -f "$LOCK" ] && ! jq -e --arg n "$name" '.skills | has($n)' "$LOCK" >/dev/null; then
      add note "$skill" 1 \
        "$name is not in skills-lock.json, so it counts as locally authored" \
        "no action if that is true; add a lock entry if it is a pinned upstream copy"
    fi
  done
fi

# --- the Cursor symlink -------------------------------------------------------
if [ ! -L ".cursor/skills" ]; then
  add major ".claude/skills/README.md" 3 \
    ".cursor/skills is not a symlink, but README.md documents it as one" \
    "run: mkdir -p .cursor && ln -s ../.claude/skills .cursor/skills"
fi

printf '%s\n' "$findings"
