---
name: Flakiness patterns
description: Flag tests that can fail without the code changing — real clocks, real randomness, shared state, work that is never awaited.
---

# Flakiness patterns

A test that fails intermittently is worse than no test: it teaches the team to
re-run CI instead of reading it. Check every test this diff adds or changes
against each pattern below.

1. **Real time.** `sleep`, a `setTimeout` used as a synchronisation device, a
   polling loop with a wall-clock deadline, or an assertion about elapsed
   duration.
2. **An unfrozen clock.** `Date.now()` or `new Date()` read by the code under test
   without being injected — the test passes until it runs at midnight, across a
   month boundary, or in another timezone.
3. **Real randomness.** `Math.random()`, a generated UUID, or a randomly chosen
   port reaching an assertion.
4. **Order taken for granted.** Asserting on `Object.keys`, a `Set`'s iteration
   order, a directory listing, or a SQL result with no `ORDER BY`.
5. **State that outlives the test.** A module-level variable, a shared fixture
   mutated in place, a database row a sibling test also writes, or a mock that is
   never reset between tests.
6. **Work that is never awaited.** A promise created and dropped, a `forEach` with
   an async callback, an assertion that runs before the effect it checks.
7. **Concurrency assumed away.** Two tests writing the same key while the runner
   executes files in parallel.

Cite the changed test line, say which of the seven it is, and say what makes it
flip.
