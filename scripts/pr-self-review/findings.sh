#!/usr/bin/env bash
#
# Turns one subagent's raw reply into the JSON array step 3 promised.
#
#   bash scripts/pr-self-review/findings.sh < reply.txt > agent.json
#
# The output contract in SKILL.md §3 says "a JSON array and no prose". Two of
# seven measured runs on `feat/agent-layer` broke it anyway — both returned the
# right findings wrapped in a sentence and a ```json fence — so the contract is
# a request, not a guarantee, and step 3 needs to hold without it.
#
# Three attempts, in order, each on the whole input:
#
#   1. it already parses as a JSON array           → emit unchanged
#   2. strip ``` fences, then the first fenced
#      block that parses as an array               → emit that
#   3. the span from the first `[` to the last `]` → emit that
#
# ANYTHING ELSE IS A FAILURE, LOUDLY. It exits non-zero, says what it saw on
# stderr, and writes NOTHING to stdout. Emitting `[]` on a reply this cannot
# read would be the worst available behaviour: step 5 adds the array to the
# merge and a zero-length one is indistinguishable from an agent that genuinely
# found nothing, so a broken agent would become the cheapest route to a `pass`.
# `report.sh`'s rule 6 cannot catch it either — a well-formed empty array is
# exactly what a clean run looks like. The caller is expected to record that
# agent with a status other than `ok`, which is what makes the run `incomplete`.
#
# It validates shape, not content: an array whose elements are objects. Grading
# vocabulary stays with `report.sh` rule 6, which already owns it and prints
# `UNGRADED` — a second copy of the four severity names here is a second thing
# to drift.
#
set -uo pipefail

raw="$(cat)"

if [ -z "${raw//[[:space:]]/}" ]; then
  echo "findings.sh: the reply is empty. An agent that returned nothing is not" >&2
  echo "             an agent that found nothing — record it with a status other" >&2
  echo "             than 'ok' so report.sh marks the run incomplete." >&2
  exit 1
fi

# An array of objects. `[]` is legal — that is a genuine clean result.
is_findings() {
  printf '%s' "$1" | jq -e 'type == "array" and all(.[]; type == "object")' >/dev/null 2>&1
}

emit() {
  printf '%s' "$1" | jq '.'
  exit 0
}

# 1 — already the contract.
is_findings "$raw" && emit "$raw"

# 2 — fenced blocks, in order. `awk` toggles on a line whose first characters
# are ```; the language tag after it is ignored, so ```json and ``` both close.
blocks="$(printf '%s' "$raw" | awk '
  /^[[:space:]]*```/ { inblock = !inblock; if (!inblock) print "\034"; next }
  inblock { print }
')"
if [ -n "$blocks" ]; then
  while IFS= read -r -d $'\034' block; do
    is_findings "$block" && emit "$block"
  done < <(printf '%s\034' "$blocks")
fi

# 3 — the widest bracketed span. Prose on either side is dropped; prose
# CONTAINING a bracket makes this fail rather than truncate, which is correct.
span="$(printf '%s' "$raw" | sed -n '/\[/,$p' | sed '1s/^[^[]*//' | sed -e ':a' -e '$!{N;ba' -e '}' -e 's/[^]]*$//')"
if [ -n "$span" ]; then
  is_findings "$span" && emit "$span"
fi

echo "findings.sh: no JSON array of objects in the reply. It is NOT being" >&2
echo "             treated as an empty result — that would let a broken agent" >&2
echo "             pass as a clean one. Record the agent with a status other" >&2
echo "             than 'ok' and re-dispatch it. First 400 characters:" >&2
printf '%.400s\n' "$raw" >&2
exit 1
