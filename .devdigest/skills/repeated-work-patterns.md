# Repeated work patterns

The expensive thing in this system is an LLM call, and everything else is noise
beside it. So this rubric is not about microseconds. It is about work done more
times than its inputs require, and about allocations made before anything can
bound them — both of which change cost, and one of which changes correctness.

Check every changed line against the four below.

## 1. Work keyed on something narrower than the loop it sits in

For each call inside a loop, name its arguments. If none of them varies with the
loop variable, the call belongs outside it.

**Bad** — resolved once per agent, though no agent is an input:

```ts
for (const { agent, runId } of jobs) {
  const callers = await this.buildCallersDigest(pull.repoId, diff, log);
```

Three index queries became 3N, and two agents reviewing the same PR could see
*different* callers if the indexer wrote between their runs. The cost is the small
half; the inconsistency is the real one.

**Good** — resolved once for the batch, beside the diff and the intent, and
selected per agent afterwards.

## 2. N+1 against the database

A query inside a loop over rows another query returned. In this repo the list
rollups are deliberately read-time: one `inArray` over the page's ids, grouped in
JS. A per-row `select` in that shape is the finding.

"N+1" names ONE specific shape — a query, repeated once per row of an EARLIER
query's result, where one batched query would do. Use the word only when both
halves are true and point at each other: name the loop AND the row source it
iterates. If you cannot name the loop, it is not N+1, whatever else it might be.

Three shapes that are commonly mislabeled "N+1" and are not:
- `Promise.all([queryA(), queryB()])` — a FIXED, small number of calls running
  CONCURRENTLY is the fix N+1 asks for, not the defect. Never flag it as N+1.
- One call with no loop anywhere near it — `container.db.update(...).where(...)`
  inside a single request handler is one statement, not N of anything.
- A loop with no DATABASE query inside it — reading N files, spawning N
  subprocesses, or making N HTTP/LLM calls is real, reportable repeated work (see
  §1 and §4, and the External APIs section of the main prompt), but it is not
  N+1, which is a DATABASE term. Naming the wrong mechanism costs the same as
  missing it: the author fixes the wrong thing or dismisses a real finding
  because the diagnosis was wrong.

## 3. An allocation made before the thing that bounds it

`fs.readFile` builds the whole string, then the caller truncates it. A 400 MB file
is already in memory by the time the cap runs. The bound has to be at the syscall —
`open` plus a fixed buffer — or it is not a bound.

The same shape appears wherever a cap is applied to a value *after* it exists:
count caps applied in JS over rows a query already fetched, a `slice` after a
`map`, a truncation after a `join`.

## 4. Paying for the same tokens twice

- Content sent to a model that no reviewer can act on — a generated snapshot, a
  lockfile, build output.
- A value recomputed per agent that the batch already holds.
- A retry that re-sends the entire prompt when the failure was in parsing the
  reply.

## What is not a finding

Sequential `await`s that could be `Promise.all`, when EVERY call in the sequence is
cheap on its own (a single local DB read, a single quick lookup) and the run is
already dominated by one LLM call elsewhere. Shaving 40 ms off a 30-second run is
not worth a non-deterministic log order. Say nothing.

This does NOT cover two shapes that look similar but are not cheap: the LLM/model
calls themselves running sequentially (N agents means N times the latency, not
40 ms — this is rubric #1's cost model, not something to wave through), or a loop of
many local/subprocess calls whose COMBINED cost is itself seconds (ten-plus git
reads, ripgrep spawns, file reads). Both are findings; state the multiplier.

Cite the changed line. State the multiplier — "3 queries become 3N" — not "this
could be faster".
