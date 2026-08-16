#!/usr/bin/env bash
#
# stats.sh — what a multi-agent run actually cost, from the transcripts it left.
#
# Contract:
#   in   $1  a session's tasks/ directory (the one holding <agentId>.output JSONL
#            files). Defaults to $CLAUDE_TASKS_DIR.
#   out  stdout  one JSON object: { totals, agents[], duplication{} }
#   exit 0 always when the directory is readable; 2 when it is not.
#
# Deterministic and read-only: no model, no network, nothing written. Every number
# here comes from the `usage` block Claude Code records on each assistant message,
# so it is the billed figure rather than an estimate.
#
# The number that matters is `cache_read`. `AGENTS.md` § What a session costs is
# about exactly this: the bill is re-reading context, not producing output, and
# an agent's output/cache_read ratio says whether it was thinking or re-reading.
set -euo pipefail

DIR="${1:-${CLAUDE_TASKS_DIR:-}}"
[ -n "$DIR" ] && [ -d "$DIR" ] || { echo "usage: stats.sh <tasks-dir>" >&2; exit 2; }

shopt -s nullglob
FILES=("$DIR"/*.output)
[ ${#FILES[@]} -gt 0 ] || { echo '{"totals":{"agents":0},"agents":[],"duplication":{}}'; exit 0; }

# One pass per agent file. `input_filename` keys the grouping, so a file that is
# still being written (a live agent) simply contributes what it has so far.
jq -n --slurpfile _ /dev/null '
  # ---- per-agent fold -------------------------------------------------------
  def agent_of($rows):
    ($rows | map(select(.type == "assistant"))) as $a
    | ($rows | map(select(.type == "user"))) as $u
    | ($a | map(.message.content // [] | map(select(.type == "tool_use"))) | add // []) as $tools
    | {
        agent_id:  ($rows | map(.agentId // empty) | first),
        model:     ($a | map(.message.model // empty) | first),
        effort:    ($a | map(.effort // empty) | first),
        branch:    ($rows | map(.gitBranch // empty) | first),
        first_ts:  ($rows | map(.timestamp // empty) | min),
        last_ts:   ($rows | map(.timestamp // empty) | max),
        turns:     ($a | length),
        prompts:   ($u | length),
        tool_calls: ($tools | length),
        # Times the orchestrator resumed this agent after it had reported. A resume
        # marks a brief that was incomplete the first time — the reason is never in
        # the log, but whoever sent the message knows it.
        #
        # The marker is origin.kind == "coordinator" on a user record, NOT a count
        # of distinct promptId values: prompt ids also change on internal
        # continuations, which made an agent that was dispatched once and never
        # resumed report four dispatches.
        resumes: ($rows | map(select(.type == "user" and (.origin.kind? == "coordinator"))) | length),
        # Tool calls spent before the agent first wrote anything. A long tail here
        # is the scouting bill the brief left unpaid: facts it had to establish for
        # itself. Null when the agent never wrote — a researcher or a reviewer,
        # where the whole run is reading and the number would mean nothing.
        scout_calls:
          (($tools | map(.name)) as $seq
           | ([($seq | index("Edit")), ($seq | index("Write"))] | map(select(. != null)) | min) as $firstWrite
           | if $firstWrite == null then null
             else ($seq[0:$firstWrite] | map(select(. == "Read" or . == "Grep" or . == "Glob" or . == "Bash")) | length)
             end),
        tools:     ($tools | group_by(.name) | map({key: .[0].name, value: length}) | from_entries),
        output:      ($a | map(.message.usage.output_tokens // 0) | add // 0),
        input:       ($a | map(.message.usage.input_tokens // 0) | add // 0),
        cache_read:  ($a | map(.message.usage.cache_read_input_tokens // 0) | add // 0),
        cache_write: ($a | map(.message.usage.cache_creation_input_tokens // 0) | add // 0),
        # Every path this agent opened with Read, and every path it wrote.
        reads:  ($tools | map(select(.name == "Read") | .input.file_path // empty) | unique),
        writes: ($tools | map(select(.name == "Edit" or .name == "Write") | .input.file_path // empty) | unique),
      };

  [ inputs ] as $all
  | ($all | map(select(type == "object")) | group_by(.__file) | map(agent_of(.))) as $agents
  | ($agents | map(select(.turns > 0)) | sort_by(.first_ts)) as $agents
  | {
      totals: {
        agents:      ($agents | length),
        turns:       ($agents | map(.turns) | add // 0),
        tool_calls:  ($agents | map(.tool_calls) | add // 0),
        output:      ($agents | map(.output) | add // 0),
        cache_read:  ($agents | map(.cache_read) | add // 0),
        cache_write: ($agents | map(.cache_write) | add // 0),
        # How many times the whole run re-read context per token it produced.
        reread_ratio: (($agents | map(.cache_read) | add // 0) / (($agents | map(.output) | add // 1) | if . == 0 then 1 else . end) | floor),
      },
      agents: $agents,
      duplication: {
        # A file opened by more than one agent is a fact the briefs did not carry.
        files_read_by_many:
          ($agents | map(.reads[] as $p | {p: $p, a: .agent_id}) | group_by(.p)
            | map({file: .[0].p, agents: (map(.a) | unique | length)})
            | map(select(.agents > 1)) | sort_by(-.agents)),
        # Two agents writing one file is a collision the packaging should have prevented.
        files_written_by_many:
          ($agents | map(.writes[] as $p | {p: $p, a: .agent_id}) | group_by(.p)
            | map({file: .[0].p, agents: (map(.a) | unique | length)})
            | map(select(.agents > 1)) | sort_by(-.agents)),
      },
    }
' < <(
  for f in "${FILES[@]}"; do
    # Tag every record with its file so jq can group by agent, and drop the
    # non-object lines these transcripts occasionally carry.
    jq -c --arg f "$(basename "$f")" 'select(type == "object") | . + {__file: $f}' "$f" 2>/dev/null || true
  done
)
