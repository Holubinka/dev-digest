# Track A — the ten deterministic gates

Step 2 of [SKILL.md](SKILL.md) runs `scripts/pr-self-review/gates.sh`. This file is how to read
what it returns.

**A Track A failure is critical by definition** — no model interprets it, and it blocks
`git push` on its own. That is why it runs first and why a failure ends the run before any
subagent is dispatched.

## How the runner behaves

`gates.sh` reads `.packages` from the scope object on stdin and runs a gate only when its package
is in the diff. It always exits 0; the result is in the JSON.

```json
{ "gates":    [ { "package": "client", "name": "lint", "status": "ok|fail|skip", "detail": "…" } ],
  "findings": [ { "severity": "critical", "source": "gate lint", "file": "client", "line": 0,
                  "message": "<last 20 lines of output>", "fix": "<the command>" } ] }
```

Three things about that shape trip people up:

- **`skip` is not `ok`.** `"not run — no server file in the diff"` means the gate has no opinion,
  not that it passed. The report prints it as `--`. Never summarise a run as "all gates green"
  when some were skipped.
- **`file` holds the package name, not a path**, and `line` is `0`. A whole-package command
  failure belongs to no line. The report prints `client:0`. That is correct; do not invent a
  path for it, and do not let a subagent "improve" it.
- **`fix` is the command itself.** The first thing anyone does with a red gate is run it again
  with the output in front of them, so that is what the finding hands them.

**Integration tests (`*.it.test.ts`) are deliberately absent.** They need testcontainers and cost
minutes. CI owns them; see `TESTING.md`.

`PR_SELF_REVIEW_RUNNER` replaces every command with one script taking `<package> <name>`. It
exists for the test suite. Do not set it in a real run.

---

## server · arch

```sh
cd server && pnpm arch          # depcruise src --config --ignore-known
```

**A failure looks like** one or more dependency-cruiser violations, each printed with the
`comment` from the rule it broke — the rule explains itself at the point of failure, which is why
neither this file nor `onion-architecture` restates the twelve rules.

**First thing to try:** move the code, not the rule. `onion-architecture` §2 carries the
escalation order in full — move, then narrow the rule with a reason, then baseline it
deliberately. `--ignore-known` means this gate is already filtered through
`.dependency-cruiser-known-violations.json`, so anything it reports is new on this branch.

**Never** run `pnpm arch:baseline` to clear it. The baseline only shrinks; `pnpm arch:strict`
shows the frozen backlog if you need to see what is in it.

## server · typecheck

```sh
cd server && pnpm typecheck     # tsc --noEmit -p tsconfig.json
```

**A failure looks like** `TS####` lines with file and position.

**First thing to try:** check whether the error is in `server/src/vendor/shared/`. Each package
compiles against its own copy of the vendored contracts, so a contract change made on one side
only shows up here as a type error with no obvious cause — and the `vendor` gate below is the one
that names it. Cross-package imports resolve to a sibling's **TypeScript source**, not to
`dist/`, so a `reviewer-core` change surfaces here too.

## server · test

```sh
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'
```

**A failure looks like** the Vitest summary; the finding carries its last twenty lines.

**First thing to try:** `relation ... does not exist` means migrations were never applied —
`cd server && pnpm db:migrate`. `ERR_MODULE_NOT_FOUND` naming `reviewer-core` means its
`node_modules` is missing; its raw source is imported at runtime, so install there too.

**A test deleted or `skip`ped to make this green is a critical of its own**, and it is a Track B
finding, not a gate one — the gate cannot see the difference. See [severity.md](severity.md).

## client · lint

```sh
cd client && pnpm lint          # eslint .
```

`client/` is the only package with ESLint. There is nothing to run in `server/` or
`reviewer-core/`.

**A failure looks like** `file:line:col  error  <message>  <rule>`.

**First thing to try:** read the rule name. `react-hooks/exhaustive-deps` is the common one here
and it is nearly always right. A rule that is genuinely wrong for a line gets a scoped
`eslint-disable-next-line` **with a reason**, never a config change buried in the same commit.

## client · typecheck

```sh
cd client && pnpm typecheck     # tsc --noEmit
```

**First thing to try:** same vendored-copy check as the server typecheck, from the other side.
`client/src/vendor/shared/` is the mirror; the server copy is the source of truth.

## client · test

```sh
cd client && pnpm test          # vitest run
```

**First thing to try:** if the failure is a missing alias rather than a real assertion, the
Vitest config and the tsconfig `paths` have drifted. They duplicate each other on purpose in this
repo — add a path to one and not the other and tests break while typecheck still passes.

## reviewer-core · typecheck and test

```sh
cd reviewer-core && npm run typecheck   # tsc --noEmit
cd reviewer-core && npm test            # vitest run --passWithNoTests
```

**`npm`, not `pnpm`.** `reviewer-core/` and `e2e/` use npm; `server/` and `client/` use pnpm.
Mixing them is its own kind of failure.

`reviewer-core` emits no JS — its `build` is `tsc --noEmit` — so typecheck *is* the build.

**First thing to try:** if the failure names a package that is neither `openai` nor `zod`,
the functional core has grown a third runtime dependency. That is an `onion-architecture` §3.8
violation, not a gate to fix.

## repo · vendor

```sh
diff -r server/src/vendor/shared client/src/vendor/shared
```

Runs on every branch regardless of `.packages`.

**A failure looks like** `Only in …` or `diff …` lines for a contract file.

**First thing to try:** decide which side is right — the server copy is the de-facto source of
truth, because `reviewer-core` aliases it — then mirror it deliberately and re-run the diff. Type
checking cannot see this drift, because each package compiles against its own copy, which is
exactly why this gate exists. The `shared-sync` CI job checks the same thing after the push.

**One-sided drift is a critical.** A `vendor/` path in the diff is also flagged by `scope.sh`
before any gate runs — see [severity.md](severity.md) for which of the two you are looking at.

## repo · registry

```sh
bash scripts/pr-self-review/registry.sh
```

Runs on every branch, always, and is the only gate that is a script rather than a package
command. Its findings are appended to `gates.findings` whether or not the gate itself is recorded
as failed, so **do not call it a second time** in step 5.

It checks five things:

| Severity | Check |
|---|---|
| critical | a `skills-lock.json` entry whose directory does not exist |
| critical | a `SKILL.md` frontmatter `name` that disagrees with its directory |
| major | a `SKILL.md` over the 500-line authoring cap |
| major | `.cursor/skills` is not the symlink `.claude/skills/README.md` documents |
| note | a directory absent from `skills-lock.json` — by `CLAUDE.md`, ours to edit |

**First thing to try:** the `fix` field on each finding is specific and correct. The two standing
criticals in this repo today are real drift, not a bug in the gate: `skills-lock.json` pins
`architecture-patterns` and `github-workflow-automation`, and neither directory exists.

**The `note` rows are not a to-do list.** Seven directories have no lock entry because we wrote
them. Adding lock entries to silence the notes would make them un-editable and turn every future
edit into a critical.
