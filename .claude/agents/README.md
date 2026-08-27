# Agents

Subagents this repo dispatches through the `Agent` tool. Each is one Markdown file with
frontmatter (`name`, `description`, `tools`, optional `skills`, `model`, `effort`, `color`, and
`maxTurns`) and a body of rules. **This file is the map, not the rules** — the bodies are the source of truth, and every
row below was read off the file it names.

Nothing registers an agent. `scripts/pr-self-review/registry.sh` reads `.claude/skills/` and
`skills-lock.json` only, so a file in this folder appears in no catalogue, and no gate — not
`repo · registry`, not any other — ever opens it. A broken agent is discovered by dispatching
it.

## The set

| Agent | Owns | Model · effort | Writes to disk | Dispatch |
|---|---|---|---|---|
| [`spec-creator`](spec-creator.md) | Deciding what is being built and for whom, in criteria anyone can check | opus · high | one spec under `specs/` or `<module>/specs/`, one status row | before any plan exists |
| [`implementation-planner`](implementation-planner.md) | Checking the requirements, then turning them into a plan another agent can execute cold | opus · high | one plan under `plans/`, one status row | proactively, before any code |
| [`implementer`](implementer.md) | Making the repo match an approved plan, and proving it with gates | opus · high | code in the modules the plan names | explicitly, with a plan path |
| [`researcher`](researcher.md) | Answering a question about this repo or the outside world, with evidence | sonnet · medium | nothing | when a question blocks either of the above |
| [`test-writer`](test-writer.md) | Writing tests for code that already shipped, and proving each one can fail | opus · high | test files in `client/src/**`, `server/test/`, `reviewer-core/test/` **and `e2e/specs/*.flow.json`** | explicitly, with what to cover |
| [`architecture-reviewer`](architecture-reviewer.md) | Boundaries the dependency-cruiser rules cannot express | sonnet · medium | nothing | explicitly, with a target |
| [`plan-verifier`](plan-verifier.md) | Whether the finished code satisfies every item of the plan | opus · high | nothing | explicitly, with a plan path |
| [`doc-writer`](doc-writer.md) | Documenting what shipped, in the right `docs/` folder | sonnet · medium | one document under `docs/` or `<module>/docs/`, one README row | explicitly, after the work lands |

The intended order is `researcher` → `spec-creator` → *human approves the spec* →
`implementation-planner` → *human approves the plan* → `implementer` → *human runs the feature
through its real entry point* → `plan-verifier` → *fix what came back not met* → `/code-review`
and `architecture-reviewer` → `test-writer`, alone → `doc-writer` → *human runs
`/pr-self-review`*. Each stage starts with a clean context window and knows only what the
previous stage left on disk; that is why the spec and the plan are files and not paragraphs.

That order is the **maximum, not the minimum**. Every stage is a dispatch with a real cost, and a
change that does not need a stage is made worse by it: a `plan-verifier` run over a one-file change
the gates already prove returns rows nobody acts on, and four `researcher` dispatches aimed at one
subsystem return the same answer four times.

**[`/implement`](../skills/implement/SKILL.md) runs the second half of that order** — from an approved
plan through build, run, verify, review and a bounded fix loop. It deliberately carries neither
`spec-creator` nor `implementation-planner`, which are dispatched by hand so a human sees the
requirements and the plan before any code exists, and it does not dispatch `test-writer` at all
(§ *What is deliberately not here* in that file says what that costs). This README stays the map:
the command orchestrates, the agent bodies remain the rules.

**`plan-verifier` runs first among the reviewers, not last.** It answers the cheapest question —
*did the thing the plan asked for actually happen* — and every later stage is wasted on a feature
that is not finished: `architecture-reviewer` grades the boundaries of code that is missing, and
`test-writer` covers a hole. Ordering it last was the older arrangement and it inverted the cost.
Its one prerequisite is that Track A is green, which the implementer already leaves behind.

**`test-writer` is serialised against everything, and that is the dispatcher's job.** Its *prove
the test can fail* rule leaves a deliberate defect in the tree between mutating a file and
reverting it, so any sibling that reads those files or shells out to a gate inside that window
measures the mutation. It cost a confidently wrong `plan-verifier` report on 2026-08-05 —
`INSIGHTS.md` § *Running a gate-measuring agent beside a mutating one makes it report the
mutation*. `architecture-reviewer` and `plan-verifier` may run in parallel **with each other**;
neither may run alongside `test-writer`.

| The change | What it gets |
|---|---|
| A fix, a rename, one file | No agents. Make it; run that module's gates. |
| One module, or one component | One `implementer`, with the plan in the prompt — no `plans/` file. Then run it, then `/code-review`. |
| A feature spanning two packages | `implementation-planner` → one or two `implementer` → **run it** → `plan-verifier` → `/code-review` + `architecture-reviewer` |
| A feature whose shape is not settled, or one with a design behind it | `spec-creator` first — the rest follows once the spec is approved |
| A boundary moved, a ring added, both vendored copies touched | The full order above |

`plan-verifier` earns its dispatch whenever no single context saw the whole change — which is
every `multi-agent` plan by construction, and any plan large enough to have been executed over
several runs. Below that, the gates and the implementer's own step-by-step report cover the same
ground for free.

**In `multi-agent` mode, dispatch it once per work package as that package lands, not once at the
end.** A package's `## Contract` block is what every *other* package was told it may assume. If P1
diverged from its contract and nobody checked, P2 and P3 are built on a statement that was never
true, and the end-of-run verification finds three packages to redo where a per-package one would
have found one. The cost is real — each run re-enumerates the shared sections — so it is worth it
exactly when a later package consumes an earlier one's contract, and not when the packages are
independent.

### Which review answers which question

Five things get called "review" here and they do not substitute for one another. Dispatching the
wrong one is how a question goes unanswered while a report says everything is fine.

| Run | Answers | Blocks? |
|---|---|---|
| `plan-verifier` | Did every item of the plan happen? | no — it reports, you decide |
| `/code-review` | Is the logic right? Are there bugs? | no |
| `architecture-reviewer` | Which boundary did this cross, and does it still hold? | no |
| `test-writer` | What shipped without a test that can fail? | no |
| `/pr-self-review` | Does the branch obey this repo's conventions and gates? | **yes** — `git push` and `gh pr create` |

**`/code-review` is in that list because nothing else in the pipeline hunts bugs.**
`architecture-reviewer` routes correctness to someone else by its own § *Subject*, `test-writer`
covers what shipped rather than searching for defects, and `pr-self-review/SKILL.md:370` says of
itself *"It does not hunt for bugs"*. Leave `/code-review` out and a logic error passes every
stage of this pipeline with a clean report at each one. It is a skill the human runs, not a
dispatch, and it takes an effort level — `/code-review high` on a feature, the default on a
smaller change.

