# Assertion strength rubric

Coverage tells you a line ran. This asks the harder question: would the test
FAIL if the code were wrong?

For every test this diff adds or changes, work through these steps.

1. State what the test claims, in one sentence, from its name and its
   assertions.
2. Name the smallest change to the production code that would break that claim.
   Pick from what the diff actually contains: a flipped comparison, an off-by-one
   in a bound, two arguments swapped, a dropped `await`, a constant changed from
   `100` to `10`, an early return added, a sign inverted.
3. Decide whether the test would fail on that change. If it would still pass,
   that is the finding: name the change that survives, and say which assertion
   fails to notice it.
4. Check the assertion is about the RESULT, not about the journey. Asserting that
   a function was called, that a value is truthy, or that `typeof x` is
   `'number'` survives nearly every change worth catching — `NaN` is a number.
5. Check the expected value is written down rather than computed. If the test
   derives what it expects the same way the code derives it, the two are wrong
   together and the test cannot tell you so.

Report at most one finding per test, and name the surviving change in it. A test
that would catch every change you can think of is a good test — say nothing about
it.