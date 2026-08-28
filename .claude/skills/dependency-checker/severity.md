# Severity — the four tiers, and what decides between them

Every finding carries exactly one of `P0`, `P1`, `P2`, `Info`. The tier is not a feeling
about how bad something sounds — it answers one question: **what does leaving this alone
cost, and by when?**

| Tier | Answers | Who confirms the fix |
|---|---|---|
| `P0` | This is already broken, or one release from being broken | whoever owns the package, now |
| `P1` | Real, measurable cost — size, drift, dead weight — worth a scheduled fix | whoever owns the package, soon |
| `P2` | Worth doing, not worth interrupting anything for | opportunistic |
| `Info` | A fact worth recording. Not a problem. | nobody — it's not asking for a fix |

## P0 — broken or about to be

A source-level import that reaches past another package's declared public entry point.
`server`'s `tsconfig.json` maps both `@devdigest/reviewer-core` (bare, to
`reviewer-core/src/index.ts`) *and* `@devdigest/reviewer-core/*` (wildcard, to
`reviewer-core/src/*`) — the wildcard is reachable for a deep import that skips the index
entirely. Measured on this repo today: nothing does — every `server/src` file that imports
`reviewer-core` uses the bare alias (nine files, checked by grep). That is the check passing,
not the check being unnecessary; report it as an `Info` finding when it passes clean, a `P0`
the moment it doesn't. The shape to watch for, from this skill's own eval fixture:
`server/src/services/review-service.ts` importing `"reviewer-core/src/pipeline.js"` by
relative path instead of through the package's entry point — a real boundary break, because
`reviewer-core`'s only two runtime dependencies (`openai`, `zod` — see
`onion-architecture` §3.8) is a promise the rest of the repo relies on, and a stray deep
import is how that promise gets quietly broken from the outside.

A runtime dependency resolved to genuinely incompatible versions across two packages that
share a wire contract. Two different **major** versions of `zod` validating the same
`@devdigest/shared` contract on both sides of an HTTP boundary is the shape — a schema that
parses on one side and throws on the other, discovered at runtime, not at review time.

## P1 — real, measurable, worth scheduling

**A dependency declared but never imported**, confirmed (not just flagged) unused. Checked,
not merely `grep`-negative: `server/package.json`'s `@fastify/autoload` is the standing real
example — installed, zero imports anywhere under `server/src`, and root `CLAUDE.md` states
outright that "Fastify modules are registered by hand... never autoloaded from the
filesystem," so there is no code path that would ever reach for it. That combination — grep
silent *and* a documented reason the repo would never use it — is what promotes a lead to a
P1. A `grep`-negative alone is not enough; see [SKILL.md](SKILL.md) §2's false-positive list
before grading this tier.

**Version drift** on a runtime dependency across packages, same major version but different
minors/patches — annoying and worth aligning, not yet broken. (Measured on this repo today:
none — `zod` resolves to the same `3.25.76` everywhere it's declared. The illustrative case
is this skill's own eval fixture: `server` on `zod@3.23.8`, `client` on `zod@3.22.4`,
`reviewer-core` on `zod@3.23.8` — three declared, two of three practically aligned, one
genuinely behind.)

**A dependency whose installed size is disproportionate to what it is used for**, when a
narrower alternative exists for the same single use — e.g. a full date-manipulation library
pulled in for one format call.

## P2 — worth doing, not worth interrupting anything for

Two libraries doing overlapping jobs across packages (two date libraries, two HTTP clients)
where consolidating is a nice-to-have, not a fix. A devDependency that could be trimmed. A
size finding too small to change a build or an install meaningfully.

## Info — a fact worth recording, not a problem

**The twice-vendored `shared/` is Info, never a duplication finding.** `server/src/vendor/shared/`
and `client/src/vendor/shared/` exist because this repo is deliberately not a monorepo — see
[graph.md](graph.md) §3 — and the `shared-sync` gate (`pr-self-review`'s own Track A) already
watches the one thing that would make it a real problem: the two copies drifting apart. Report
*that* as a finding if `diff -r server/src/vendor/shared client/src/vendor/shared` is non-empty;
never report the duplication itself, the way `pr-self-review`'s severity.md tells its own
agents not to re-report a rule a repo skill already overrules.

A boundary check that passed clean (§P0's `reviewer-core` example above). A package correctly
scoped to `devDependencies` that a naive check might expect in `dependencies`, with the reason
why. Anything the report needs to state so the reader doesn't have to re-derive it, that isn't
itself asking for a fix.

## The rule that applies to all four

**An empty tier is a real result — print the heading anyway.** [SKILL.md](SKILL.md) §3's
template has all four headings whether or not each has findings under it; a P0 section that's
just absent from a report reads as "wasn't checked," not "came back clean," and those are
different claims. Never invent a finding to avoid an empty section, and never fold two tiers
together to make the report look shorter — a `P1` softened to `P2` because the list already
has three `P1`s is grading by document length, not by cost.
