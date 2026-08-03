# flakiness-patterns

A skill packaged the way a third party would ship one: a `SKILL.md` carrying the
body, some supporting markdown, and a couple of executable files that have no
business being read.

It exists so the import path can be demonstrated end to end. Zip it with
`scripts/make-skill-zip.sh`, then import the archive from the Skills screen. The
preview should take its body from `SKILL.md`, list this file and `reference.md`
as evidence, and report `scripts/check.sh`, `lint.py` and `diagram.svg` as
skipped — the first two as executable, the last as not Markdown.

`SKILL.md` wins over this file because the core-selection rule prefers it. That
is deliberate: it is the same rule a real packaged skill would rely on.
