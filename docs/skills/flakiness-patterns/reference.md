# Reference

Supporting notes that ship alongside the skill. They are read as evidence — the
importer lists them — but they do not become the body.

## Why intermittent failures are expensive

A suite that fails one run in twenty does not cost one twentieth of a suite that
always fails. It costs the team's belief in every other test, because the cheapest
response to a red build becomes "run it again" rather than "read it".

## The usual root causes, in rough order of frequency

1. Time — a real clock in an assertion, or a sleep standing in for synchronisation.
2. Shared state — a fixture, a module-level variable, or a row two tests both own.
3. Ordering — code that assumes a map, a set or an unordered query keeps its shape.
4. Unawaited work — the assertion runs before the effect it is checking.