### Five habits that outrank every agent here

The first two are commands you run yourself before dispatching; the third and fourth are what you
put into the dispatch; the fifth is *which agent* you put it into.

**Grep the nouns of the request, before any `researcher`.** This repo carries scaffolding for
course lessons that have not landed — tables that migrate but stay empty, contracts nobody
constructs, registry entries with zero callers (`AGENTS.md` § *The DB schema is intentionally
over-provisioned*). One `rg` decides whether the question is «how would this work» or the far
cheaper «what is already wired and what is not», and it stops parallel researchers rediscovering
the same scaffold. Hand what it found to every researcher you then dispatch, and give each of them
a disjoint question.

**Exercise the change through its real entry point, before any reviewer.** A `curl` at `:3001`,
the page in a browser, the CLI command. Gates prove the code compiles and the fakes returned their
fixtures; they prove nothing about whether the feature works against a real provider or a real
database. A defect caught here costs one command. The same defect caught after review costs a
re-plan, another `implementer`, and makes the review itself moot — it graded a feature that never
ran.

**Put the facts in the brief, and do not make each agent buy them again.** A subagent starts cold,
so anything it is not told, it pays to rediscover — and it pays in the most expensive currency
there is. Measured on the Project Context run (`scripts/run-retrospective/stats.sh`, 27 agents):
**549 M tokens re-read against 1.72 M produced, a ratio of 319:1.** One file was opened by fifteen
different agents; `plans/09-project-context-authoring.md` was opened by **ten** — a plan whose
per-package `## Contract` blocks existed precisely so that no implementer would have to read it.
Partitioning *writes* is not partitioning *reads*: a contract written inside the document it was
meant to replace still costs a read of that document. Quote the contract into the dispatch instead
of pointing at it, name the `path:line` you already established rather than the file to go looking
in, and tell each agent what its siblings were told so it does not re-derive their half.

Run `run-retrospective` after a multi-agent run to see which facts got bought more than once. The
answer is what the next brief should carry.

**Open the file while you write the sentence — «cite» alone was not enough.** That rule was filed
after the SPEC-05 run's first retrospective and then broken **five times in the same session, by
the agent that filed it** — SPEC-05, 2026-08-27, 23 agents / 3171 turns / 477 M cache-read; the
full entry is in the root `INSIGHTS.md` § *Cite `path:line` in a subagent brief*. All five briefs
carried an address or read as though they did; what none carried was a read *at the moment of
writing*. Three came from stale sources — an
`INSIGHTS.md` entry whose citation had already died, a paraphrase of the spec's own summary of a
file, and a grep narrow enough to miss the answer (`styles.ts` only, while the constraint sat
inline in `page.tsx:221`). So quoting a repository document about code is not a citation: **open
the code that document points at.** Whatever you cannot address, label a hypothesis in those words
— the implementer's account of the alternative is *бриф подавав ці твердження як факт, а не як
гіпотезу, і я щоразу витрачав турни на археологію чужої впевненості*.

**A preflight list carries shapes, not names.** «`formatCost` exists» saves a search; «`Agent` has
`description` and no icon field» saves a decision round-trip after the component is already
written. On that run the first half was given and the second was not, and five contracts were read
from disk anyway — the ones that then drove every decision in the package.

**Hand over the source material itself — a mockup, a screenshot, a ticket, a sample payload —
never your description of it.** A subagent sees only what the dispatch contains. It cannot open an
image that was pasted into the conversation, follow a ticket link nobody quoted, or infer a layout
from prose about the layout. Whatever you were given, pass it: the file path of the screenshot, the
ticket text, the rows of the payload, the design as an attached image or as an exhaustive
description of every element in it — label, position, state, and the data each one shows.

The failure is silent and it is expensive, because nothing downstream can detect it. Measured on
the PR Why + Risk Brief run, 2026-08-16: a mockup arrived with the request and was never passed on.
`spec-creator` wrote *"Дизайну картки не передавали"* — an accurate report of what it had — and the
spec then described the card by content and behaviour alone. `implementation-planner` planned that
spec, an `implementer` built that plan, `plan-verifier` graded 111 items against it, and two review
agents plus five `/pr-self-review` runs read the result. **All of them passed.** Every one was
correct about the artefact it was handed; not one could see that the artefact described a different
thing from the one the human asked for. The divergence surfaced only when the human looked at the
screen — after the PR was open.

Two rules follow, and the second is the one that makes the first survive a bad day:

- **Dispatching:** if the request carried a design, a screenshot, a ticket or sample data, the
  brief carries it too. Enumerate what the design shows, don't summarise that a design exists.
- **Receiving:** an agent told that a design exists, and not given it, **says so and stops** rather
  than inventing a layout — the same *emit the block and stop* shape as every other "ask when
  unclear" rule here (§ *Editing an agent here*). Its default assumption goes in that block, so the
  reply can be one word.

Anything visual ends where it started: **compare the built screen against the source material
before calling it done** — and open it *before* the first line of code, not after. Both design
questions of the SPEC-05 run were visible before that first line and were asked after it, costing a
rewrite of a card, its styles and its test. `client/AGENTS.md` § *A design is an acceptance
criterion* carries the procedure; `plan-verifier` grades the comparison as its own row.

When one design is source material for more than one agent, walk it **once, before the packages**,
into `specs/assets/<SPEC>-DESIGN-WALK.md`. Four PNGs cost nineteen agent reads on that run, and the
walk that existed did **not** stop them — because the rule above, *hand over the image, never your
description of it*, tells every agent to distrust exactly what a walk looks like. Three things
resolve that, and all three are needed:

- **A walk is a transcription, not a description** — the five axes of `client/AGENTS.md` § *A design
  is an acceptance criterion*, answered with the image open, saved beside it, naming any axis it
  could not fill. That is what an agent is allowed to build from; prose about a layout still is not.
- **Route it by ownership.** Only packages that own client files get a design. A server package gets
  none, and that is where most of the nineteen went.
- **Let it heal.** An agent that has to open the image appends the row the walk was missing. The
  read that could not be avoided pays for every one that follows.

An image the human pasted into the conversation reaches **no** subagent. Save it to
`specs/assets/` first, then walk it, then dispatch.

**Resume the agent that already has the surface loaded; do not dispatch a fresh one.** The cheapest
orchestration lever the SPEC-05 run found. Its UI-iteration implementer did **393** turns of work
across 6 resumes with **34** scouting calls; a comparable implementer dispatched once, fresh, did
273 turns with **67**. Twice the work at half the scouting — every fresh dispatch buys the whole
«where does everything live» pass again and a resume buys none of it, so prefer one long-lived
agent per surface over a new agent per request, and `SendMessage` over a second `implementer`.

