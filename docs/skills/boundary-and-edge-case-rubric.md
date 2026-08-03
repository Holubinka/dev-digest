# Boundary and edge-case rubric

The branch rubric finds the cases the code spells out as an `if`. This one finds
the cases it does not: the inputs where behaviour changes without any branch
saying so.

Work through these steps in order.

1. List every value this diff accepts from outside — a parameter, a request
   field, a row read from the database, a number parsed from text. For each, say
   what type it is and where its behaviour changes.
2. For each value, check the boundaries below that apply to it, and name the
   added or changed test that pins each one. Report every boundary with no such
   test.

   - **Numbers.** Zero. Negative. The exact value of any `min`/`max` bound, and
     one on each side of it. A non-integer where an integer is assumed. `NaN` and
     `Infinity`, when they can arrive.
   - **Money and rounding.** A value that lands exactly halfway — `1.005`, `2.5`
     — where binary floating point does not do what decimal arithmetic would.
     Any `Math.round` over a scaled amount needs a test at the half.
   - **Strings.** Empty. Whitespace only. Longer than any stated cap. Characters
     outside ASCII, including ones that are two code units.
   - **Collections.** Empty. Exactly one element. The first and the last element,
     when position matters. Duplicates, when uniqueness is assumed.
   - **Absence.** `null`, `undefined`, and a key that is missing entirely, where
     the three are not the same thing.
   - **Time.** A boundary the code can cross while running: midnight, the end of
     a month or a year, a daylight-saving shift, a timezone that is not the
     machine's.

3. Report a boundary only when crossing it changes behaviour. A cap that nothing
   approaches, or a string the system always generates itself, is not a finding.

Cite the changed source line that introduces the value, not the test file and not
the file where the missing test would live.
