# `@devdigest/agent-runner` — the CI runner

The single self-contained ESM file DevDigest commits into a target repository as
`.devdigest/runner.mjs`. GitHub Actions runs it with `node .devdigest/runner.mjs` — no
`node_modules`, no `npm install`, no network install of any kind (AC-48, AC-56).

It reads the exported bundle from the checkout, runs the same `@devdigest/reviewer-core`
engine the studio runs, publishes the review the way the workflow asked, and **always**
writes `devdigest-result.json` — on the success path, the failure path and both skip paths.
That file is the whole of what DevDigest ever learns about the run: the server ingests it
back as the `devdigest-result` artifact.

The branch order in `src/index.ts` is the contract, and it is ordered so the cheapest refusal
comes first: **fork** (nothing else is even read), then the **environment**, then the
**manifest**, then the PR and its diff, then the **diff ceiling**, then the review.

## Build

```sh
cd reviewer-core && npm ci     # openai and zod resolve out of HERE, not from this package
cd agent-runner  && npm ci
cd agent-runner  && npm run build
```

`npm run build` (`scripts/build.mjs`) writes two files and fails the build if the bundle
is over **1.5 MiB**:

| File | Contents |
|---|---|
| `dist/runner.mjs` | one self-contained ESM bundle, banner first |
| `dist/runner.meta.json` | `{ "version", "sourceSha", "bytes" }` |

`dist/` is git-ignored, so a clone that has never run the build has no bundle for the export
to carry. That is why `scripts/dev.sh` builds it during bootstrap, right after it installs
`reviewer-core`.

The banner is the first two lines of `runner.mjs` and is what AC-22 is about:

```js
// DevDigest agent-runner v0.1.0 — built from 0123456789abcdef0123456789abcdef01234567
// generated — do not edit
```

## The environment is the whole input

The runner takes **no arguments** (AC-50, AC-53). Everything reaches it as environment
variables, because a `run:` line that interpolates `${{ … }}` carrying PR-author data is
the injection the generated workflow is written to avoid.

| Variable | Meaning |
|---|---|
| `DEVDIGEST_AGENT` | manifest slug → `.devdigest/agents/<slug>.yaml` |
| `DEVDIGEST_REPOSITORY` | `owner/name`, from the run's own context |
| `DEVDIGEST_PR_NUMBER` | the pull request being reviewed |
| `DEVDIGEST_IS_FORK` | `"true"` takes the fork path: exit 0, no model call, a `skipped` artifact |
| `DEVDIGEST_POST_AS` | `github_review` \| `pr_comment` \| `none` (default `github_review`) |
| `DEVDIGEST_MAX_DIFF_LINES` | the input ceiling in force; default `15000` |
| `OPENROUTER_API_KEY` | the model key, from `${{ secrets.OPENROUTER_API_KEY }}` |
| `GITHUB_TOKEN` | the job token, used for every GitHub call |
| `GITHUB_STEP_SUMMARY` | the job summary file; absent is fine, lines still go to stdout |

Both secrets belong to the **target** repository. DevDigest never reads, stores or displays
either of them (AC-92), no generated file contains either value (AC-25), and the artifact is
scanned for both by literal before it is written (AC-63).

## Exit codes

| Code | Meaning |
|---|---|
| `0` | the review ran and the gate did not trip — or the run was skipped (fork, oversized diff) |
| `1` | the gate tripped: findings at or above the manifest's `ci_fail_on` |
| `2` | the run could not be completed: environment, manifest, GitHub or model |

`0` and `1` are both *the runner worked*. Only `2` means it did not.

## Everything foreign is fenced

The manifest, the skills, `memory.jsonl`, the PR title, branch, body and comments all live
in a branch the pull request's author can write. Each is truncated and **then** wrapped with
`wrapUntrusted` — never the other way round, because capping a wrapped string is what
eventually cuts the closing delimiter off and hands everything after it to attacker-controlled
text (`server/INSIGHTS.md`).

Memory items are wrapped **here** rather than in `reviewer-core`: `## Relevant memory` is the
one section `assemblePrompt` renders unfenced, because the studio's memory is curated rows
from its own database. SPEC-05 fixes `reviewer-core` as unchanged by this feature, so AC-98 is
satisfied in `src/review.ts`. That is a decision, not an oversight — see the plan's
`## Recommendations` R-2 for the alternative that was not taken.

## Tests

```sh
cd agent-runner && npm test        # vitest, hermetic — stubbed fetch, stub LLMProvider, no DB
cd agent-runner && npm run typecheck
```

No test here touches Postgres, so there is no `*.it.test.ts` in this package.

`agent-runner/*` maps to no package in `scripts/pr-self-review/scope.sh`, so **no Track A gate
runs these commands.** Run them by hand before opening a PR that touches this folder.