**Two or three agents at a time, in one message.** Parallelism buys wall-clock, not tokens — each
concurrent agent pays for its own cold context — so the cap is what keeps a fan-out from costing
both. The one-message part is the token half: an orchestrator turn costs the same whether it
dispatches one agent or three.

Then **sweep the whole screen before you send one.** Of those six resumes, three carried something
that could not have been known earlier — a human looking at a screen that did not exist yet. The
other three (GitHub links, `Tabs` width, an inert button's tooltip) were one request, and all three
were visible at the moment of the first.

The last four sit in no script — they are dispatched by a human, or by the main agent when the
work calls for it. `architecture-reviewer` in particular is **not** a Track B agent:
`scripts/pr-self-review/scope.sh:127` sets `TRACK_B="security conventions"`, and `report.sh`
compares a run's `agents[]` against that roster as set equality, so a third name would make
every run print `PARTIAL COVERAGE` or `UNEXPECTED AGENT`.

Every agent writes its committed artifacts in English and returns its chat report in Ukrainian.

## How skills reach an agent

`skills:` in frontmatter **does** preload the full skill body, but only along the subagent
path — which is the only path a file in this folder ever runs on. Measured 2026-08-05 on Claude
Code 2.1.222, probing for the last checklist item of `onion-architecture/SKILL.md` and the exact
title of its §6, two facts with no path from the skill's name or description:

| How the agent ran | Result |
|---|---|
| `--agent probe`, as the session's **main** agent | `NOT PRELOADED` |
| dispatched as a **subagent**, `tools: ["WebSearch"]` only | both facts quoted verbatim |

The second probe held no filesystem tool, so it could not have read the file. That is why both
the 2026-08-04 result and this one are true: they measured different paths. Full record and
probe design: `INSIGHTS.md` § *`skills:` in agent frontmatter declares a role; it loads nothing*
and the **Correction, 2026-08-05** beneath it.

So the loading strategy is **hybrid** — preload only what an agent needs on *every* dispatch,
reach the rest through a *touching X → invoke Y* table in the body:

| Agent | `skills:` (preloaded) | Reached with `Skill` |
|---|---|---|
| `spec-creator` | none — the field is absent | `security` · `mermaid-diagram` · `onion-architecture` · `frontend-architecture` |
| `implementation-planner` | `onion-architecture` · `frontend-architecture` | the other eight, by a *touching X → invoke Y* table |
| `implementer` | none — the field is absent | twelve, by two *touching X → invoke Y* tables |
| `test-writer` | none — the field is absent | `react-testing-library` · `fastify-best-practices` · `drizzle-orm-patterns` · `onion-architecture` |
| `architecture-reviewer` | none | `onion-architecture` for `server/` · `frontend-architecture` for `client/` |
| `plan-verifier` | none, **and no `Skill` tool** | _none — it cannot invoke one_ |
| `doc-writer` | `mermaid-diagram` | `onion-architecture` · `frontend-architecture` |

`implementation-planner` was cut to two preloaded skills on 2026-08-12, when `planner.md` was
rewritten under that name: its previous eight were paid for on every dispatch, and its body then
told the agent to call `Skill` on each of them anyway.

`implementer` was cut to **none** on 2026-08-13, for the same reason and one more. It declared
nine — 65 KB of skill bodies, measured — while its body still carried the superseded 2026-08-04
finding that the field loads nothing, so it also told the agent to `Skill`-load each one: every
skill it actually opened was paid for twice. And unlike the planner, no skill in its set applies
on *every* dispatch — a server-only plan never wants `frontend-architecture`, a client-only plan
never wants `drizzle-orm-patterns` — so there was nothing left to preload once the redundancy was
removed. For scale: the entire Track A gate sweep over both packages, every test in the repo
included, prints 9.6 KB (measured 2026-08-13). The preload cost seven times a full test run, on
every turn rather than once.

---

## spec-creator

**Responsibility.** Decides *what* is being built and *for whom*, and writes it down as criteria
anyone can check. Reads the sources it was handed — a description, a screenshot or exported
frame, existing code, an older document — and treats them as the start of the job rather than the
end of it: the deliverable is the corner cases the design never drew, the contract that crosses a
package boundary, the input nobody said was untrusted, and the number missing from "should be
fast". Acceptance criteria are written in EARS, numbered `AC-N`, one behaviour each, and every
one of them is tied in a `## Traceability` table to the goal it serves and to what will be
observable — a goal with no criterion is an unfinished requirement, a criterion with no goal is
scope the agent invented. A ten-item self-check runs before it returns.

**It never plans.** Steps, file lists, gates and test commands belong to
`implementation-planner`. If it finds itself naming files to change, it has started writing
someone else's document. The observable it names stops at what will be visible; the suite and
the command that prove it are the plan's.

**Where the spec lands.** `specs/SPEC-NN-topic.md` for work spanning packages,
`<module>/specs/` for `server`, `client` and `reviewer-core` only. Work confined to `mcp/` or
`e2e/` goes to the repo-wide folder anyway — neither has a requirements folder, and the gate
refuses both. `NN` is the next free number *in that folder*, so the id is folder-local and a
citation carries the path.

**Questions it cannot answer itself.** It has no browser and no subagents, so a fact it cannot
reach becomes a numbered `Q-N` rather than an assumption — one question, marked for `researcher`
(a fact settles it) or for the human (a product decision settles it), saying what its answer
would change, and worded so as not to overlap the others, since the dispatcher runs one
`researcher` per question in parallel.

**Its one limit is a real wall.** `scripts/spec-creator/write-gate.sh` runs as a `PreToolUse`
hook declared in this agent's own frontmatter, so it is live only while this agent is — no other
agent, and not the main session, ever reaches it. It refuses every `Write`/`Edit` outside
`specs/*.md` and `<module>/specs/*.md`, refuses `e2e/specs/**` by name, and refuses a `Bash`
command that mutates. This is the only path-scoped enforcement in the repository; every other
agent's boundaries are rules it keeps.

**Permissions.** `tools: Read, Grep, Glob, Bash, Skill, Write, Edit`. `Agent`, `WebSearch` and
`WebFetch` are absent, so it cannot open a Figma link or check what a library does today —
sources reach it through the prompt or the disk, and anything else becomes an open question.

**Skills declared: none, deliberately.** On the dispatch path a declared skill is injected whole
at every dispatch, and most specs need none of these four. It reaches them with `Skill` through
an *invoke before writing section X* table: `security` before `## Untrusted inputs` (naming this
repo's own vector — a diff fed into a model prompt is prompt injection), `mermaid-diagram` before
the interaction diagram whenever the feature has a screen, a cross-module sequence or successive
states — **not** only when it spans packages, because `client/specs/README.md` asks for a sketch
on UI specs and those are single-package by definition — `onion-architecture` before describing a
contract into `server/`, `frontend-architecture` before a UI feature's boundary and empty states.

Ten of the fourteen skills are explicitly not its own. Eight answer *how to build it*
(`fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`,
`next-best-practices`, `react-best-practices`, `react-testing-library`, `zod`,
`typescript-expert`) — a requirement quoting one has decided an implementation the planner had
not chosen — and `pr-self-review` judges finished code. `engineering-insights` is refused for a
different reason and so gets its own paragraph in the body: the root `AGENTS.md` tells every
agent to run it before reporting complete, but it appends to `INSIGHTS.md` and the write-gate
blocks that, so what the session learned goes into the report and the dispatcher owns the entry.

The spec never names a skill; that table belongs to the plan.

| | |
|---|---|
| **In** | an idea or request, plus whatever sources exist — prose, image paths (it can open a screenshot; it cannot follow a link), code paths, an older document |
| **Out** | `specs/SPEC-NN-topic.md`, or `<module>/specs/SPEC-NN-topic.md` under `server`, `client`, `reviewer-core` — carrying `## Decisions and alternatives` (the product decision, not the implementation one) and `## Traceability` |
| | one appended row in that folder's `README.md`, status `Draft <date>` — three columns at the root, two inside a module |
| | a Ukrainian report — what was specified, the path, which sources it read and which it could not, the design gaps it found, UX proposals with their cost, `Q-N` open questions each addressed to `researcher` or to the human |
| **Never** | a plan or anything under `plans/`, code, `AGENTS.md`, `INSIGHTS.md`, `docs/`, `e2e/specs/**`, another agent's document, a test command or suite name, the statuses `Approved` or `Implemented` |
| **Blocked** | returns the clarification block as its whole output and stops, with no spec written |

### Where its rules come from

| Rule | Source |
|---|---|
| A spec is what and why, never how; `SPEC-NN` naming; `Draft` → `Approved` → `Implemented`; do not rewrite it once it ships | [`specs/README.md`](../../specs/README.md) |
| `## Decisions and alternatives` belongs to the spec, not the plan | the three module `specs/README.md` files — "what we are about to build … **alternatives considered**"; [`implementation-planner.md`](implementation-planner.md) § *Alternatives rejected* — "not the product decision, which belongs to the spec" |
| Every `AC` cites the goal it serves, and a criterion serving none is invented scope | the same rule one layer down in [`implementation-planner.md`](implementation-planner.md) § *Checking the requirements is part of the job* |
| EARS — the five patterns, `shall`, one behaviour per criterion, vague adjectives are a defect | Mavin, Wilkinson, Harwood, Novak, *Easy Approach to Requirements Syntax*, IEEE RE'09. Its compound form is deliberately narrowed away here: a criterion carrying two conditions can be half-met, and `AC-N` is cited one at a time |
| `INSIGHTS.md` read by `rg` and only for the modules in scope | the six files total ~4000 lines against `AGENTS.md`'s 150; [`AGENTS.md`](../../AGENTS.md) § *What a session costs* — context is the bill |
| A question it cannot settle becomes a `Q-N` for `researcher`, never an assumption | [`researcher.md:29`](researcher.md) — "no subagents", so parallelism comes from the dispatcher running one per question; [`README.md`](README.md) § *Two commands that outrank every agent here* |
| Headings English, prose Ukrainian, report Ukrainian | this role's own contract, decided 2026-08-12 — the file is committed, the reader who approves it is not the repo |
| Ask by ending the turn — the clarification block is the whole output | `INSIGHTS.md` § *A subagent asking a clarifying question has to end its turn to ask it* |
| Vendored `shared` is one contract in two copies; secrets never reach `AppConfig`; the deliberately empty tables | [`AGENTS.md`](../../AGENTS.md) §§ *Non-default conventions*, *Do not touch* |
| Frontmatter `hooks:` fire only while that subagent is active, and `PreToolUse` exit 2 blocks the call | Claude Code docs, *Subagents* § *Define hooks for subagents*, *Hooks* § *PreToolUse* |

## implementation-planner

**Responsibility.** Turns requirements that already exist into a plan another agent can execute.
It checks those requirements first — each one numbered, sourced, and marked `clear` /
`ambiguous` / `conflicting` / `assumed` — then reads the repo's own documentation before
proposing a step, and writes one plan: modules touched, constraints with the file that mandates
each, steps or work packages, tests, gates, risks already recorded in `INSIGHTS.md`, rejected
implementation approaches, verification. It does not write code and does not validate the plan
by executing it.

**It never authors a specification.** *What* is being built and *why* belongs to `specs/`, to
`spec-creator` and to the human who approves what that agent wrote; when the requirements it was
handed are wrong or incomplete, that is a finding it reports rather than an edit it makes. Its
one exception is bookkeeping: it flips the spec's `**Status:**` line and README row from `draft`
to `approved` when a human dispatches it to plan against that spec. Better ways to build the thing go in `## Recommendations`
as proposals — the steps themselves are written to the requirements as they actually stand,
because a recommendation folded silently into a step is a requirement the planner authored.

**The execution-mode question.** Before writing, it asks whether the work will be executed by one
implementer or several, unless the dispatch prompt already said. The answer changes the document,
not a flag in it: `## Steps` — one linear list — for single-agent; `## Work packages` — file
ownership, a contract per package, dispatch order and sync points — for multi-agent.

**Permissions.** `tools: Read, Grep, Glob, Bash, Skill, Write, Edit`. `Agent`, `WebSearch` and
`WebFetch` are absent, so a subagent and a URL are both out of reach. `Bash` is granted for
reading only (`git log`, `git show`, `git blame`, `rg`, `ls`) — the ban on writes, package
installs and any `pnpm`/`npm` script is a rule in the body, not a wall.

**Skills declared.** `onion-architecture` and `frontend-architecture` — two, preloaded, because
they answer the question every plan answers: where the code goes. Eight more are reached with
`Skill` through a *touching X → invoke Y* table: `fastify-best-practices`, `drizzle-orm-patterns`,
`postgresql-table-design`, `next-best-practices`, `zod`, `security`, `react-best-practices`,
`mermaid-diagram`.

| | |
|---|---|
| **In** | a path to a spec under `specs/`, or a request in natural language; optionally a `researcher` report, and the execution mode if it is already decided |
| **Out** | `plans/NN-topic.md` — one folder for every package, the scope recorded in the header |
| | one appended row in `plans/README.md`, status `Planned <date>` |
| | a Ukrainian report — what was planned, the path, the mode and why, requirement counts with every `assumed` named, **AC coverage when a spec exists**, recommendations, scope, skills, risks, and open questions — which, when there are any, the report must open by saying block `/implement` |
| **Never** | a specification in any folder, any spec prose, code, `AGENTS.md`, `INSIGHTS.md`, `docs/`, `vendor/**`, `e2e/specs/*.flow.json`, another agent's plan, the status `Implemented` |
| **Except** | the one spec `**Status:**` line it is planning against, `draft` → `approved`, and that spec's row in `specs/README.md` |
| **Blocked** | returns the clarification block as its whole output and stops, with no plan written |

### Where its rules come from

| Rule | Source |
|---|---|
| A plan is **not** a spec: `plans/` holds how, `specs/` holds what and why; `NN-` naming, one folder for every package, "finished when someone with a clean context could execute it without asking", do not rewrite it later | [`plans/README.md`](../../plans/README.md); [`specs/README.md`](../../specs/README.md) |
| The requirement table with its four statuses, `## Recommendations` kept out of the steps, and the execution-mode question asked before writing | this role's own contract, decided 2026-08-12 — no upstream source publishes it |
| `Source` cites `<spec> § AC-N`, and every `AC` becomes an `R#` or is named by number in `## Out of scope` | this role's own contract, decided 2026-08-13. `spec-creator` numbers `AC-1…` and this agent renumbers to `R1…`; the spec is never read again downstream, so an unaccounted `AC` produces an all-`MET` verification of a feature missing something a human approved. [`plan-verifier.md`](plan-verifier.md) Rule 6 checks the same boundary from the other side |
| Pointers to skills, never their bodies, in the plan | [`plans/L01-context-layering.md:29`](../../plans/L01-context-layering.md) — "No `@import`. Imports are eager … Pointers only." |
| The reading order `AGENTS.md` → `<module>/AGENTS.md` → `INSIGHTS.md` → `specs/` → `docs/` → code | [`AGENTS.md`](../../AGENTS.md) § *Read when* |
| Vendored `shared` is one contract in two copies, server copy first; `reviewer-core` is raw TS source; generated skill files; pinned `skills-lock.json`; deliberately empty tables; `e2e/specs/` is live tests | [`AGENTS.md`](../../AGENTS.md) §§ *Non-default conventions*, *Do not touch* |
| The `## Gates` section, copied verbatim | [`.claude/skills/pr-self-review/gates.md`](../skills/pr-self-review/gates.md) |
| Ask by ending the turn — the clarification block is the whole output | `INSIGHTS.md` § *A subagent asking a clarifying question has to end its turn to ask it* |
| `plans/` as its own folder, and why the 2026-08-04 choice of `specs/` no longer holds; English file, Ukrainian report | `INSIGHTS.md` § *A Development Plan in this repo is a spec, and `specs/` already defines it* and its 2026-08-12 supersession |
| Name the skills, do not carry them | `INSIGHTS.md` § *The planner points at skills; it does not carry them* |
| Its body's "the two declared skills are already in your context" | `INSIGHTS.md` § *`skills:` … it loads nothing* **Correction, 2026-08-05**. See § *How skills reach an agent* above: nothing preloads on the main-agent path, everything does on the dispatch path — and this agent only ever runs on the second |
| Which limits are enforced and which are kept | `INSIGHTS.md` § *An agent's `tools:` list denies by omission, and `Bash` hands back what it denied* |

---

## implementer

**Responsibility.** Executes one already-approved plan: writes the code, invokes the skills the
plan's table names, runs the touched modules' gates and pastes their real output, records what
the session learned, and stops at the plan's boundary. It does not design, does not review, does
not commit.

**Permissions.** `tools: Read, Grep, Glob, Edit, Write, Bash, Skill`. `Agent`, `WebSearch` and
`WebFetch` are absent — a question the plan cannot answer is reported, not researched. `Bash` is
full: the bans on `git commit`/`push`, `gh pr create`, `pnpm arch:baseline` and
`PR_SELF_REVIEW_SKIP=1` are rules it keeps. The one real wall is the push hook.

**Skills declared: none, since 2026-08-13.** Twelve are reached with `Skill`, by two tables in
its body: the nine it once preloaded — `engineering-insights`, `onion-architecture`,
`frontend-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`,
`react-best-practices`, `next-best-practices`, `zod`, `security` — and `react-testing-library`,
`postgresql-table-design`, `typescript-expert`, which are large and open only when a step is
genuinely about them. `pr-self-review` is never its own to invoke: it spawns the subagents that
judge this stage's output. See § *How skills reach an agent* for why the field is empty.

| | |
|---|---|
| **In** | a path to a plan under `plans/`, plus the work package (`P1`) when the plan's `**Execution:**` is `multi-agent`; or a fix brief under `.reviews/` naming findings against code that already landed — nothing else, no conversation |
| **Out** | code and tests in the modules the plan names |
| | an appended entry in the relevant module's `INSIGHTS.md`, via `engineering-insights` |
| | `Planned <date>` → `Implemented <date>` in the plan folder's `README.md`, once gates pass |
| | a Ukrainian report: steps ✅/⚠️/⛔, changed files, skills actually loaded, a gates table with real output, deviations, what it left to the human |
| **Never** | a commit, a push, a PR, `/pr-self-review`, work the plan's `## Out of scope` excludes, the plan text itself |
| **Blocked** | returns «Не можу виконати план» with the contradiction named, having written no code |

### Where its rules come from

| Rule | Source |
|---|---|
| The push wall, the `PR_SELF_REVIEW_SKIP=1` escape hatch and its recorded bypass | [`.claude/settings.json`](../settings.json) → `scripts/pr-self-review/gate.sh`; [`AGENTS.md`](../../AGENTS.md) § *A push is gated* |
| The per-module gate table and the `--exclude` form of the unit run | [`.claude/skills/pr-self-review/gates.md`](../skills/pr-self-review/gates.md); [`AGENTS.md`](../../AGENTS.md) § *Commands* |
| Never re-baseline; move the code, then narrow the rule | [`.claude/skills/onion-architecture/SKILL.md`](../skills/onion-architecture/SKILL.md) §2 |
| `diff -r` the two `vendor/shared` copies, server first | [`AGENTS.md`](../../AGENTS.md) § *Non-default conventions*; `gates.md` § `repo · vendor` |
| Generated files, pinned skills, `CLAUDE.md` symlinks, `e2e/specs/*.flow.json` | [`AGENTS.md`](../../AGENTS.md) § *Do not touch* |
| Manual module registration, `SecretsProvider` over `process.env`, migrations not on boot | [`server/AGENTS.md`](../../server/AGENTS.md); [`server/README.md`](../../server/README.md) |
| TanStack Query hooks over `fetch` in a component; responsive rules in `app/globals.css` | [`client/AGENTS.md`](../../client/AGENTS.md) |
| `reviewer-core` has two runtime deps and emits no JS | [`reviewer-core/AGENTS.md`](../../reviewer-core/AGENTS.md) |
| The `*.it.test.ts` suffix and the unit/integration split | [`TESTING.md`](../../TESTING.md) |
| `engineering-insights` before reporting complete | [`AGENTS.md`](../../AGENTS.md) § *Read when* |
| Reporting that `.claude/agents/**` trips no gate rather than implying one ran | `INSIGHTS.md` § *A subagent asking a clarifying question has to end its turn to ask it* (closing paragraph) |
| Declaring no `skills:`, and reaching all twelve with `Skill` | `INSIGHTS.md` § *`skills:` … it loads nothing* **Correction, 2026-08-05** — the field preloads on the dispatch path, so a declared skill is paid for on every run whether it is opened or not, and no skill in this set applies to every plan. Its body carried the superseded 2026-08-04 reading until 2026-08-13, which made every skill it opened a double load |

---

## researcher

**Responsibility.** Two kinds of question — how something works here, and what the outside world
says about a technology — answered so a reader can check every claim without trusting the agent.
Findings and evidence stay in separate sections, each finding is labelled
висока/середня/низька, and «Чого знайти не вдалося» is never omitted.

**Permissions.** `tools: Read, Grep, Glob, Bash, WebSearch, WebFetch`. No `Write`, no `Edit`, no
`Agent` — those are enforced by omission. `Bash` is granted for reading and the write commands
are banned in the body.

**Skills declared.** _None._ It has no `Skill` tool, and it is the precedent the three new
read-only agents follow.

| | |
|---|---|
| **In** | a question, with the repository/outside-world split either stated or inferable |
| **Out** | a Ukrainian report only. Nothing on disk, nothing proposed as a code change |
| **Blocked** | returns the clarification block as its whole output, having researched nothing |

Its report headings are Ukrainian on purpose — they are strings the agent emits, not prose about
the agent. See `INSIGHTS.md` § *`.claude/agents/researcher.md` is an English file with Ukrainian
headings on purpose*.

---

## test-writer

**Responsibility.** Writes tests for code that already shipped without them, across five lanes:
colocated client tests, the server's hermetic unit lane, its `*.it.test.ts` integration lane,
`reviewer-core`, and `e2e/specs/*.flow.json`. Every new test is proved able to fail before it is
left green. Expected values come from the Zod contract, the API map or the plan — never from
reading the implementation — so a mismatch between code and contract is a finding it reports
rather than a test it writes.

**Permissions.** `tools: Read, Grep, Glob, Edit, Write, Bash, Skill`. `Agent`, `WebSearch` and
`WebFetch` are absent, so subagents and the web are enforced out of reach. `Edit` and `Write`
are unrestricted, which makes the boundary around `src/` a **rule**; the body says so in those
words. Rule 1 is its one declared hole, and it closes with `git diff --exit-code`.

**Skills declared.** _None — the field is absent entirely._ Four skills are reached with
`Skill`, one per kind of test: `react-testing-library`, `fastify-best-practices`,
`drizzle-orm-patterns`, and `onion-architecture` for the ring→lane decision. An agent whose
lanes each want a different skill preloads none of them.

| | |
|---|---|
| **In** | what to cover — a file, a module, a component, a class of regression |
| **Out** | test files, in the lane the ring dictates |
| | a Ukrainian report: what was covered, where it went, the mutation proof, findings in production code, a gates table with real output, and what was deliberately left uncovered |
| **Never** | an edit to `src/` that survives its turn, a deleted or `skip`ped test, a weakened assertion, a coverage target, a new test dependency, a vitest/tsconfig alias change, a commit |
| **Blocked** | returns the clarification block as its whole output, having written no test |

### Where its rules come from

| Rule | Source |
|---|---|
| The five lanes, their file locations and their exact commands | [`TESTING.md`](../../TESTING.md); [`AGENTS.md`](../../AGENTS.md) § *Commands*; [`gates.md`](../skills/pr-self-review/gates.md) |
| `*.it.test.ts` is what keeps a DB-backed test out of the unit lane | [`server/AGENTS.md`](../../server/AGENTS.md) § *Tests*; [`testing-the-rings.md`](../skills/onion-architecture/testing-the-rings.md) §1 |
| Which ring gets which test, and what not to test at all | `testing-the-rings.md` §1–3, §6 |
| Unique fixtures over transaction rollback; the `hasDocker` self-skip guard | `testing-the-rings.md` §5; the existing `server/test/*.it.test.ts` files |
| Assert on the return, not the mock; `buildApp({ overrides })` instead of `vi.mock` | `testing-the-rings.md` §4; [`onion-architecture/SKILL.md`](../skills/onion-architecture/SKILL.md) §3.4 — a port is not finished until `adapters/mocks.ts` implements it |
| `fireEvent` and per-test `fetch` mocking, against the skill's `userEvent`/`msw` advice | [`react-testing-library/SKILL.md`](../skills/react-testing-library/SKILL.md) `:41` and `:269`, overruled by [`client/AGENTS.md:35`](../../client/AGENTS.md) and `client/package.json` |
| Mutate → run red → revert → `git diff --exit-code` | [`plans/04-agents-for-tests-review-and-docs.md`](../../plans/04-agents-for-tests-review-and-docs.md) § *Decisions* — "A test never seen red proves only that it runs" |
| The `e2e/specs/*.flow.json` exception, and that the gate still flags it `major` | [`AGENTS.md`](../../AGENTS.md) § *Do not touch*; [`scope.sh:117-118`](../../scripts/pr-self-review/scope.sh) |
| Never `pnpm arch:baseline` | `onion-architecture/SKILL.md` §2 |
| Generated files, pinned skills, `CLAUDE.md` symlinks, vendored copies | [`AGENTS.md`](../../AGENTS.md) § *Do not touch* |
| Ask by ending the turn | `INSIGHTS.md` § *A subagent asking a clarifying question has to end its turn to ask it* |
| Why the `src/` boundary is worded as a rule and not a wall | `INSIGHTS.md` § *An agent's `tools:` list denies by omission, and `Bash` hands back what it denied* |

---

## architecture-reviewer

**Responsibility.** Reviews boundaries and nothing else: which ring code sits in, which way its
dependencies point, whether the shape of data crossing a boundary respects it, and where a
client file crosses the Server/Client line. It runs `pnpm arch` once to learn what the gate
already decided, then works only where the twelve rules cannot reach. Every finding carries a
second axis — `pre-existing` or `introduced` — so a reader can tell this branch's fault from
debt it walked past. It issues no verdict and blocks nothing.

**Permissions.** `tools: Read, Grep, Glob, Bash, Skill`. No `Write`, no `Edit` — enforced by
omission. `Agent`, `WebSearch` and `WebFetch` are absent too. But `Bash` is present, and
`sed -i`, `>` and `tee` write as well as `Edit` does, so the forbidden-command list in the body
is a **backstop** and the body uses that word.

**Skills declared.** _None._ Two are reached with `Skill`: `onion-architecture` when the target
includes `server/` or `reviewer-core/`, `frontend-architecture` when it includes `client/`.
`security` is deliberately not among them — an OWASP finding belongs to the Track B `security`
agent, and reporting one here means it reaches nobody who acts on it.

**This agent does not find bugs, and it is routinely dispatched as though it does.** Its own
§ *Subject* sends correctness and performance elsewhere; `/code-review` is where they go, which is
why that command joined the order above on 2026-08-13. Dispatching this agent "to find bugs"
returns a clean boundary report and leaves the bugs in place.

**Moved to `sonnet` on 2026-08-13**, on the ground that its output is advisory: it issues no
verdict, blocks nothing, and a human reads every row before acting. The severity axis was already
the least reproducible thing it produces — `agents/service.ts:55` scored `major` on one run and
`minor` on the next under `opus`, which is why the anchor table and the decision-versus-edit
tie-break exist at all — so the tier buys back cost against a field nothing was allowed to depend
on. What to watch on the next few dispatches: whether findings still land on the rule they cite
rather than on a preference, and whether «Непевні спостереження» starts absorbing things that
belong in the table.

| | |
|---|---|
| **In** | a diff, a module, a package or a path — any target, not just what `scope.sh` routed |
| **Out** | a Ukrainian report only. Nothing on disk |
| | a findings table with severity, the `introduced`/`pre-existing` axis and a `path:line` per row; a checked-and-clean section; uncertain observations kept separate and uncounted |
| **Never** | a fix, a patch, a verdict or score, a re-report of the twelve `pnpm arch` rules or of anything already in the frozen baseline, `pnpm arch:baseline`, a padded findings table, an OWASP/style/performance/correctness finding, a proposal to join Track B |
| **Blocked** | returns the clarification block as its whole output, having reviewed nothing |

### Where its rules come from

| Rule | Source |
|---|---|
| The twelve rule names it must never re-report, each printing its own `comment` at the point of failure | [`server/.dependency-cruiser.cjs`](../../server/.dependency-cruiser.cjs) `:39, 52, 64, 73, 83, 92, 102, 116, 130, 146, 167, 177`; `gates.md` § `server · arch` |
| The frozen baseline only shrinks; escalate move → narrow with a reason → baseline deliberately | `onion-architecture/SKILL.md` §2; [`server/.dependency-cruiser-known-violations.json`](../../server/.dependency-cruiser-known-violations.json) |
| Ring placement, ports, the composition root, `*Row` never leaving its module, `reviewer-core`'s two runtime deps | `onion-architecture/SKILL.md` §1, §3, §5, §7 |
| Client placement, colocation and promotion, where state lives, the `'use client'` leaf rule | [`frontend-architecture/SKILL.md`](../skills/frontend-architecture/SKILL.md) § *The six principles*, § *Review checklist* |
| The three client checks it adds — `import 'server-only'`, serializable props, re-verified auth inside a Server Action | defined as the complement of that checklist in [`plans/04-agents-for-tests-review-and-docs.md`](../../plans/04-agents-for-tests-review-and-docs.md) Step 3 |
| The four-value severity enum | [`severity.md`](../skills/pr-self-review/severity.md) |
| It is not in `TRACK_B`, and why a third name breaks every run | [`scope.sh:127`](../../scripts/pr-self-review/scope.sh); `report.sh` coverage check |
| Read-only is a backstop, because `Bash` hands back what omission denied | `INSIGHTS.md` § *An agent's `tools:` list denies by omission, and `Bash` hands back what it denied* |
| Ask by ending the turn | `INSIGHTS.md` § *A subagent asking a clarifying question has to end its turn to ask it* |

---

## plan-verifier

**Responsibility.** Answers one question item by item: did the thing the plan asked for actually
happen? It enumerates every step, criterion, test, gate and out-of-scope boundary **verbatim
before opening any code**, and that list is then fixed. Compound criteria are decomposed into one
row each during enumeration. Every row carries a `path:line` or output from a command it ran
itself; every `MET` survives an adversarial re-check; and the row count is compared against the
enumerated count before the report is returned.

**Permissions.** `tools: Read, Grep, Glob, Bash`. `Write`, `Edit`, `Skill`, `Agent`, `WebSearch`
and `WebFetch` are all absent — enforced. `Bash` is granted for reading plus the plan's own gate
and test commands, character for character; the forbidden-command list is a backstop, for the
same reason as above.

**Skills declared.** _None — it has no `Skill` tool_, and an agent with no `Skill` tool must not
declare `skills:`. That is also the right call for the role: every skill here teaches how code
*should* be written, and a verifier that loads one starts grading the code against the skill
instead of against the plan.

| | |
|---|---|
| **In** | a path to a plan under `plans/` — or under `specs/`, for one written before that split — plus a work package (`P2`) when only that package has landed, and optionally what to check it against |
| **Out** | a Ukrainian report only. Nothing on disk |
| | a stamp (HEAD sha, branch, clean/dirty tree), a count line, then one row per item: the item as written, a verdict, the evidence |
| | when the plan cites a spec: any `AC-N` that became no `R#` and is in no `## Out of scope`, under «Зауваження до самого плану» |
| **Never** | an edit, the status row in `plans/README.md` or `specs/README.md`, an edit to the plan, style/naming/refactor/performance/test-organisation opinions, advice the plan did not ask for, a manufactured `PARTIAL` |
| **Blocked** | returns the clarification block as its whole output, having verified nothing |

### Where its rules come from

| Rule | Source |
|---|---|
| What a plan is, the three shapes it comes in, and that neither a shipped plan nor a shipped spec is rewritten to match the implementation | [`plans/README.md`](../../plans/README.md); [`specs/README.md`](../../specs/README.md) |
| Both heading shapes it must handle | [`plans/03-pr-self-review-skill.md`](../../plans/03-pr-self-review-skill.md) `:90, 119, 366, 411, 440` (older) against `plans/04-…md` § *Steps* / *Gates* / *Acceptance criteria* (newer) |
| The compound criterion it cites, carrying five conditions in one bullet | `plans/03-pr-self-review-skill.md:444-448` |
| Stamping a report with what it verified against | [`.pr-self-review/latest.json`](../../scripts/pr-self-review/report.sh) keys `headSha` / `worktreeHash` / `generatedAt`; [`gate.sh:102-107`](../../scripts/pr-self-review/gate.sh) refusing a stale verdict |
| The status row belongs to whoever shipped the change, not to the grader | [`implementer.md`](implementer.md) § *Before you report complete*; [`implementation-planner.md`](implementation-planner.md) — "You never write `Implemented`" |
| `MET` / `PARTIAL` / `NOT_MET` / `NOT_VERIFIED` is a local convention, not a standard | stated as such in the body — no primary source publishes that enum |
| Read-only is a backstop, because `Bash` hands back what omission denied | `INSIGHTS.md` § *An agent's `tools:` list denies by omission, and `Bash` hands back what it denied* |
| An agent with no `Skill` tool must not declare `skills:` | [`researcher.md`](researcher.md) frontmatter, the precedent |
| Ask by ending the turn | `INSIGHTS.md` § *A subagent asking a clarifying question has to end its turn to ask it* |
| Running first among the reviewers, and once per work package in `multi-agent` mode | § *The set* above, 2026-08-13. A package's **Contract** is what every later package was told it may assume, so verifying it late turns one package's divergence into three packages of rework |
| Checking that every spec `AC-N` became an `R#`, and reporting a lost one as a remark about the plan rather than a `NOT_MET` | [`implementation-planner.md`](implementation-planner.md) § *When you plan against a spec, the `AC` numbers must survive the crossing* — the two agents enforce the same boundary from opposite sides, and nothing else reads both documents |

---

## doc-writer

**Responsibility.** Documents what has already shipped. It picks the mode with the Diátaxis
compass — action or cognition, acquisition or application — before writing a line, routes the
subject by how many packages it spans, grounds every technical claim in a file it opened or a
command it ran, draws a Mermaid diagram where the mechanism needs one, and registers the result
with one row in that folder's `README.md`. Where the code and the plan disagree, the code wins
and the disagreement goes in the report.

**Permissions.** `tools: Read, Grep, Glob, Edit, Write, Bash, Skill`. `Agent`, `WebSearch` and
`WebFetch` are absent — enforced — so it cannot check what a library does today, and anything it
cannot ground in this repository is a gap it reports. `Edit` and `Write` are unrestricted, so the
two-files limit and the never-list in its body are rules.

**Skills declared.** `mermaid-diagram` — one, preloaded, because a document may always need a
diagram and its `examples.md` now carries templates drawn from this repo's own schema, ports and
routes. `onion-architecture` and `frontend-architecture` are reached with `Skill` when the
document explains server rings or client placement. `engineering-insights` is deliberately not
its own: that skill writes `INSIGHTS.md`, which doc-writer may not touch.

| | |
|---|---|
| **In** | a subject that has shipped — a plan, a diff, a module — and ideally the reader it is for |
| **Out** | one document under `docs/` or `<module>/docs/` |
| | one appended row in that folder's `README.md`, replacing the `Empty for now — …` line with a table header when the folder had none |
| | a Ukrainian report: what, where, why there, both compass answers, a grounding table, diagrams, divergence from the plan, what it did not document |
| **Never** | `AGENTS.md` or a `CLAUDE.md` symlink, `INSIGHTS.md`, `specs/**`, generated files (`plugins/*/skills/**`, `server/src/db/seed-skills.ts`, `docs/skills/*`, `docs/agent-prompts/*`), `vendor/**`, code or tests, a second document, two Diátaxis modes in one file |
| **Blocked** | returns the clarification block as its whole output, having written nothing |

### Where its rules come from

| Rule | Source |
|---|---|
| The two compass questions and the four modes they resolve to | diataxis.fr — the compass and its warning against mixing modes |
| Routing by how many packages the subject spans, and the per-folder contract | [`docs/README.md`](../../docs/README.md); [`server/docs/README.md`](../../server/docs/README.md), [`client/docs/README.md`](../../client/docs/README.md), [`reviewer-core/docs/README.md`](../../reviewer-core/docs/README.md), [`e2e/docs/README.md`](../../e2e/docs/README.md) |
| The `| File | What it covers |` table, and the `Empty for now — …` line the first document replaces | `docs/README.md` (the table) and the four module READMEs (the line) |
| Fenced ```mermaid blocks as the diagram convention, and the register to match | [`docs/architecture.md`](../../docs/architecture.md); [`server/README.md`](../../server/README.md) |
| Its preloaded skill, and that nothing else is preloaded | `INSIGHTS.md` § *`skills:` …* **Correction, 2026-08-05**; § *How skills reach an agent* above |
| Ring and placement vocabulary, so a document does not invent its own | `onion-architecture/SKILL.md`; `frontend-architecture/SKILL.md` |
| The never-write list: generated skill and prompt files, vendored copies, `CLAUDE.md` symlinks | [`AGENTS.md`](../../AGENTS.md) § *Do not touch*; [`docs/agent-prompts/README.md`](../../docs/agent-prompts/README.md) |
| `INSIGHTS.md` belongs to another skill and is append-only | [`engineering-insights/SKILL.md`](../skills/engineering-insights/SKILL.md) § *Append only* |
| No unreleased behaviour in the present tense; empty tables are deliberate | [`AGENTS.md`](../../AGENTS.md) § *Non-default conventions* |
| Ask by ending the turn | `INSIGHTS.md` § *A subagent asking a clarifying question has to end its turn to ask it* |

---

## Editing an agent here

- **`tools:` is a whitelist** — anything absent is unavailable. Granting `Bash` undoes that for
  files, because `sed -i`, `>` and `tee` write as well as `Edit` does. The only boundary this
  repo actually enforces is the `PreToolUse` hook on `git push` and `gh pr create`; write the
  rest as rules, never as walls. An agent that finds one "wall" decorative cannot tell which of
  the others are real.
- **An agent with no `Skill` tool must not declare `skills:`.** The field would claim a
  capability the tool list denies, and a reader checking one against the other would find them
  disagreeing. `plan-verifier` is the example; `researcher.md` set the precedent by leaving the
  field out.
- **`skills:` preloads on the subagent path** (2026-08-05, Claude Code 2.1.222) and not on the
  main-agent path (2026-08-04, 2.1.221). See § *How skills reach an agent*. Declare only what
  the agent needs on **every** dispatch — a preloaded skill is paid for on every run whether it
  is opened or not — and give the body a *touching X → invoke Y* table for the rest. An agent
  that does not know it has to call `Skill` will not call it.
- **A subagent cannot hold a conversation.** Its final text is a return value; there is no second
  turn. Every "ask when unclear" rule has to be spelled as *emit the block and stop*, closing
  with the assumption it would take by default, so the reply can be one word.
- **The five skills under `plugins/api-contract-reviewer/` are not installed** — the `devdigest`
  marketplace is absent from `~/.claude/plugins/known_marketplaces.json`, so no agent can invoke
  them under any name.
- **English file, Ukrainian only where the text is a string the agent emits.**
- **No gate reads this folder.** `registry.sh` checks `.claude/skills/` and `skills-lock.json`
  only. Verify a change by dispatching the agent, and say plainly in any report that no check
  ran.
