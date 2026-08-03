# Skill bodies

The human-readable originals of the skills this repo seeds, mirroring how
`docs/agent-prompts/` works for agent prompts.

> The DB is the source of truth at run time. Editing a file here changes what a
> freshly seeded workspace gets; to change a skill that already exists, edit it on
> the Skills screen (which versions the body into `skill_versions`).

| File | Type | Bound to |
|---|---|---|
| [`uncovered-branch-rubric.md`](./uncovered-branch-rubric.md) | rubric | Test Quality Reviewer |
| [`test-smell-catalogue.md`](./test-smell-catalogue.md) | convention | Test Quality Reviewer |
| [`breaking-change-taxonomy.md`](./breaking-change-taxonomy.md) | rubric | API Contract Reviewer |
| [`route-signature-checklist.md`](./route-signature-checklist.md) | convention | API Contract Reviewer |
| [`flakiness-patterns/`](./flakiness-patterns) | convention | Test Quality Reviewer — **imported by hand** |

The bodies are mirrored into `server/src/db/seed-skills.ts` by
`scripts/sync-seed-skills.mjs`, which escapes them into template literals. Run it
after editing any of the four files above; it is what keeps the two copies from
drifting.

`flakiness-patterns/` is deliberately **not** seeded. It is packaged as a third
party would ship a skill — a `SKILL.md`, supporting markdown, and executables that
have no business being read — so the import path gets exercised by a human rather
than asserted by a fixture. `scripts/make-skill-zip.sh` zips it.

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
