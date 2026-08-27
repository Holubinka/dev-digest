# Test smell catalogue

Check every test this diff adds or changes against each item below. Report a match
by citing the test's changed line and naming which item it is.

- **Mocking the unit under test.** The thing being tested is replaced by a fake, so
  the test proves the fake works.
- **Asserting on a mock instead of on behaviour.** `expect(spy).toHaveBeenCalled()`
  with nothing checking what the call produced. A test that pins the call graph
  rather than the result breaks on every refactor and lets real bugs through.
- **No assertion at all.** A test whose body cannot fail — no `expect`, or only
  `expect(true).toBe(true)`.
- **An assertion that restates the implementation.** When the expected value is
  computed the way the code computes it, the test cannot catch a wrong formula.
- **A snapshot standing in for a claim.** A snapshot over a structure this diff
  changed, re-recorded in the same commit, asserts only that the output equals
  itself.
- **Over-broad matching.** `expect.anything()`, `expect.any(Object)`, or a regex
  loose enough that the wrong value passes.
- **One test, many behaviours.** A test named "works" whose body exercises four
  paths: when it fails you learn nothing about which one.
- **Testing at the wrong level.** A hermetic unit test reaching for a real
  database, network or filesystem; or an integration test asserting something a
  pure-function test would pin faster and more precisely.