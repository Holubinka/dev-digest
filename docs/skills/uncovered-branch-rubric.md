# Uncovered branch rubric

Work through these steps in order and report what they turn up.

1. List every branch this diff introduces or modifies. A branch is: an `if`, an
   `else` / `else if`, a ternary, a `switch` case, a `catch`, an early `return` or
   `throw`, a `??` or `||` default, an optional chain that can short-circuit, a
   loop body that can run zero times, and each new member of a union or enum.
2. For each branch, name the added or changed test that executes it, quoting that
   test's name.
3. Report every branch for which step 2 found nothing. Cite the changed source
   line that carries the branch — not the test file, and not the file where the
   missing test would live.
4. A branch reachable only through an error path still counts. So does the
   zero-iteration case of a loop and the empty-collection case of a query.
5. For the branches that do have a test, check their boundaries: if a test covers
   `n > 0`, is there one for `n === 0`? If it covers a non-empty string, is there
   one for `""`? Report a missing boundary only when crossing it changes
   behaviour.

A test that drives a branch through a public entry point covers it. Do not report
a branch as uncovered merely because the test reaches it indirectly.
