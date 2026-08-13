#!/usr/bin/env bash
# PreToolUse gate for the `spec-creator` agent. Wired from that agent's own
# frontmatter, so it is active only while that subagent runs — no other agent,
# and not the main session, ever reaches this script.
#
# Exit 2 is the only value Claude Code treats as a block; stderr is handed back
# to the agent as the reason. Any other non-zero exit is reported to the user
# and the tool call proceeds, so every failure path here must exit 0 or 2.
set -uo pipefail

payload=$(cat)

deny() { printf '%s\n' "$1" >&2; exit 2; }

command -v jq >/dev/null 2>&1 || deny "spec-creator write-gate cannot run: jq is not installed. Install jq, or the gate cannot verify where you are writing."

tool=$(printf '%s' "$payload" | jq -r '.tool_name // empty')
repo="${CLAUDE_PROJECT_DIR:-$(pwd)}"

relative_to_repo() { # absolute-or-relative path -> repo-relative, or the input unchanged
  local p="$1"
  case "$p" in
    "$repo"/*) printf '%s' "${p#"$repo"/}" ;;
    /*)        printf '%s' "$p" ;;
    ./*)       printf '%s' "${p#./}" ;;
    *)         printf '%s' "$p" ;;
  esac
}

case "$tool" in
  Write|Edit|NotebookEdit)
    path=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
    [ -z "$path" ] && deny "spec-creator write-gate: the call carries no file_path, so the gate cannot tell where it writes. Refused."
    rel=$(relative_to_repo "$path")

    case "$rel" in
      /*|../*|*/../*)
        deny "spec-creator may not write outside the repository. Refused: $path" ;;
      e2e/specs/*)
        deny "e2e/specs/ holds live browser tests (*.flow.json), not specifications. Nothing you produce belongs there. Refused: $rel" ;;
      *)
        # A case pattern's * spans slashes, so the allowed shape is matched by
        # regex instead: exactly one file directly inside a specs/ folder.
        [[ $rel =~ ^(specs|server/specs|client/specs|reviewer-core/specs)/[^/]+\.md$ ]] && exit 0
        deny "spec-creator writes specifications and nothing else. Allowed: specs/<name>.md for work spanning packages, or <module>/specs/<name>.md (server, client, reviewer-core) for work inside one. Refused: $rel

If the specification is right and some other file is wrong, that is a finding for your report, not an edit you make." ;;
    esac
    ;;

  Bash)
    # Bash is for reading. A mutator counts only where a command actually starts:
    # the beginning of the string, or just after ; & | ( or a newline. Matching the
    # bare substring refused `ls server/src/platform server/src/modules`, because
    # "platform " ends in "rm ". Redirections are still not parsed, so `cmd > file`
    # gets through. The wall is on Write/Edit; this is a second line, not the first.
    cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty')
    starts='(^|[;&|(]|`)[[:space:]]*'

    if [[ $cmd =~ ${starts}(rm|rmdir|mv|mkdir|tee|truncate)([[:space:]]|$) ]] ||
       [[ $cmd =~ ${starts}sed[[:space:]]+-i ]] ||
       [[ $cmd =~ ${starts}git[[:space:]]+(add|commit|push|checkout|stash|mv|rm|restore)([[:space:]]|$) ]] ||
       [[ $cmd =~ ${starts}(npm|pnpm)[[:space:]]+(run|install|add|exec|i)([[:space:]]|$) ]] ||
       [[ $cmd =~ ${starts}gh[[:space:]]+pr[[:space:]]+create([[:space:]]|$) ]]; then
      deny "spec-creator's Bash is for reading only — git log, git show, git diff, rg, ls, cat, find. This command writes or runs a script. Refused: $cmd"
    fi
    exit 0
    ;;

  *)
    exit 0 ;;
esac
