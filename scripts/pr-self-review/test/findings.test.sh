#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
. "$HERE/lib.sh"
FINDINGS="$HERE/../findings.sh"

# Runs the extractor and reports both halves of its contract at once, because
# the failure path has to be silent on stdout as well as non-zero.
run() { # input -> "<exit>|<stdout>"
  local out status
  out="$(printf '%s' "$1" | bash "$FINDINGS" 2>/dev/null)"
  status=$?
  printf '%s|%s' "$status" "$out"
}

ONE='[{"severity":"major","source":"agent security · security §A01","file":"a.ts","line":7,"message":"m","fix":"f"}]'

# --- the contract, honoured -----------------------------------------------------
out="$(printf '%s' "$ONE" | bash "$FINDINGS")"
assert_json "$out" '.[0].line' '7' 'a bare array passes through'

# --- an empty array is a genuine clean result, not a failure --------------------
res="$(run '[]')"
assert_eq "${res%%|*}" '0' 'an empty array exits 0'
assert_json "${res#*|}" 'length' '0' 'an empty array stays empty'

# --- the two shapes actually measured on feat/agent-layer -----------------------
# Both real replies wrapped the right findings in a sentence and a ```json fence.
res="$(run "Here is the report.

\`\`\`json
$ONE
\`\`\`

**Summary:** one finding.")"
assert_eq "${res%%|*}" '0' 'prose + a json fence is recovered'
assert_json "${res#*|}" '.[0].source' 'agent security · security §A01' 'the fenced findings survive intact'

res="$(run "I found this:
$ONE
That is all.")"
assert_eq "${res%%|*}" '0' 'prose around a bare array is recovered'
assert_json "${res#*|}" '.[0].file' 'a.ts' 'the unfenced findings survive intact'

# A fence with no language tag closes the same way as ```json.
res="$(run "Report:

\`\`\`
$ONE
\`\`\`")"
assert_eq "${res%%|*}" '0' 'an untagged fence is recovered'

# --- what must NOT become an empty result ---------------------------------------
# This is the whole point of the script. `[]` here would be indistinguishable
# from a clean run, so a broken agent would be the cheapest route to a pass —
# and report.sh rule 6 cannot tell the two apart either.
for bad in \
  'I could not complete the review.' \
  '' \
  '{"severity":"note","file":"a.ts"}' \
  '[1, 2, 3]' \
  '```json
{"not":"an array"}
```'
do
  res="$(run "$bad")"
  label="$(printf '%.28s' "${bad:-<empty stdin>}")"
  assert_eq "${res%%|*}" '1' "refuses: $label"
  assert_eq "${res#*|}" '' "writes nothing on stdout: $label"
done

# --- the error says what to do about it ------------------------------------------
err="$(printf 'no findings here, sorry' | bash "$FINDINGS" 2>&1 >/dev/null)"
assert_contains "$err" 'NOT' 'the refusal says it is not an empty result'
assert_contains "$err" "than 'ok'" 'the refusal names the agents.json remedy'

finish
