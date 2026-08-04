# Skill bodies

The human-readable originals of the skills this repo seeds, mirroring how
`docs/agent-prompts/` works for agent prompts.

> The DB is the source of truth at run time. Editing a file here changes what a
> freshly seeded workspace gets; to change a skill that already exists, edit it on
> the Skills screen (which versions the body into `skill_versions`).

| File | Type | Bound to |
|---|---|---|
| [`uncovered-branch-rubric.md`](./uncovered-branch-rubric.md) | rubric | Test Quality Reviewer |
| [`boundary-and-edge-case-rubric.md`](./boundary-and-edge-case-rubric.md) | rubric | Test Quality Reviewer |
| [`assertion-strength-rubric.md`](./assertion-strength-rubric.md) | rubric | Test Quality Reviewer |
| [`test-smell-catalogue.md`](./test-smell-catalogue.md) | convention | Test Quality Reviewer |
| [`breaking-change-taxonomy.md`](./breaking-change-taxonomy.md) | rubric | API Contract Reviewer |
| [`response-schema-contract.md`](./response-schema-contract.md) | rubric | API Contract Reviewer |
| [`route-signature-checklist.md`](./route-signature-checklist.md) | convention | API Contract Reviewer |
| [`semver-discipline.md`](./semver-discipline.md) | convention | API Contract Reviewer |
| [`deprecation-policy.md`](./deprecation-policy.md) | convention | API Contract Reviewer — **imported by URL** |
| [`flakiness-patterns/`](./flakiness-patterns) | convention | Test Quality Reviewer — **imported by hand** |

The bodies are mirrored into `server/src/db/seed-skills.ts` by
`scripts/sync-seed-skills.mjs`, which escapes them into template literals. Run it
after editing any of the seeded files above; it is what keeps the two copies from
drifting.

[`fixtures/hostile-skill.md`](./fixtures/hostile-skill.md) is not a skill at all.
It is a body that trips all seven rules in `server/src/platform/skill-injection.ts`
— override, role reassignment, a forged `</untrusted>` fence, a forged `system:`
marker, categorical suppression, exfiltration to a URL, and a request for the
system prompt. Import it to watch the refusal: the skill is stored so the text
can be read, lands `enabled: false` whatever the request asked for, shows its
seven matches on the card, and `PUT /skills/:id {enabled:true}` is refused with a
`validation_error`. Do not "fix" the file; its value is that it still trips
every rule.

Two are deliberately **not** seeded, one per import path. `flakiness-patterns/` is
packaged as a third party would ship a skill — a `SKILL.md`, supporting markdown,
and executables that have no business being read — and `scripts/make-skill-zip.sh`
zips it for the file upload. `deprecation-policy.md` carries its own frontmatter
and is imported from its raw URL, so **Import from URL** is exercised by a human
too rather than asserted by a fixture.

The four bound to Test Quality Reviewer are deliberately not variations on one
another — each asks a question the others cannot:

| Skill | The question it asks |
|---|---|
| Uncovered branch rubric | which paths the code spells out are never executed |
| Boundary and edge-case rubric | which inputs change behaviour with no branch saying so |
| Assertion strength rubric | whether a test that runs would actually fail if the code were wrong |
| Test smell catalogue | whether the test's shape lets it pass for the wrong reason |

Coverage, completeness, strength, shape. A new test-quality skill that does not
answer a question outside that list is probably an edit to one of them.

The five bound to API Contract Reviewer are split the same way:

| Skill | The question it asks |
|---|---|
| Breaking change taxonomy | how bad this change is for a caller |
| Response schema contract | what the reply's shape looked like before and after |
| Route signature checklist | whether a route's three places moved together |
| Semver discipline | whether the break carries a version marker |
| Deprecation policy | whether the old thing survived one release |

Severity, shape, completeness, announcement, transition.

## Writing a body

A skill is read by a model, not by a person, and the models this repo runs on
comply with **procedures** and ignore **adjectives**. Write an enumeration with a
step that produces a list, not a description of a quality:

> List every branch this diff introduces. For each, name the test that executes
> it. Report the ones with no such test.

not

> Make sure the tests are thorough.

Anchor findings to changed lines. `groundFindings` drops any finding whose range
misses a diff hunk, so a rule that tells the model to cite the file where a
missing test *should* live produces findings nobody ever sees.
