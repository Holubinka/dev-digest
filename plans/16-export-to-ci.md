# 16 — Export to CI

**Status:** Planned 2026-08-26
**Scope:** server · client · agent-runner (new package)
**Modules touched:** `server/src/vendor/shared`, `server/src/db/schema/ci.ts` + one migration, `server/src/adapters/{github,mocks,runner-bundle}`, `server/src/modules/ci` (new), `server/src/modules/context`, `server/src/platform/container.ts`, `agent-runner/**` (new), `client/src/app/agents/[id]/.../AgentEditor`, `client/src/app/ci-runs` (new), `client/src/lib/hooks/ci.ts` (new), `client/src/vendor/{shared,ui/nav.ts}`, `client/messages/en/ci.json`
**Requirements source:** `specs/SPEC-05-export-to-ci.md` (approved 2026-08-26, amended twice the same day — 133 active criteria AC-1…AC-133, decisions D1…D21)
**Execution:** multi-agent

The spec is 1364 lines and is not restated here. Every step cites the `R#` it serves and every
`R#` cites the `AC` it came from; read the spec's own `## Decisions and alternatives` when a step's
*why* is not obvious. **Line citations in the spec's Export-to-CI zone are shifted by ~40 lines**
(the spec says so in `## Sources`) — resolve by symbol name, never by line number. The line numbers
in *this* plan were re-checked on 2026-08-26 and are correct.

Work happens in worktree B (`emdash/export-to-ci-ju1ik`). Worktree A owns multi-agent review and
the PR feed: **nothing here touches `multi_agent_runs`, `server/src/modules/reviews/**` or any PR
feed screen** (spec N4).

## Requirements as understood

All 133 criteria are below. Nothing is dropped: `## Out of scope` names no `AC` number, because
none was left out. AC-123…AC-133 arrived with the spec's second amendment of 2026-08-26 (D21) and
are carried by R71–R76; they replaced this plan's two `assumed` rows with stated requirements and
added three rules the assumption did not name — see R73, R74, R76.

| # | Requirement | Source | Status |
|---|---|---|---|
| R1 | The agent editor gains a fourth tab `CI`, `?tab=ci` opens it, an agent with no installation shows the "Not in CI yet" empty state with one action `Add to CI`, and `Add to CI` / `Add repository` open the modal Export Wizard on step Target | `SPEC-05 § AC-1, AC-2, AC-3` | clear |
| R2 | Wizard chrome: four steps Target → Preview → Configure → Install, passed ones ticked and the current one numbered; `Back` restores the previous step with every choice of this session intact; title "Export to CI", subtitle "Run <agent> automatically on pull requests"; closing before `Install` writes no row, no branch and no PR | `SPEC-05 § AC-4, AC-5, AC-6, AC-7` | clear |
| R3 | Target carries a repository selector over the workspace's imported repos, defaulted to the sidebar repo, showing `owner/name` and the base branch; an empty workspace explains it and blocks `Continue`; the selection becomes `CiExportInput.repo`; a repo that already has this agent installed is called out **before** `Install` | `SPEC-05 § AC-8, AC-9, AC-103, AC-104` | clear |
| R4 | Four target cards in the order GitHub Actions, CircleCI, Jenkins, Generic CLI with the spec's descriptions; GHA carries `recommended` and is selected by default; the other three carry a visible "not implemented" mark and `aria-disabled="true"`; activating one by mouse, `Enter` or Space changes neither the selection nor the step | `SPEC-05 § AC-10, AC-11, AC-12, AC-13` | clear |
| R5 | The export request carries `target: 'gha'`; a request with any other target is refused with a validation error naming the field, and creates neither files nor an installation row | `SPEC-05 § AC-14, AC-15` | clear |
| R6 | "FILES TO CREATE" holds exactly: `.devdigest/agents/<slug>.yaml`, one `.devdigest/skills/<slug>.md` per bound skill, `.devdigest/memory.jsonl`, `.devdigest/runner.mjs`, `.devdigest/.gitattributes`, `.github/workflows/devdigest-review.yml` | `SPEC-05 § AC-16` | clear |
| R7 | `<slug>` is derived deterministically — lowercase, every run of non-alphanumerics → one hyphen, hyphens trimmed at both ends; an empty result falls back to the agent's or skill's id; a collision inside one bundle takes `-2`, `-3`… and the final path is what the list shows | `SPEC-05 § AC-17, AC-18, AC-105` | clear |
| R8 | Selecting a file shows its path in the editor header and its contents in the body; the workflow is selected by default, badged `editable` and editable; `runner.mjs` and `.gitattributes` are badged `generated` and reject input; a file over the preview threshold shows its header, its size in bytes and an explanation instead of full text | `SPEC-05 § AC-19, AC-20, AC-21, AC-24` | clear |
| R9 | The first lines of `.devdigest/runner.mjs` are a comment carrying the runner version, the source commit SHA it was built from and the text "generated — do not edit"; `.devdigest/.gitattributes` contains the line `runner.mjs linguist-generated=true` | `SPEC-05 § AC-22, AC-23` | clear |
| R10 | No generated file contains the value of any secret; `.devdigest/agents/<slug>.yaml` validates against `AgentManifest` and carries this agent's current `agents.ci_fail_on` | `SPEC-05 § AC-25, AC-26` | clear |
| R11 | Configure shows three trigger chips — `pull_request:opened`, `:synchronize`, `:reopened` — with the first two selected; clearing the last selected one disables `Continue` with a visible reason | `SPEC-05 § AC-27, AC-28` | clear |
| R12 | "Post results as" offers three mutually exclusive options — `GitHub review` (`recommended`), `PR comment`, `None (exit code only)` — with the first selected | `SPEC-05 § AC-29` | clear |
| R13 | Configure explains that blocking a merge needs **both** `Fail CI on` and a required status check in the target repo's branch rules, **and that no GitHub App is needed** | `SPEC-05 § AC-30` | conflicting — `client/messages/en/ci.json` → `exportWizard.blockMergeDesc` today says "Requires a GitHub App — not available with PAT in local mode". The plan follows AC-30 and rewrites the string |
| R14 | Changing triggers or "Post results as" regenerates `devdigest-review.yml`; if the YAML was hand-edited, the regeneration warns about losing the edits and can be cancelled | `SPEC-05 § AC-31, AC-32` | clear |
| R15 | `permissions:` is exactly `contents: read` + `pull-requests: write` for `github_review`/`pr_comment`, and exactly `contents: read` for `none`; `on:` holds only `pull_request` with the chosen `types` | `SPEC-05 § AC-33, AC-34, AC-35` | clear |
| R16 | Install offers "Open a PR with these files" (`recommended`) and "Copy files as a zip"; the PR text names the target repo and the PR title "Add DevDigest CI review"; the file count in that text is computed from the length of the generated file list, never a constant | `SPEC-05 § AC-36, AC-37, AC-38` | clear |
| R17 | Confirming Install with "Open a PR" writes every generated file as **one commit** on branch `devdigest/ci` created from the base branch; nothing on any path of this feature commits to the base branch; when an open PR whose head is `devdigest/ci` already exists, the commit is added to that branch and its existing PR link is returned rather than a second PR opened | `SPEC-05 § AC-39, AC-40, AC-41` | clear |
| R18 | A created-or-updated PR leaves exactly **one** `ci_installations` row per (`agent_id`, `repo`) with `target_type='gha'`, and the response is a `CiExport` with `pr_url` filled | `SPEC-05 § AC-42` | clear |
| R19 | A GitHub write refusal — no permission, repo not found, invalid token — creates no installation row, shows the named cause and leaves the wizard on Install | `SPEC-05 § AC-43` | clear |
| R20 | "Copy files as a zip" delivers an archive with the same files at the same paths, makes no GitHub call, writes no installation row, and the step says plainly that DevDigest will never see this repository's runs | `SPEC-05 § AC-44, AC-119` | clear |
| R21 | A successful install shows the PR link and names the one step the wizard cannot do: add `OPENROUTER_API_KEY` under Settings → Secrets and variables → Actions of the target repo | `SPEC-05 § AC-45` | clear |
| R22 | The generated workflow never uses `pull_request_target`; `OPENROUTER_API_KEY` reaches the job only as `${{ secrets.OPENROUTER_API_KEY }}` in the runner step's `env:`; it contains no `npm install`/`npm ci`/`npx`/`pnpm` or any other network install; every external action is pinned to a full 40-character commit SHA with a comment naming the version; no `run:` line interpolates `${{ … }}` carrying PR-author data — the PR number arrives through `env:` and is read as an environment variable | `SPEC-05 § AC-46, AC-47, AC-48, AC-49, AC-50` | clear |
| R23 | The job carries `timeout-minutes` and `concurrency` grouped by PR number with `cancel-in-progress: true` | `SPEC-05 § AC-51` | clear |
| R24 | A fork PR exits 0 with no model call, writes a job-summary line naming the skip and the unavailable secrets, and uploads an artifact with state `skipped` and a reason by the same path as the size skip | `SPEC-05 § AC-52, AC-109, AC-110` | clear |
| R25 | The runner step is `node .devdigest/runner.mjs`, and the workflow contains no `uses: devdigest/review-action@v1` | `SPEC-05 § AC-53` | clear |
| R26 | The workflow uploads an artifact named `devdigest-result` holding exactly one file, `devdigest-result.json` | `SPEC-05 § AC-54` | clear |
| R27 | A hand-edited YAML that is not valid YAML refuses the install with the failing line named and commits nothing | `SPEC-05 § AC-55` | clear |
| R28 | `.devdigest/runner.mjs` is one self-contained ESM file that runs on Node 20 and Node 22 with no `node_modules` directory | `SPEC-05 § AC-56` | clear |
| R29 | On start the runner reads `.devdigest/agents/<slug>.yaml` and validates it against `AgentManifest`; an invalid manifest exits non-zero, prints the failing field and makes no model call | `SPEC-05 § AC-57, AC-58` | clear |
| R30 | With a valid manifest the runner fetches the PR diff through the GitHub API using the job's `GITHUB_TOKEN` | `SPEC-05 § AC-59` | clear |
| R31 | The runner wraps the diff, the branch name, the PR title, the PR body and the comments as untrusted text before assembling the prompt | `SPEC-05 § AC-60` | clear |
| R32 | The review runs through `reviewPullRequest` with the grounding gate on; ungrounded findings reach neither the publication nor the artifact | `SPEC-05 § AC-61` | clear |
| R33 | The runner writes `devdigest-result.json` validating against `CiResultArtifact`, containing no secret value, no prompt text, no raw diff and no line recognised as a secret leak | `SPEC-05 § AC-62, AC-63` | clear |
| R34 | How the result is published follows `post_as` deterministically: `github_review` → a published review, `pr_comment` → a PR comment, `none` → no publication | `SPEC-05 § AC-64` | clear |
| R35 | The exit code follows the manifest's `ci_fail_on` and the maximum severity among grounded findings for **all four** `CiFailOn` values (`never`/`critical`/`warning`/`any`), by one rule | `SPEC-05 § AC-65` | clear |
| R36 | A model or GitHub-API call that fails after its retries exits non-zero and still uploads an artifact with run state `failed` and a named reason | `SPEC-05 § AC-66` | clear |
| R37 | A diff above the documented input ceiling makes no model call, uploads an artifact with state `skipped` and a reason, and exits 0 | `SPEC-05 § AC-67` | clear |
| R38 | `.devdigest/memory.jsonl` ships **empty** — valid JSONL with zero lines — and nothing from the workspace database (conventions, `memory` rows, anything else) is written into it | `SPEC-05 § AC-95, AC-96` | clear |
| R39 | The runner reads `.devdigest/memory.jsonl` within the documented size ceiling and passes the parsed items to `ReviewInput.memory`; it wraps **each** item as untrusted before assembling the prompt; a line that is not valid JSON is skipped with its number named in the job summary and the review runs on the rest; a missing file reviews with empty memory and does not fail | `SPEC-05 § AC-97, AC-98, AC-99, AC-100` | clear |
| R40 | Every run's `devdigest-result.json` carries the measured number of changed diff lines and the input ceiling that was in force for that run | `SPEC-05 § AC-111` | clear |
| R41 | Pressing refresh on the CI Runs page polls the Actions API of every repo holding a `ci_installations` row for runs of the `devdigest-review.yml` workflow | `SPEC-05 § AC-68` | clear |
| R42 | The token for that polling comes only through `SecretsProvider`, never through `process.env` or `AppConfig` | `SPEC-05 § AC-69` | clear |
| R43 | Only the artifact named `devdigest-result`, and only from runs of this workflow, is downloaded | `SPEC-05 § AC-70` | clear |
| R44 | An artifact archive or its unpacked content over the limit, holding other than exactly one file, or whose file is not valid JSON, is rejected with the reason logged and no row created | `SPEC-05 § AC-71` | clear |
| R45 | Content failing the `CiResultArtifact` schema is rejected with the field named and no row created | `SPEC-05 § AC-72` | clear |
| R46 | The repository, commit SHA and PR number a run is attached to come from the workflow-run metadata GitHub returned, not from the artifact body; a self-reported `pr_number` that disagrees with the run's PR, or a run repository that disagrees with `ci_installations.repo`, rejects the artifact and creates no row | `SPEC-05 § AC-73, AC-74` | clear |
| R47 | An accepted artifact creates or updates exactly one `ci_runs` row per workflow run, idempotently by run id, and creates an `agent_runs` row with `source='ci'` whose `findings_count`, `cost_usd`, `duration_ms` and `status` come from the accepted data | `SPEC-05 § AC-75, AC-76` | clear |
| R48 | No artifact field is interpreted as markup, HTML or a command anywhere — everything is stored and shown as text | `SPEC-05 § AC-77` | clear |
| R49 | The verdict in a `ci_runs` row equals the artifact's verdict and is never derived from the finding count; an artifact written by an older bundle, carrying neither run state nor verdict, creates a row with those fields empty rather than being rejected | `SPEC-05 § AC-117, AC-118` | clear |
| R50 | The CI Runs page is reachable from the global navigation | `SPEC-05 § AC-78` | clear |
| R51 | Each CI Runs row shows the repository, the PR number, the agent name, the review verdict with `Verdict` values, the findings count, the cost, the duration and a link to the job in GitHub Actions | `SPEC-05 § AC-79` | clear |
| R52 | A `cost_usd` of `null` renders as "—", never as "$0.00" | `SPEC-05 § AC-80` | clear |
| R53 | The job link opens in a new tab with `rel="noopener noreferrer"` | `SPEC-05 § AC-81` | clear |
| R54 | With no accepted run the page shows an empty state and not one invented row | `SPEC-05 § AC-82` | clear |
| R55 | A DevDigest token without permission to read the target repo's Actions shows the named cause and leaves the previously fetched rows on screen | `SPEC-05 § AC-83` | clear |
| R56 | The page shows the time of the last successful poll | `SPEC-05 § AC-84` | clear |
| R57 | Opening the CI Runs page polls the Actions API of every repo holding an installation row; a repo polled successfully less than 5 minutes ago is not polled again and its stored rows are shown with the timestamp; nothing polls on a timer, a schedule or a background task started without a user action | `SPEC-05 § AC-120, AC-121, AC-122` | clear |
| R58 | With at least one installation the CI tab shows the heading "CI deployment" and the badge "Active in N repos", `N` being the number of that agent's `ci_installations` rows | `SPEC-05 § AC-85` | clear |
| R59 | Each installation row shows the repository, the target type, the last run's status and how long ago it was | `SPEC-05 § AC-86` | clear |
| R60 | The `Fail CI on` block offers exactly three options — `Critical`, `Warning +`, `Never` — with the current `agents.ci_fail_on` highlighted when it is one of them; a change is saved to `agents.ci_fail_on` and confirmed; the value `any` is never sent; a stored `any` is shown as the named current value with none of the three selected; a failed save reverts the control and names the cause | `SPEC-05 § AC-87, AC-88, AC-94, AC-101, AC-102` | clear |
| R61 | The tab explains that changing `Fail CI on` reaches CI only after the bundle is republished, because the threshold lives in the committed manifest | `SPEC-05 § AC-89` | clear |
| R62 | An installation whose recorded agent version is below the current `agents.version` carries a visible staleness marker | `SPEC-05 § AC-90` | clear |
| R63 | `Update CI config` on an installation regenerates the bundle and publishes it by the same path as Install (AC-39, AC-41) | `SPEC-05 § AC-91` | clear |
| R64 | DevDigest nowhere reads, stores or displays the target repository's `OPENROUTER_API_KEY` | `SPEC-05 § AC-92` | clear |
| R65 | `server/src/vendor/shared/` and `client/src/vendor/shared/` stay byte-identical after every contract change in this feature | `SPEC-05 § AC-93` | clear |
| R66 | A `ci_runs` row carries the agent name, the run duration, the PR head commit SHA and the bundle version the run executed with | `SPEC-05 § AC-112` | clear |
| R67 | `CiRun` carries the review verdict with `Verdict` values, separate from `CiRunStatus` | `SPEC-05 § AC-113` | clear |
| R68 | `CiResultArtifact` carries the run state — `succeeded`, `failed` or `skipped` — with a named reason for the latter two, and the review verdict with `Verdict` values | `SPEC-05 § AC-114, AC-116` | clear |
| R69 | A `ci_installations` row carries the agent version the deployed bundle was generated from | `SPEC-05 § AC-115` | clear |
| R70 | The Project Context scan creates no document under `.devdigest/skills/` or `.devdigest/agents/`, no file under those paths reaches the `## Project context` section of a review prompt, and everything else under `.devdigest/` stays in the scan unchanged | `SPEC-05 § AC-106, AC-107, AC-108` | clear |
| R71 | The migration adds the two columns AC-75, AC-84 and AC-121 need and had no home for: `ci_runs.workflow_run_id`, carrying the id of the workflow run whose artifact created the row, and `ci_installations.last_polled_at`, carrying the time of that repository's last **successful** Actions poll and empty until there has been one | `SPEC-05 § AC-123, AC-127` | clear |
| R72 | `CiRunStatus` carries five values — `succeeded`, `failed`, `no_findings`, `running`, `skipped` — so a fork skip and a size skip are visible on the CI Runs page, and both vendored copies of `eval-ci.ts` carry the same five | `SPEC-05 § AC-130, AC-133` | clear |
| R73 | The uniqueness of `workflow_run_id` in `ci_runs` is enforced by a **constraint in the database schema**, not by a service reading the table before it writes; an artifact of a run already ingested updates the existing row, leaving exactly one row for that run id | `SPEC-05 § AC-124, AC-125` | clear |
| R74 | The migration leaves the `ci_runs` rows that predate it in place, and the uniqueness constraint does not treat two empty run ids as duplicates | `SPEC-05 § AC-126` | clear |
| R75 | A successful Actions poll of a repository writes its time to that repository's `ci_installations.last_polled_at`; a poll that failed leaves the stored value untouched, so the AC-84 timestamp never reports a poll that did not happen and a failed attempt does not shift the AC-121 window | `SPEC-05 § AC-128, AC-129` | clear |
| R76 | An accepted artifact whose run state is `skipped` writes `skipped` into the `ci_runs` row — never `failed`, never `no_findings`; an artifact carrying a run state that is not one of the `CiRunStatus` values creates a row with an **empty** state and a named reason in the log, without storing the unrecognised value and without rejecting the run (the same treatment AC-118 gives a missing state) | `SPEC-05 § AC-131, AC-132` | clear |

## Out of scope

No acceptance criterion is left out. What is excluded:

- **Spec non-goals N1…N10 verbatim**: generators for CircleCI, Jenkins and Generic CLI; a push
  endpoint; publishing `devdigest/review-action`; anything in worktree A's multi-agent-run service
  or PR feed; automating the manual acceptance flow; reading or showing the target repo's
  `OPENROUTER_API_KEY`; configuring branch protection for the user; retroactive ingest of expired
  artifacts; manual registration of an installation for zip-added files; scheduled background
  polling.
- **`e2e/`** — the spec's `## Module interactions` marks `e2e` and `mcp` untouched. No
  `*.flow.json` is added or edited.
- **`reviewer-core/`** — the spec fixes it as unchanged and its two runtime dependencies as two.
  The untrusted wrapping of memory items (R39/AC-98) is therefore done **in the runner**, which is
  what the spec's `## Edge cases` row for `memory.jsonl` states.
- **A new GitHub Actions workflow for `agent-runner/`, and teaching `scripts/pr-self-review/scope.sh`
  a fourth package.** `scope.sh:209-213` maps only `client/*`, `server/*` and `reviewer-core/*`, so
  `agent-runner/*` triggers no Track A gate — its commands are named explicitly in `## Gates`
  instead. Adding `.github/workflows/agent-runner.yml` would also make the branch unpushable from
  this machine. See `## Recommendations` R-3.
- **The `Evals` and `Stats` tabs** visible in `SPEC-05-export-to-ci-tab.png`. AC-1 names one new
  tab, `CI`, added to the existing three.
- **The date/agent/repo/status filter row** scaffolded in `client/messages/en/ci.json` →
  `runs.filters`. No criterion asks for it; the keys stay unused.
- **Storing the chosen triggers and `post_as` per installation.** See `## Alternatives rejected`.

## What already exists

Read this before writing anything — roughly a third of the feature is already on disk.

**Contracts, written and consumed by nobody** — `server/src/vendor/shared/contracts/eval-ci.ts`:
`CiTarget:133`, `CiFile:137`, `AgentManifest:152`, `CiExportInput:174`, `CiInstallation:188`,
`CiExport:198`, `CiRunStatus:205`, `CiRun:209`, `CiResultArtifact:228`. They are **extended** by
D18, never re-created. `CiFailOn` is `contracts/knowledge.ts:730`; `Verdict` is
`contracts/findings.ts:26`.

**Tables, present and empty** — `server/src/db/schema/ci.ts:4` (`ci_installations`) and `:14`
(`ci_runs`). `agent_runs.source` already carries the enum value `'ci'`
(`server/src/db/schema/runs.ts:31`), `agents.ci_fail_on` already carries all four values
(`server/src/db/schema/agents.ts:38`), and `agents.version` (`agents.ts:46`) is the number AC-90
compares against.

**The GitHub port does everything Install needs and nothing ingest needs.**
`server/src/vendor/shared/adapters.ts:154` declares `GitHubClient` with `openPullRequest:166`,
`commitFiles:172` and `findOpenPr:174`; the Octokit implementations are
`server/src/adapters/github/octokit.ts:313`, `:332`, `:400`; the mock is `MockGitHubClient`
(`server/src/adapters/mocks.ts:139`, with `openedPrs`/`committed` recorders at `:141-142`). **No
method touches the Actions API** — not runs, not artifacts, not download.

**The review engine already answers most of the runner's questions.**
`gateTriggered(findings, failOn)` (`reviewer-core/src/output/to-review.ts:37`) implements AC-65's
rule for all four `CiFailOn` values already; `toReviewPayload` is `:148`. `reviewPullRequest`,
`assemblePrompt`, `wrapUntrusted` and `groundFindings` are all exported from
`reviewer-core/src/index.ts`.

**The memory slot is wired end to end and fed nothing.** `PromptParts.memory`
(`reviewer-core/src/prompt.ts:100-101`) → `ReviewInput.memory` (`review/run.ts:58-59`) → assembled
at `run.ts:~158` → rendered at `prompt.ts:257` as `## Relevant memory`, and **without**
`wrapUntrusted`, unlike every other untrusted section (`prompt.ts:200-202`). The server writes
`memory: null` (`modules/reviews/run-executor.ts:786`).

**Zip handling has a hardened precedent.** `server/src/modules/skills/import.ts:33`
(`parseSkillArchive`) budgets `max(originalSize, size)` inside fflate's `filter`, before anything
is inflated, and the comment at `:13-23` says why. `fflate` is already a `server/` dependency —
`zipSync` for AC-44 and `unzipSync` for AC-71 need no new package.

**Filesystem access behind a port has a precedent to copy.** `PromptTemplates`
(`vendor/shared/adapters.ts:493`) + `FilePromptTemplates`
(`server/src/adapters/prompts/file-templates.ts`) + `platform/prompts.ts:20` (path resolved
relative to `import.meta.url`, with a `build` step that copies the assets into `dist/`). The
runner bundle is read the same way.

**The client already carries the scaffolding for three of the five screens.**
`client/src/vendor/ui/ExportWizardSteps.tsx:6` renders AC-4 exactly (tick for passed, number for
current). `client/src/components/app-shell/helpers.ts:43` already returns the active key
`"ci-runs"` for a `/ci-runs` path. `client/messages/en/shell.json` already holds `nav.ci-runs`.
`client/messages/en/ci.json` holds a whole scaffolded namespace (`runs`, `exportWizard`, `ciTab`,
`publishDialog`, `page`) — **some of it contradicts the spec** (see R13) and some names a
`publishDialog` this plan does not build.

**Nothing exists** for: the `ci` server module; a fourth editor tab
(`AgentEditor/constants.ts:11-15` holds exactly three); the CI Runs page (`client/src/app/` has no
`ci-runs/`); a `CI Runs` row in `client/src/vendor/ui/nav.ts:20` (`NAV` has two sections, no
`GLOBAL`); the `agent-runner` package; any declared bundler in any `package.json`.

## Constraints

| Constraint | Mandated by |
|---|---|
| Dependencies point inward; `pnpm arch` fails CI on a new violation, and the escalation is move → narrow the rule → baseline, never `arch:baseline` to go green | `.claude/skills/onion-architecture/SKILL.md` §1-2; `server/.dependency-cruiser.cjs` |
| No Drizzle outside `repository.ts`; no `container.db` in a route; a route validates via `schema.body`, delegates and maps `undefined` → `NotFoundError` | `.dependency-cruiser.cjs` `no-db-from-routes:39`, `no-sql-outside-repository:52`; `server/README.md` |
| A service takes its repository as a **parameter** and reaches ports through the container; the composition root is the one place naming concrete types | onion §3.3; `server/src/platform/container.ts` (`intentService`, `briefService` are the pattern) |
| Every new external call goes behind a port, and a port is unfinished until `server/src/adapters/mocks.ts` implements it | onion §3.4 |
| A `service.ts` / `*-executor.ts` may not import `node:fs` — reading the built runner bundle needs a port | `.dependency-cruiser.cjs` `no-fs-in-service:102` |
| `reviewer-core` keeps exactly two runtime dependencies and is **not modified by this feature** | `.dependency-cruiser.cjs` `core-stays-pure:116`; `SPEC-05 § Module interactions` |
| `vendor/shared/**` may import only zod and itself | `.dependency-cruiser.cjs` `contracts-stay-pure:130` |
| No module imports another module's folder; the `ci` module reaches agents through `container.agentsRepo` and repos through its own repository | `.dependency-cruiser.cjs` `no-cross-module:146` |
| Both vendored `shared` copies stay byte-identical; the server copy is the source of truth, and `diff -r` is the gate | `CLAUDE.md`; `INSIGHTS.md:1644-1660`; `.claude/skills/pr-self-review/gates.md` § repo · vendor |
| Vitest `resolve.alias` duplicates the tsconfig `paths` — add a path to one and not the other and tests break while typecheck passes | `CLAUDE.md` § Non-default conventions |
| Fastify modules are registered by hand in `server/src/modules/index.ts` | `CLAUDE.md`; `server/src/modules/index.ts:19-30` |
| Secrets reach code only through `SecretsProvider`, never `AppConfig` or `process.env` | `CLAUDE.md`; `container.github()` |
| Client: no `fetch` in a component — data goes through a TanStack Query hook in `src/lib/hooks/*`; `'use client'` on the leaf, never a layout or a barrel | `client/AGENTS.md`; `.claude/skills/frontend-architecture/SKILL.md` step 5 |
| Client: user-facing text lives in `messages/en/*.json`, never in `constants.ts` | `client/AGENTS.md` § i18n; frontend-architecture step 4 |
| Client: a property a breakpoint changes is declared **only** in the media-query block of `app/globals.css`, keyed on a `dd-` class | `client/AGENTS.md` |
| The mockup is an acceptance criterion — walk it element by element, and report differences rather than resolving them silently | `client/AGENTS.md` § "A design is an acceptance criterion" |
| A change to how a module is built, imported or bundled must name the build in its gates | `INSIGHTS.md:595-618` |
| `agent-runner/*` maps to no Track A package, so its gates must be run by hand | `scripts/pr-self-review/scope.sh:209-213`; `TESTING.md` |
| Integration tests are `*.it.test.ts` and are excluded from the unit run | `TESTING.md` |
| `server/` and `client/` use pnpm; `reviewer-core/`, `e2e/`, `mcp/` use npm. `agent-runner/` uses **npm**, matching the package it aliases | `CLAUDE.md` |
| Never seed rows to make a screen look fuller — AC-82's empty state is the real answer | project memory; `SPEC-05 § AC-82` |
| Comment only what would let someone make a mistake if deleted; rationale goes in the commit | project memory |
| Repository files are English | project memory |

## Recommendations

For the human, not the implementer. **The steps below are written to the requirements as they
stand**, not to these.

| # | Recommendation | Changes the plan? | Cost |
|---|---|---|---|
| R-1 | Move `parseUnifiedDiff` (`server/src/adapters/git/diff-parser.ts`) into `reviewer-core`, where the ring table already puts it — a pure transform with type-only imports, consumed by the engine's grounding gate. Today the runner has to alias it out of `server/src/adapters/`, which is an outer ring | Yes — P2 would import it from `@devdigest/reviewer-core`, and P1 would move the file plus its tests | Small, but it edits `reviewer-core`, which `SPEC-05 § Module interactions` fixes as unchanged. That is the spec's call, not the plan's |
| R-2 | Apply `wrapUntrusted` to `## Relevant memory` inside `reviewer-core/src/prompt.ts:200-202` instead of in the runner, so local studio runs get the same hardening the day the `memory` table is filled. AC-98 only binds the runner, and the day someone feeds `ReviewInput.memory` from the DB the studio path is unwrapped again | Yes — one change in `reviewer-core`, plus the runner's per-item wrapping becomes unnecessary | ~10 lines plus a reviewer-core test; changes the assembled prompt byte-for-byte for any run carrying memory (none today, `run-executor.ts:786`) |
| R-3 | Give `agent-runner/` a CI workflow and teach `scripts/pr-self-review/scope.sh` a fourth package, so the new suite is gated like the other four | No — deliberately out of scope here | One workflow file plus `scope.sh`; a branch touching `.github/workflows/**` cannot be pushed from this machine, so it needs someone who can push it |
| R-4 | **Done — accepted 2026-08-26.** Record the two `assumed` rows (R71, R72) back into SPEC-05 at its next amendment, so `ci_runs.workflow_run_id`, `ci_installations.last_polled_at` and `CiRunStatus.skipped` stop being plan-only decisions | It did: the spec's second amendment added D21 and AC-123…AC-133, R71 and R72 are now `clear`, and three rules the assumption never named arrived with it — uniqueness as a schema constraint (R73), the migration's behaviour over pre-existing rows (R74) and an unrecognised run state that must not reject the run (R76). P1.1, P1.3, P1.4, P1.8, P3.5 and P3.6 were rewritten for them | Paid. Kept in this table because "the assumption was closed before any code was written" is the record worth keeping |
| R-5 | The mockup shows `Update CI config` as a single header button; AC-91 says "for an installation". The plan builds a per-row control **and** keeps the header button, which is a divergence from the design worth a human's eye | No — already resolved in favour of AC-91 | None, if accepted |

## Skills the implementer must invoke

| Step | Skill | Why |
|---|---|---|
| P1.1, P1.2 | `zod` | The contract extensions must tolerate a missing field (AC-118) **and an unrecognised enum value** (AC-132) rather than default it or reject the artifact — `.nullish()` vs `.default()` vs a closed `z.enum` is the whole of R49 and R76 |
| P1.3, P1.4 | `drizzle-orm-patterns` · `postgresql-table-design` | New columns, the unique index that makes AC-75/AC-124 idempotency a database property rather than a service habit, its NULL semantics (AC-126), and a generated migration |
| P1.5, P1.6, P3.2 | `onion-architecture` | The new port methods, their Octokit adapter and their mock; where the `ci` module's files go and which ring each is in |
| P2.2–P2.9 | `security` | The runner executes inside someone else's repository: untrusted wrapping (R31, R39), the secret scan on the artifact (R33), and no secret in any generated file (R10) |
| P3.1–P3.4 | `onion-architecture` · `fastify-best-practices` · `zod` | Route/service/repository split, `schema.body` declarations, the rate limit, and the binary zip response |
| P3.5, P3.6 | `security` | The generated workflow (R22, R23) and the artifact validation chain (R43–R46) |
| P3.7 | `drizzle-orm-patterns` | The ingest repository's upsert-by-run-id |
| P4.1, P4.2 | `onion-architecture` | The exclusion is a pure predicate in `helpers.ts`, applied in the executor — not a new port and not a service change |
| P5.1–P5.4 | `frontend-architecture` · `react-best-practices` · `next-best-practices` | Where the wizard, the tab and the page live; hook vs component-body vs pure function; the App Router page and the `'use client'` boundary |
| P5.6 | `react-testing-library` | The component suites, including the navigation mock that actually re-renders |

`typescript-expert` and `pr-self-review` are not this plan's to invoke — the first is the
implementer's own judgement, the second is the human's gate before a push.

## Work packages

Five packages. **P1 blocks everything.** P2, P3, P4 and P5 do not overlap on a single file and may
run concurrently once P1 has landed.

---

### P1 — Contracts, schema and the Actions port

**Agent:** implementer · **Depends on:** —

**Owns:**
- `server/src/vendor/shared/contracts/eval-ci.ts`
- `server/src/vendor/shared/adapters.ts`
- `client/src/vendor/shared/**` (the mirror, byte-identical)
- `server/src/db/schema/ci.ts`
- `server/src/db/migrations/**` (one new migration + `meta/`)
- `server/src/adapters/github/octokit.ts`
- `server/src/adapters/mocks.ts`
- `server/test/ci-contracts.test.ts` (new)

**Contract — what P2, P3 and P5 may assume once this lands.** Repeat this block into every
downstream dispatch; each agent starts cold.

```ts
// server/src/vendor/shared/contracts/eval-ci.ts
CiRunStatus  = z.enum(['succeeded','failed','no_findings','running','skipped']);   // + 'skipped' (R72)
CiArtifactStatus = z.enum(['succeeded','failed','skipped']);                        // new (R68)
// CiArtifactStatus is what the RUNNER writes and the ingest INTERPRETS; it is not
// what the ingest parses with — see the `status` field below (R76).

CiRun = { ...existing,
  repo: z.string().nullish(),            // R51 — the page shows the repository
  workflow_run_id: z.number().int().nullish(),
  head_sha: z.string().nullish(),        // R66
  bundle_version: z.string().nullish(),  // R66
  verdict: Verdict.nullish(),            // R67 — SEPARATE from `status`
};

CiInstallation = { ...existing, agent_version: z.number().int().nullish() };        // R69
CiInstallationListItem = CiInstallation.extend({                                    // R58, R59, R62
  last_run_status: z.string().nullish(),
  last_run_at: z.string().nullish(),
  stale: z.boolean(),                    // agent_version < agents.version
});

CiResultArtifact = { ...existing,
  status: z.string().nullish(),          // R68/R76 — nullish, NOT .default(): AC-118 must not be
                                         //   made invisible by a default. And a plain string, NOT
                                         //   CiArtifactStatus: a closed enum here would fail the
                                         //   whole parse on an unknown value, which R45 then turns
                                         //   into a rejected run — exactly what AC-132 forbids.
                                         //   The vocabulary is applied when mapping, in P3.6.
  reason: z.string().nullish(),          // R68 — the named cause for failed/skipped
  verdict: Verdict.nullish(),            // R68
  changed_lines: z.number().int().nullish(),      // R40
  max_changed_lines: z.number().int().nullish(),  // R40
};

// server/src/vendor/shared/adapters.ts — added to GitHubClient
interface WorkflowRunRef { id: number; head_sha: string; status: string;
  conclusion: string | null; pr_number: number | null; html_url: string;
  run_started_at: string | null; updated_at: string | null; repository: string; }
interface WorkflowArtifactRef { id: number; name: string; size_in_bytes: number; expired: boolean; }

listWorkflowRuns(repo: RepoRef, workflowFile: string, opts?: { perPage?: number }): Promise<WorkflowRunRef[]>;
listRunArtifacts(repo: RepoRef, runId: number): Promise<WorkflowArtifactRef[]>;
downloadArtifact(repo: RepoRef, artifactId: number, maxBytes: number): Promise<Uint8Array>;

// server/src/vendor/shared/adapters.ts — a new port, one user, placed here for the same
// reason PromptTemplates:493 is (the mock lives in adapters/mocks.ts, which P1 owns)
interface RunnerBundleInfo { contents: string; version: string; sourceSha: string; bytes: number; }
interface RunnerBundle { read(): Promise<RunnerBundleInfo>; }
```

Schema (`ci_runs`): `+ repo text`, `+ workflow_run_id bigint`, `+ agent text`, `+ duration_ms integer`,
`+ head_sha text`, `+ bundle_version text`, `+ verdict text`, unique index on
`(repo, workflow_run_id)`. Schema (`ci_installations`): `+ agent_version integer`,
`+ last_polled_at timestamptz`.

**Every one of those columns is nullable, and the unique index leaves NULLs distinct** (R74).
`ci_runs` already holds rows with no run id, so a `NOT NULL` on `workflow_run_id` cannot be added
without inventing values, and `NULLS NOT DISTINCT` would make every one of those pre-existing rows
collide with every other. Postgres' default is what this plan wants; the step below says so
because drizzle offers `.nullsNotDistinct()` and it would silently break the migration.

**Steps**

1. **P1.1 — Extend the CI contracts.** Edit `server/src/vendor/shared/contracts/eval-ci.ts` to the
   block above (R66–R69, R72, R76, R40, R51, R58, R59, R62). Every new field is `.nullish()`, never
   `.default()` — `server/INSIGHTS.md` "A contract field with `.default()` makes a MISSING WRITE
   invisible" is exactly the failure AC-118 forbids. `CiResultArtifact.status` is `z.string()`,
   not `CiArtifactStatus`, for the reason in the block above: an unknown state must reach P3.6 to
   be dropped there with a logged reason, not fail the parse and take the whole run with it
   (R76/AC-132). `CiRunStatus` carries five values and is the vocabulary of the **row**, not of the
   artifact. *Check:* `cd server && pnpm typecheck` is clean;
   `CiResultArtifact.parse({ findings_count: 0, cost_usd: null, agent: 'x' })` succeeds with
   `status === undefined`; `CiResultArtifact.parse({ …, status: 'cancelled' })` **succeeds**;
   `CiRunStatus.parse('skipped')` succeeds.
2. **P1.2 — Extend the GitHub port.** Add `WorkflowRunRef`, `WorkflowArtifactRef`, the three
   Actions methods and the `RunnerBundle` port to `server/src/vendor/shared/adapters.ts` (R41, R43,
   R44). `downloadArtifact` takes `maxBytes` so the cap is enforced before bytes are held, the way
   `parseSkillArchive`'s filter does. *Check:* `pnpm typecheck` fails in `octokit.ts` and
   `mocks.ts` until P1.5/P1.6 land — that failure is the seam working.
3. **P1.3 — Extend the schema, and put idempotency in the database.** Edit
   `server/src/db/schema/ci.ts` with the columns above (R66, R69, R71) and add
   `uniqueIndex('ci_runs_repo_run_idx').on(t.repo, t.workflowRunId)` in the table's second
   argument — the shape `pr_brief` already uses, whose comment (`schema/reviews.ts:90-97`) says why:
   the constraint is "what makes […] true by construction rather than by a service remembering to
   check. It is also the unique index that upsert needs." That is R73/AC-124 exactly: two ingest
   passes reading the same artifact concurrently must be stopped by the database, because a
   read-then-write in the service lets both of them see no row and both insert one, and neither
   errors. Three properties the step must not lose:
   - the index is on `(repo, workflow_run_id)`, **not** `workflow_run_id` alone — the ingest
     resolves both from `WorkflowRunRef` (R46), and the pair additionally refuses a run id claimed
     against a repository it does not belong to;
   - **no `.nullsNotDistinct()`** — R74/AC-126 requires the rows written before this migration,
     which carry neither column, to coexist. Postgres' default already does that; adding the
     modifier is what would break it;
   - both new columns stay nullable. `workflow_run_id` is `bigint({ mode: 'number' })` — GitHub run
     ids exceed a signed 32-bit integer.

   *Check:* the file compiles; the index names both columns in that order; `grep -c nullsNotDistinct
   src/db/schema/ci.ts` is 0.
4. **P1.4 — Generate and apply the migration, against a database that is not empty.** `cd server
   && pnpm db:generate`, then `pnpm db:migrate`. Do not hand-write the SQL. The generated
   `ADD COLUMN`s must carry no `NOT NULL` and no `DEFAULT`, and the `CREATE UNIQUE INDEX` must
   carry no `NULLS NOT DISTINCT` — read the SQL before applying it (R74/AC-126). *Check:* one new
   file under `src/db/migrations/`, `meta/_journal.json` updated, and `pnpm db:migrate` twice in a
   row is a no-op the second time. Then the check that AC-126 actually asks for, which an empty
   dev database cannot give: insert two `ci_runs` rows carrying only the pre-migration columns
   **before** running the migration, apply it, and confirm both rows are still there and neither
   the `ADD COLUMN` nor the unique index rejected them. `server/test/ci-ingest.it.test.ts`
   (P3.6) is the place to keep that as a standing test if testcontainers can be pointed at the
   pre-migration schema; if it cannot, do it by hand once and say so in the report.
5. **P1.5 — Implement the three Actions methods in Octokit.** In
   `server/src/adapters/github/octokit.ts`, following the existing `withRetry(() =>
   withTimeout(…, TIMEOUT))` shape of `commitFiles:332`: `listWorkflowRuns` →
   `GET /repos/{o}/{r}/actions/workflows/{file}/runs` mapping `pull_requests[0].number` into
   `pr_number` and `repository.full_name` into `repository`; `listRunArtifacts` →
   `GET /repos/{o}/{r}/actions/runs/{id}/artifacts`; `downloadArtifact` →
   `GET /repos/{o}/{r}/actions/artifacts/{id}/zip` returning `Uint8Array`, **refusing** before
   allocation when the declared `size_in_bytes` or the received length exceeds `maxBytes` (R44).
   *Check:* `pnpm typecheck` clean; the octokit test injects a stub `Octokit` (the constructor
   already accepts one, `octokit.ts:69`) and asserts the refusal path allocates nothing.
6. **P1.6 — Mocks.** In `server/src/adapters/mocks.ts` extend `MockGitHubClient:139` with the three
   methods (canned runs/artifacts, plus recorders `downloadedArtifacts: number[]`) and options to
   force each rejection path, and add `MockRunnerBundle` returning fixed
   `{ contents, version, sourceSha, bytes }`. *Check:* `MockGitHubClient` still satisfies
   `GitHubClient` structurally with no `as` cast.
7. **P1.7 — Mirror both vendored copies.** Copy the two edited files into
   `client/src/vendor/shared/`. *Check:* `diff -r server/src/vendor/shared client/src/vendor/shared`
   prints nothing (R65).
8. **P1.8 — Contract tests.** `server/test/ci-contracts.test.ts`, four cases that must not be
   collapsed into fewer:
   - an older-bundle artifact (no `status`, no `verdict`) parses, and both fields read back
     `undefined` rather than a default (R49/AC-118);
   - an artifact whose `status` is `'cancelled'` — a value in no enum — **parses**, because
     rejecting it here is what AC-132 forbids; what happens to the value is P3.6's test;
   - an artifact failing the schema on a field that is genuinely typed — `findings_count: 'many'`
     — is still rejected with the field named (R45/AC-72), so the previous case cannot be read as
     "the artifact contract stopped validating";
   - `CiRunStatus` parses all five values including `skipped`, and `CiArtifactStatus` all three
     (R72/AC-130).

   *Check:* `cd server && pnpm exec vitest run test/ci-contracts.test.ts`; delete the `skipped`
   value from the enum and the fourth case fails, which is the proof the assertion is not vacuous.

---

### P2 — The `agent-runner` package

**Agent:** implementer · **Depends on:** P1

**Owns:** `agent-runner/**` (everything), `scripts/dev.sh`.

**Contract — what P3 may assume.** The build writes two files:

```
agent-runner/dist/runner.mjs        — one self-contained ESM file, ≤ 1.5 MiB, banner first
agent-runner/dist/runner.meta.json  — { "version": "0.1.0", "sourceSha": "<40-char>", "bytes": 712345 }
```

The banner (esbuild `--banner:js`), which is what AC-22 is about:

```
// DevDigest agent-runner v<version> — built from <40-char sourceSha>
// generated — do not edit
```

The runner's whole input is the environment; it takes **no** arguments (AC-50, AC-53):

| Var | Meaning |
|---|---|
| `DEVDIGEST_AGENT` | manifest slug → `.devdigest/agents/<slug>.yaml` |
| `DEVDIGEST_PR_NUMBER` · `DEVDIGEST_REPOSITORY` | `owner/name` and the PR number, from the run's own context |
| `DEVDIGEST_IS_FORK` | `"true"` → the fork path (R24) |
| `DEVDIGEST_POST_AS` | `github_review` \| `pr_comment` \| `none` (R34) |
| `DEVDIGEST_MAX_DIFF_LINES` | the ceiling in force (R37, R40); default 15000 |
| `OPENROUTER_API_KEY` · `GITHUB_TOKEN` · `GITHUB_STEP_SUMMARY` | provided by the job |

It always writes `devdigest-result.json` in the working directory, on every path including the
fork skip and the failure path.

**Steps**

1. **P2.1 — Scaffold the package.** `agent-runner/package.json` (`"type": "module"`, **npm**, name
   `@devdigest/agent-runner`, private), `tsconfig.json` with `paths` for `@devdigest/shared` →
   `../server/src/vendor/shared`, `@devdigest/reviewer-core` → `../reviewer-core/src`, and
   `@devdigest/diff-parser` → `../server/src/adapters/git/diff-parser.ts`; `vitest.config.ts`
   whose `resolve.alias` **repeats the same three aliases** (`CLAUDE.md`: the two files duplicate
   each other on purpose); `agent-runner/.gitignore` holding `dist/`; `agent-runner/README.md`
   naming the build command and the env contract above. *Check:*
   `cd agent-runner && npm install && npm run typecheck` is clean.
2. **P2.2 — The build.** `agent-runner/scripts/build.mjs` runs esbuild with
   `--bundle --platform=node --format=esm --minify --target=node20`, `--banner:js` carrying the
   version and `git rev-parse HEAD`, and `--define:__RUNNER_VERSION__` so the runner can report its
   own version into the artifact; it then writes `dist/runner.meta.json` and **fails the build when
   `dist/runner.mjs` exceeds 1.5 MiB** (the spec's `## Non-functional requirements`). `esbuild` is a
   devDependency of this package only. `reviewer-core`'s own `node_modules` must exist first —
   `openai` and `zod` resolve from there. *Check:* `npm run build` produces both files, the first two
   lines of `runner.mjs` are the banner (R9/AC-22), and the size is printed.
3. **P2.3 — Manifest + skills + memory loading.** `src/inputs.ts`: read
   `.devdigest/agents/<slug>.yaml`, parse it with the YAML dependency chosen in P2.1 (**confirm its
   `parse` entry point against the installed package's own types before writing the call**), validate
   with `AgentManifest`; on failure exit non-zero printing the failing Zod path and making no model
   call (R29). Resolve `manifest.skills` slugs to `.devdigest/skills/<slug>.md` bodies. Read
   `.devdigest/memory.jsonl` up to 64 KiB and 100 lines, parse per line, skip a bad line and record
   its number, and return `[]` when the file is absent (R39). *Check:* unit tests for each of the
   four memory branches and the invalid-manifest exit.
4. **P2.4 — GitHub I/O.** `src/github.ts`: plain `fetch` (Node 20 global) with
   `Authorization: Bearer $GITHUB_TOKEN` — PR detail, changed files with patches, PR comments,
   post review, post comment (R30, R34). Assemble the `UnifiedDiff` by reconstructing the unified
   text from the file patches and running `parseUnifiedDiff` from `@devdigest/diff-parser`, the same
   way `server/src/modules/reviews/diff-loader.ts:33` does. *Check:* tests stub `globalThis.fetch`
   and assert the request paths, and one asserts the reconstructed diff's `newLineNumbers`.
5. **P2.5 — Prompt inputs, all untrusted.** `src/review.ts`: **truncate first, then
   `wrapUntrusted`** — `server/INSIGHTS.md` "Truncate untrusted text BEFORE `wrapUntrusted`, never
   after" — for the PR title, body, branch name and comments (R31), and for **each** memory item
   before it goes into `ReviewInput.memory` (R39/AC-98, which is why the wrapping is here and not
   in `reviewer-core`). The diff is wrapped by `assemblePrompt` itself. *Check:* a test asserts the
   count of opening fences equals the count of closing fences for a memory item carrying a literal
   `</untrusted>`.
6. **P2.6 — Run the review.** Call `reviewPullRequest` with `OpenRouterProvider` from
   `@devdigest/reviewer-core`, `strategy` from the manifest, `mapThresholdLines` left at the
   engine default, retries per the spec's `## Non-functional requirements` (R32). Grounding is
   inside the engine; the outcome's `review.findings` are already grounded, and `dropped` goes to
   the job summary only. *Check:* a test with a stub `LLMProvider` asserts an ungrounded finding
   reaches neither the artifact nor the publication.
7. **P2.7 — Exit code and publication.** `gateTriggered(review.findings, manifest.ci_fail_on)` from
   `reviewer-core` decides the exit code for all four values (R35); `toReviewPayload` builds the
   review body, and `DEVDIGEST_POST_AS` decides whether it is posted as a review, as a comment, or
   not at all (R34). *Check:* a table-driven test over the four `CiFailOn` values × {no findings,
   SUGGESTION, WARNING, CRITICAL}.
8. **P2.8 — The artifact, on every path.** `src/artifact.ts` writes `devdigest-result.json`
   validated against `CiResultArtifact` (R33), carrying `status`, `reason`, `verdict`,
   `changed_lines`, `max_changed_lines` (R40), `version` (the compiled-in runner version) and
   `agent`. Four paths reach it: success, `failed` after retries with a non-zero exit (R36),
   `skipped` for a diff over `DEVDIGEST_MAX_DIFF_LINES` with exit 0 (R37), and `skipped` for a fork
   with exit 0 plus a `GITHUB_STEP_SUMMARY` line naming the reason and the unavailable secrets
   (R24). Before writing, run a secret scan over the serialised JSON — no `OPENROUTER_API_KEY`
   value, no `GITHUB_TOKEN` value, no prompt text, no raw diff (R33/AC-63). *Check:* four tests,
   one per path, each asserting the file parses against the schema and the exit code; one asserts a
   planted key value is refused rather than truncated.
9. **P2.9 — Entry point.** `src/index.ts` orders the branches so **the fork check runs first** and
   nothing else is even read (AC-52: no model call), then the manifest, then the diff ceiling.
   *Check:* a test with `DEVDIGEST_IS_FORK=true` and a deliberately invalid manifest still exits 0
   and writes a `skipped` artifact.
10. **P2.10 — Bootstrap.** Add a runner build to `scripts/dev.sh` after the `reviewer-core` install
    it already does, so a fresh clone can export. *Check:* `./scripts/dev.sh` on a tree with no
    `agent-runner/dist` produces the bundle before the API starts.

---

### P3 — The server `ci` module

**Agent:** implementer · **Depends on:** P1

**Owns:**
- `server/src/modules/ci/**` (new: `routes.ts`, `service.ts`, `repository.ts`, `helpers.ts`,
  `constants.ts`, `types.ts`, `generate/{manifest,workflow,bundle}.ts`, `ingest-executor.ts`)
- `server/src/modules/index.ts`
- `server/src/platform/container.ts`
- `server/src/adapters/runner-bundle/index.ts` (new)
- `server/README.md`
- `server/test/ci-*.test.ts`, `server/test/ci-*.it.test.ts` (new)

**Contract — the HTTP surface P5 codes against.** Repeat this block into P5's dispatch.

```
POST /agents/:id/export-ci        body CiExportInput            → CiExport          10 req/min
POST /agents/:id/export-ci/zip    body CiExportInput            → application/zip   10 req/min
GET  /agents/:id/ci                                             → CiInstallationListItem[]
GET  /ci/runs                                                   → { runs: CiRun[], last_polled_at: string | null }
POST /ci/runs/refresh             body { force?: boolean }      → { runs: CiRun[], last_polled_at: string | null,
                                                                    errors: { repo: string; reason: string }[] }
```

`force: true` is the Refresh button (R41/AC-68) and ignores the 5-minute window; `force` absent or
`false` is what the page sends on mount (R57/AC-120) and skips any repo polled successfully within
5 minutes (AC-121). `errors[]` is what AC-83 renders — the previously stored `runs` are returned
alongside it, never emptied.

**Steps**

1. **P3.1 — Module shell and registration.** Create `server/src/modules/ci/` with
   `routes.ts` (a default Fastify plugin), `service.ts` (`constructor(container: Container, repo =
   new CiRepository(container.db))`), `repository.ts` (`constructor(private db: Db)`),
   `helpers.ts`, `constants.ts`, `types.ts`; register one import + one entry in
   `server/src/modules/index.ts` (R5, R18). Routes declare `schema.body`/`schema.params` — never
   `Schema.parse(req.body)`. The export routes carry
   `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }`, modelled on
   `modules/conventions/routes.ts:24`. *Check:* `cd server && pnpm arch` exits 0 and
   `GET /agents/:id/ci` answers 404 for an unknown agent.
2. **P3.2 — The runner-bundle port's adapter and its wiring.** `server/src/adapters/runner-bundle/index.ts`
   implements `RunnerBundle` by reading `agent-runner/dist/runner.mjs` + `runner.meta.json`
   relative to `import.meta.url`, the way `platform/prompts.ts:20` resolves `src/prompts`; a
   missing bundle throws a `ConfigError` naming the build command. Add
   `ContainerOverrides.runnerBundle` and a `get runnerBundle()` to
   `server/src/platform/container.ts` (R9, R28). *Check:* the service never imports `node:fs`
   (`pnpm arch` proves it), and a container with the mock produces a bundle with no file on disk.
3. **P3.3 — Bundle generation.** `generate/`:
   - `slug.ts` — the AC-17 rule, the id fallback (AC-105) and the `-2`/`-3` disambiguation
     (AC-18), over **code points** so a Cyrillic or emoji name behaves (R7). `server/INSIGHTS.md`
     "Truncating text for an API response with `String.slice` corrupts emoji" is the same trap.
   - `manifest.ts` — the agent's row → `AgentManifest` → YAML text, carrying the agent's current
     `ci_fail_on` including `any` (R10/AC-26).
   - `workflow.ts` — the `devdigest-review.yml` generator: `on: pull_request` with only the chosen
     `types` (R15); `permissions` exactly as R15 states per `post_as`; `timeout-minutes: 15` and
     `concurrency: { group: devdigest-review-${{ github.event.pull_request.number }},
     cancel-in-progress: true }` (R23); every `uses:` pinned to a 40-character SHA with a version
     comment, from a `PINNED_ACTIONS` table in `constants.ts` (R22) — **resolve those SHAs with
     `gh api repos/actions/checkout/git/ref/tags/v4.2.2` and the equivalents for `setup-node` and
     `upload-artifact`; do not guess one**; a fork guard that exits 0 before the runner step (R24);
     the runner step `run: node .devdigest/runner.mjs` with the whole input in `env:` per P2's
     contract (R22/AC-50, R25); an upload step with `if: always()`, `name: devdigest-result`,
     `path: devdigest-result.json` (R26, R36).
   - `bundle.ts` — assembles the ordered `CiFile[]` of R6: manifest, one file per bound skill,
     an **empty** `memory.jsonl` (R38 — nothing from the DB, and the test greps the bundle for an
     accepted convention's text), `runner.mjs` from the port with `editable: false` (R8),
     `.devdigest/.gitattributes` containing `runner.mjs linguist-generated=true` (R9), the
     workflow with `editable: true`.
   *Check:* unit tests for each generator; one asserts the bundle contains no value returned by a
   `MockSecretsProvider` (R10/AC-25); one asserts the file count equals the list length for `N=0`
   skills (R16/AC-38 and the spec's first edge case).
4. **P3.4 — Install, zip, and the installation row.** `service.export()`: validate `repo` as
   `owner/name` refusing `..`, more than one slash and whitespace (spec `## Untrusted inputs`);
   `action: 'open_pr'` → `commitFiles({ branch: 'devdigest/ci', base, message, files })` then
   `findOpenPr` → reuse or `openPullRequest` titled "Add DevDigest CI review" (R17); upsert exactly
   one `ci_installations` row on (`agent_id`, `repo`) carrying `agent_version = agents.version`
   (R18, R69); a GitHub throw propagates as a named error with **no** row written (R19).
   `action: 'files'` and the `/zip` route make no GitHub call and write no row (R20) — the zip is
   built with `fflate`'s `zipSync` over the same `CiFile[]`. `target !== 'gha'` is refused by the
   route schema (R5). Before committing, parse the (possibly hand-edited) workflow YAML and refuse
   with the failing line, committing nothing (R27) — refuse, never repair;
   `server/INSIGHTS.md` "A length cap applied to a string that will be EXECUTED has to reject it"
   is the same principle. *Check:* `server/test/ci-export.it.test.ts` — two Installs in a row leave
   one row and one PR; a `MockGitHubClient` set to throw leaves zero rows.
5. **P3.5 — Ingest, the validation chain.** `ingest-executor.ts`, registered as a `JobRunner` kind
   with the spec's timeout/retries/concurrency: for each `ci_installations` row →
   `listWorkflowRuns(repo, 'devdigest-review.yml')` (R41) → `listRunArtifacts(run.id)` → take only
   the one named `devdigest-result` (R43) → `downloadArtifact(id, MAX_ARCHIVE_BYTES)` → `unzipSync`
   with a `filter` budgeting `max(originalSize, size)` and refusing anything but exactly one entry,
   copied from `modules/skills/import.ts:33` (R44) → `JSON.parse` in a `try` → `CiResultArtifact`
   (R45). Then the authenticity checks of R46: `repo`, `head_sha` and PR number come from
   `WorkflowRunRef`, and a `pr_number` or repository mismatch rejects the run. Every rejection logs
   its reason and creates no row. The token comes from `container.github()`, which resolves it
   through `SecretsProvider` (R42) — no `process.env` anywhere in this module.

   **Two things this chain must not treat as rejections** (R76/AC-132, R49/AC-118): an artifact
   with no run state, and an artifact whose run state is a value `CiRunStatus` does not carry.
   Both are accepted here and resolved in P3.6. The reason is a compatibility one — the bundle in
   a target repository is whatever version was committed there, so the first extension of
   `CiRunStatus` after this ships would otherwise stop ingest for every repo still running the
   older runner, silently and repo by repo.

   A poll that throws — the Actions API refusing, timing out, or the token lacking permission —
   is a **failed poll** for that installation: it yields an entry in `errors[]` (R55) and, per
   R75/AC-129, must not reach the stamping in P3.6. Per-installation, so one repo's failure
   neither aborts the others nor stamps them.

   *Check:* `server/test/ci-ingest.test.ts` — one test per rejection branch, each asserting the
   `ci_runs` count is unchanged; plus one test that an artifact with `status: 'cancelled'` reaches
   the write path rather than a rejection branch.
6. **P3.6 — Ingest, the write.** One `ci_runs` row per `(repo, workflow_run_id)` (R47, R71, R73),
   filling `agent`, `duration_ms`, `head_sha`, `bundle_version`, `verdict` **from the artifact,
   never derived from `findings_count`** (R49). Four rules, each with a criterion behind it:

   - **The write is a single statement.** `insert(...).onConflictDoUpdate({ target: [t.repo,
     t.workflowRunId], set: … })` in the repository, against the unique index P1.3 added — the
     shape `context/repository.ts:405` already uses. **Not** a `select` followed by an `insert` or
     an `update`: R73/AC-124 exists because two ingest passes over the same run would both find no
     row, both insert, and neither fail. There is no code path in this module that decides whether
     a run is new; the database decides (R47/AC-75, R73/AC-125).
   - **The status mapping is explicit, one-to-one, and total.** `succeeded → succeeded`,
     `failed → failed`, `skipped → skipped`. Ingest never produces `no_findings` and never derives
     the state from `findings_count` — that count is its own column, and `skipped` written as
     `failed` or as `no_findings` would report a run that was deliberately not performed as a
     broken one, or as one that ran and found nothing (R76/AC-131). `running` belongs to studio
     runs; an ingested artifact describes a run that has finished. Missing state → `null`.
     A state the enum does not carry → `null` **plus** a log line naming
     the repository, the run id and the unrecognised value; the value itself is not written to the
     column, and the row is still created (R76/AC-132, R49/AC-118).
   - **Then one `agent_runs` row** with `source='ci'`, `workspace_id` resolved from the
     installation's agent, `pr_id` left null when the PR was never imported (R47).
   - **`ci_installations.last_polled_at` is stamped on the success path only** (R75/AC-128), with
     the time of the poll, and per installation. A poll that threw (P3.5) leaves the stored value
     as it was, so the AC-84 timestamp keeps naming the last poll that actually returned data and
     the AC-121 window is not restarted by a failure (R75/AC-129). Concretely: the stamp is the
     last statement of the per-installation success branch, not a `finally`, and not a stamp taken
     before the poll is attempted.

   *Check:* `server/test/ci-ingest.it.test.ts` — two refreshes in a row leave one row and the
   second refresh's values won (the update happened, not a silent no-op); an older-bundle artifact
   creates a row with null `status` and null `verdict`; an artifact with `status: 'cancelled'`
   creates a row with null `status` and logs the value; a `skipped` artifact creates a row whose
   status is `skipped`; a `listWorkflowRuns` that rejects leaves that installation's
   `last_polled_at` at its previous value while a sibling installation that succeeded is stamped.
7. **P3.7 — The read routes.** `GET /ci/runs` returns rows newest-first with `last_polled_at` =
   the max over installations (R51, R56); `POST /ci/runs/refresh` honours `force` and the 5-minute
   window per repo and returns `errors[]` for repos whose poll failed, alongside the stored rows
   (R55, R57). Both the window and the displayed timestamp read
   `ci_installations.last_polled_at` — the stored column, never an in-process cache: a window that
   lives in server memory reopens every installation for polling on the next restart, which is
   what D20 avoids, and it would also survive a failed poll differently from the column
   (R71/AC-127, R75). `GET /agents/:id/ci` returns `CiInstallationListItem[]` with `last_run_status`,
   `last_run_at` and `stale = agent_version < agents.version` (R58, R59, R62). Row → DTO mapping
   lives in `helpers.ts`; no `*Row` type leaves the module. *Check:* a route test asserts a second
   refresh within 5 minutes makes zero `listWorkflowRuns` calls on the mock (R57/AC-121).
8. **P3.8 — Document the routes.** Add the `ci` module to the API map in `server/README.md`
   (`CLAUDE.md` names that file as the thing to read before adding a route). *Check:* the mermaid
   block renders and names all five routes.

---

### P4 — Project Context stops scanning the bundle

**Agent:** implementer · **Depends on:** —

**Owns:** `server/src/modules/context/constants.ts`, `server/src/modules/context/helpers.ts`,
`server/src/modules/context/scan-executor.ts`, `server/test/context-bundle-exclusion.test.ts` (new).

This is the one deliberate crossing into another module, and the spec names it in
`## Module interactions` so it is not mistaken for scope creep (D15). Its radius is small by
construction: `DOC_EXTENSIONS = ['.md']` (`constants.ts:113`), so the scan never sees `.yaml`,
`.jsonl`, `.mjs` or `.gitattributes` at all — the exclusion is needed for exactly
`.devdigest/skills/*.md` and `.devdigest/agents/*.md`.

**Steps**

1. **P4.1 — The predicate.** Add `EXCLUDED_DEVDIGEST_SUBROOTS = ['skills', 'agents']` to
   `constants.ts` beside `DEVDIGEST_ROOT:106`, and a pure
   `isExcludedBundlePath(path: string): boolean` to `helpers.ts` beside `kindForRoot:193`,
   comparing segments the way `segmentsOf` already does — never a bare `startsWith`, which
   `.devdigest/skills-lab/x.md` would defeat (R70). *Check:* unit tests for
   `.devdigest/skills/a.md` (true), `.devdigest/agents/a.md` (true),
   `.devdigest/skills-notes/a.md` (false), `.devdigest/specs/a.md` (false).
2. **P4.2 — Apply it in the walk.** In `scan-executor.ts`, inside the `for (const file of files)`
   loop at `:60`, `continue` on `isExcludedBundlePath(file.path)` — beside the existing
   `root === undefined` skip, before `readFile` (R70/AC-106). Do **not** touch
   `settings.ts:90`/`withDevdigest`: `server/INSIGHTS.md` "`.devdigest` is appended to the scan
   roots AFTER the defaults branch, never before" says what moving that line costs, and this
   change does not need it. Everything else under `.devdigest/` stays (AC-108). *Check:*
   `server/test/context-bundle-exclusion.test.ts` runs the executor over a `MockGitClient` listing
   `.devdigest/skills/x.md`, `.devdigest/agents/y.md` and `.devdigest/specs/z.md`, and asserts the
   persisted doc set holds only the third and that the prompt's `## Project context` therefore
   cannot carry the first two (R70/AC-107).

---

### P5 — The client

**Agent:** implementer · **Depends on:** P1 (types) · P3 (routes — the contract block above is
repeated into this dispatch, so P5 can be written before P3 lands and verified after)

**Owns:**
- `client/src/app/agents/[id]/_components/AgentEditor/{constants.ts,AgentEditor.tsx}` and
  `.../AgentEditor/_components/CITab/**` (new)
- `client/src/app/agents/[id]/_components/AgentEditor/_components/ExportWizard/**` (new)
- `client/src/app/ci-runs/**` (new)
- `client/src/lib/hooks/ci.ts` (new), `client/src/lib/types.ts`
- `client/src/vendor/ui/nav.ts`
- `client/messages/en/ci.json`

**Design artefacts — compare against them element by element, they are acceptance criteria**
(`client/AGENTS.md`): `specs/assets/SPEC-05-export-to-ci-tab.png` (the CI tab and the sidebar row),
`-target.png`, `-preview.png`, `-configure.png`, `-install.png`, and
`specs/assets/SPEC-05-export-to-ci-mockup.jsx` for the copy strings, step order and card layout
(`CI_TARGETS`, `EXPORT_TREE`, `YAML_PREVIEW`, `ExportWizard`, `CITab`, `FAIL_OPTS`).

**Steps**

1. **P5.1 — Hooks.** `client/src/lib/hooks/ci.ts` — `useCiInstallations(agentId)`,
   `useCiRuns()`, `useRefreshCiRuns()`, `useExportCi(agentId)`, `useDownloadCiZip(agentId)`. No
   `fetch` outside this file (`client/AGENTS.md`); import it directly, **not** through
   `lib/hooks/index.ts` (`client/INSIGHTS.md` "Nine `index.ts` files are aggregating barrels, and
   `@/lib/hooks` is the costly one"). **No `refetchInterval` anywhere** — AC-122 forbids a timer,
   and the scaffolded string `ci.runs.autoRefresh` must stay unused. `useCiRuns` fires the
   non-forced refresh once on mount (R57/AC-120); the button calls the forced one (R41).
   Re-export the new contract types from `client/src/lib/types.ts` rather than redefining them.
   *Check:* `cd client && pnpm typecheck`.
2. **P5.2 — The CI tab.** Add `{ key: "ci", labelKey: "editor.tabs.ci", icon: "Workflow" }` to
   `AgentEditor/constants.ts:11` (`VALID_TABS` is derived, so `?tab=ci` follows, R1/AC-1) and a
   branch in `AgentEditor.tsx:24`. Build `_components/CITab/`: the empty state "Not in CI yet" with
   one `Add to CI` action (R1/AC-2); with installations, the heading "CI deployment", the badge
   "Active in N repos" (R58), the `Fail CI on` segmented control of exactly three options with the
   `any` behaviour of R60 saving through the existing `PATCH /agents/:id` (which already accepts
   `ci_fail_on`, `server/src/modules/agents/routes.ts:54`) and reverting on failure (AC-94), the
   explanatory line of R61, one row per installation with repo · target type · last-run status ·
   relative time (R59) and a staleness marker when `stale` (R62), a per-row `Update CI config`
   opening the wizard prefilled with that installation's repo (R63), and the dashed `Add repository`
   row (R1/AC-3). *Check:* RTL tests for the empty state, the three-button control with a stored
   `any` (none highlighted, current named), and the stale marker.
3. **P5.3 — The Export Wizard.** `_components/ExportWizard/` as a `Modal` (`@devdigest/ui`) using
   the existing `ExportWizardSteps` for the indicator (R2/AC-4 — do not rebuild it). Four step
   components under `ExportWizard/_components/`, wizard state in one `useReducer` in the modal so
   closing discards everything and nothing is written before `Install` (R2/AC-7, D10). Target: the
   repo selector (`SearchableSelect`) defaulted to the sidebar repo with the base branch shown, the
   empty-workspace branch, the already-installed notice (R3), and the four cards with the three
   `aria-disabled` ones whose activation is a no-op (R4). Preview: the file list, the editor pane
   with the `editable`/`generated` badges, the over-threshold placeholder showing header + byte size
   (R8) — a 700 KB minified file must never reach the DOM. Configure: the three chips, the disabled
   `Continue` with its reason, the three radios, the regeneration warning dialog (R11, R12, R14),
   and the info panel rewritten to AC-30 (R13). Install: the two cards, the derived file count
   (R16/AC-38), the zip card's "DevDigest will not see this repo's runs" line (R20/AC-119), and on
   success the PR link plus the `OPENROUTER_API_KEY` instruction (R21). *Check:* RTL tests for the
   `aria-disabled` no-op, the derived count with `N=0` skills, `Back` preserving choices, and the
   regeneration warning.
4. **P5.4 — The CI Runs page.** `client/src/app/ci-runs/page.tsx` + `_components/`, using
   `PageShell`. Eight columns per R51, "—" for a null cost (R52), `target="_blank"
   rel="noopener noreferrer"` on the job link (R53), the empty state with no invented rows (R54),
   the error banner over the still-present rows for `errors[]` (R55), and the last-poll timestamp
   (R56). Every artifact-derived value renders as **text**, never as markdown or HTML (R48/AC-77).
   *Check:* RTL tests for the empty state, the null-cost cell and the error banner leaving rows in
   place.
5. **P5.5 — Navigation.** Add a `GLOBAL` section to `NAV` in `client/src/vendor/ui/nav.ts:20`
   holding one item `{ key: "ci-runs", label: "CI Runs", icon: "Workflow", href: "/ci-runs" }`
   (R50/AC-78). **No `gKey`** — the file's own comment at `:64-70` makes every `gKey` owe a
   `SHORTCUTS` row, and no criterion asks for a shortcut. `activeKeyFor` (`helpers.ts:43`) and
   `messages/en/shell.json` → `nav.ci-runs` already exist; change neither. *Heads-up for the
   coordinator:* worktree A may add a `Multi-Agent Review` row to this same array — the conflict,
   if it happens, is in this one array and nowhere else.
6. **P5.6 — Strings.** Extend `client/messages/en/ci.json`: rewrite `exportWizard.blockMergeDesc`
   to AC-30's sentence (R13), rewrite `ciTab.heading` to "CI deployment" and `ciTab.empty` to the
   AC-2 copy, add the `runs.table` columns AC-79 needs, and add `agents.editor.tabs.ci`. Leave
   `publishDialog` and `runs.filters` untouched — unused scaffolding is not dead code
   (`client/AGENTS.md` § i18n). *Check:* `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
   `pnpm build` (a new page changes what is imported at runtime — `INSIGHTS.md:595-618`).

---

**Dispatch order**

```
P1  ──────────────►  (must land and pass `diff -r` before anything else is dispatched)
      ├── P2  (agent-runner)      ─┐
      ├── P3  (server ci module)  ─┼── concurrent, no shared file
      └── P5  (client)            ─┘
P4  (context exclusion) — independent of P1; dispatch it whenever a slot is free
```

Two landing points: **P1 must land before P2, P3 and P5 start**, because all three compile against
its contracts. **P3 must land before P5's verification** (stage 2 needs a live API), though P5's
code can be written against the contract block above in parallel.

## Tests

| Suite | Files | Command |
|---|---|---|
| server unit | new `server/test/ci-contracts.test.ts`, `ci-generate.test.ts`, `ci-slug.test.ts`, `ci-workflow.test.ts`, `ci-ingest.test.ts`, `ci-routes.test.ts`, `context-bundle-exclusion.test.ts`; edited `server/test/mocks*.test.ts` if one asserts the mock's shape | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` |
| server integration — **in scope** | new `server/test/ci-export.it.test.ts`, `server/test/ci-ingest.it.test.ts` | `cd server && pnpm exec vitest run .it.test` |
| agent-runner (new suite) | `agent-runner/test/{inputs,github,review,artifact,exit-code,index}.test.ts`; stubbed `globalThis.fetch` and a stub `LLMProvider`, no DB, so **no `*.it.test.ts`** | `cd agent-runner && npm test` |
| client | colocated `CITab.test.tsx`, `ExportWizard.test.tsx`, `CiRunsPage.test.tsx` | `cd client && pnpm test` |
| reviewer-core | unchanged; run it once because the runner bundles it | `cd reviewer-core && npm test` |
| e2e | **not in scope** — no flow added or edited | — |

Two testing notes that cost time when skipped:

- **A dialog whose open state is the URL needs a navigation mock that re-renders**
  (`client/INSIGHTS.md:278`). If the wizard's step or the CI tab's selection ever lands in the URL,
  the usual `useSearchParams: () => new URLSearchParams("…")` mock cannot test a click. The wizard
  here keeps its state in a reducer, so this bites only if that changes.
- **Prove a new test fails before leaving it green** (`CLAUDE.md`). Two extra turns; it is what
  catches a `vi.mock` that stopped intercepting and an assertion that was vacuous all along.

## Gates

Track A, copied verbatim from `.claude/skills/pr-self-review/gates.md`:

```sh
cd server && pnpm arch
cd server && pnpm typecheck
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'
cd client && pnpm lint
cd client && pnpm typecheck
cd client && pnpm test
cd reviewer-core && npm run typecheck
cd reviewer-core && npm test
diff -r server/src/vendor/shared client/src/vendor/shared
bash scripts/pr-self-review/registry.sh
```

Four more, because Track A cannot see this change (`INSIGHTS.md:595-618`;
`scripts/pr-self-review/scope.sh:209-213`):

```sh
cd client && pnpm build                    # a new page changes what is imported at runtime
cd agent-runner && npm run typecheck       # agent-runner/* maps to no Track A package
cd agent-runner && npm test
cd agent-runner && npm run build           # must print a size under 1.5 MiB
cd server && pnpm exec vitest run .it.test # integration is in scope for this plan
```

## Risks (from INSIGHTS.md)

| Risk, quoted | What this plan does |
|---|---|
| "`@devdigest/shared` is vendored twice … Type-checking cannot detect the drift: each package compiles happily against its own copy, so nothing fails until runtime" — `INSIGHTS.md:1644` | P1 owns **both** copies and mirrors them in one step (P1.7); `diff -r` is a gate; no other package may write `vendor/shared` |
| "The gate list at the bottom of the brief did not include `cd client && pnpm build`, so the implementer never ran it … a single page load found what eleven green gates and three review agents did not" — `INSIGHTS.md:595` | `pnpm build` and the four agent-runner commands are in `## Gates`, and `## Verification` ends in a real end-to-end run rather than a gate list |
| "Truncate untrusted text BEFORE `wrapUntrusted`, never after … a prompt whose last delimiter is missing hands everything after it to attacker-controlled text" — `server/INSIGHTS.md:901` | P2.5 states the order explicitly for both the PR fields and each memory item, and the test counts fences |
| "A contract field with `.default()` makes a MISSING WRITE invisible, not just a missing read" — `server/INSIGHTS.md:782` | Every new `CiResultArtifact` field is `.nullish()` (P1.1); AC-118 depends on the absence being visible. The same reasoning one step further is why `status` is `z.string()` and not a closed enum: the artifact is written by whatever bundle version sits in the target repo, so a value the server has not heard of is a compatibility event to log, not a parse error to reject (P1.1, P3.5, P3.6 — R76/AC-132) |
| "`parseUnifiedDiff` counts the trailing empty line of a body as a covered context line" — `server/INSIGHTS.md:1085` | P2.4 reuses that exact parser rather than writing a second one, so the runner's grounding behaves identically to the studio's; the fixture rule (end at the `@@` header with no trailing newline) applies to the runner's tests too |
| "`.devdigest` is appended to the scan roots AFTER the defaults branch, never before … silently deletes `specs`, `docs` and `insights`" — `server/INSIGHTS.md:1207` | P4.2 changes the walk, not `settings.ts:90`, and says so |
| "A length cap applied to a string that will be EXECUTED has to reject it, not truncate it" — `server/INSIGHTS.md:503` | P3.4 refuses an unparseable workflow YAML with the failing line and commits nothing (AC-55); it never repairs it |
| "`.trim()` does not make a URL scheme test safe — a control character survives it" — `client/INSIGHTS.md:605` | P5.4's job link comes from run metadata, but AC-77 makes it text like everything else; reuse `isSafeUrl`'s `\p{Cc}` strip rather than restating the rule |
| "A frozen dependency-cruiser edge silences that edge entirely, not one violation" — `server/INSIGHTS.md:112` | No step baselines anything. A new `pnpm arch` violation means the file is in the wrong ring |
| "A service the container constructs must not import `Container`" — `server/INSIGHTS.md:916` | `CiService` is constructed in `routes.ts`, not by the container, so it may hold `Container` — but the `RunnerBundle` port is reached through it, never constructed inside it |

## Alternatives rejected

- **A push endpoint the CI job calls** — rejected by the spec itself (D1, N2): the server is
  `localhost` and `LocalNoAuthProvider` authenticates nobody. Named here so the debate does not
  reopen at P3.5.
- **A second copy of `parseUnifiedDiff` inside `agent-runner`.** Rejected: two parsers feeding one
  grounding gate drift, and the drift is invisible (the studio and CI would ground different line
  sets from the same PR). The runner aliases the server's pure, type-only-importing parser
  instead. Moving it into `reviewer-core` is the better home and is `## Recommendations` R-1, not a
  step, because the spec fixes `reviewer-core` as unchanged.
- **Wrapping memory items inside `reviewer-core/src/prompt.ts`.** Rejected for the same reason,
  and recorded as R-2. The spec's `## Edge cases` row for `memory.jsonl` puts the wrapping in the
  runner explicitly, and AC-98 binds only the runner.
- **Committing `agent-runner/dist/runner.mjs` to the repository** so the server always has one to
  serve. Rejected: ~700 KB of minified JS that changes on every rebuild, in a repo whose review
  tooling reads diffs. The bundle is built by `scripts/dev.sh` and by `npm run build`, and a
  missing bundle is a `ConfigError` naming the command (P3.2).
- **Building the zip in the browser from the already-fetched `CiFile[]`.** Rejected: it would put
  a second archive writer in a second package, and `fflate` is already a `server/` dependency with
  a hardened precedent beside it (`modules/skills/import.ts`). One generator, one archive.
- **Storing the chosen triggers and `post_as` on `ci_installations`** so `Update CI config` could
  republish silently. Rejected: no criterion asks for the storage, and G6 wants the user to see
  every generated file before an install. `Update CI config` therefore opens the wizard with the
  installation's repo preselected and the user still passes Preview and Configure.
- **Widening `ci_fail_on` or narrowing the CI tab to match it.** Rejected by D12: the column keeps
  four values, the tab shows three, and AC-102 covers the stored `any`.
- **Polling on a `refetchInterval`** because the page already has an `autoRefresh` string.
  Rejected outright by AC-122 and N10; the string stays unused.

## Verification

Observable, in order. The last two need a running stack and a real repository — a gate cannot
stand in for them.

1. `cd agent-runner && npm run build` prints a size under 1.5 MiB, and
   `head -2 dist/runner.mjs` shows the version, a 40-character SHA and "generated — do not edit". **R9, R28**
2. `node --version` on 20 and on 22, then `node dist/runner.mjs` in a directory with no
   `node_modules` and no manifest: exits non-zero naming the missing manifest, makes no model call. **R28, R29**
3. `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — the generator suite proves the
   file list, the slug rule, the derived count, the empty `memory.jsonl` and the absence of any
   secret value in the bundle. **R6, R7, R10, R16, R38**
4. A generated workflow, printed by a test: `grep -c 'pull_request_target'` is 0, every `uses:`
   line matches `@[0-9a-f]{40}`, no `run:` line contains `${{`, `permissions` has exactly the two
   (or one) keys, and `concurrency.cancel-in-progress` is true. **R15, R22, R23, R25**
5. `cd server && pnpm exec vitest run .it.test` — two Installs in a row leave one
   `ci_installations` row and one PR; two refreshes in a row leave one `ci_runs` row and the second
   one's values won; a refresh within 5 minutes makes zero Actions calls.
   **R17, R18, R47, R57, R73**
6. Against the same integration database, three things a unit test cannot show:
   `psql -c "\d ci_runs"` names one unique index over `(repo, workflow_run_id)` and no
   `NULLS NOT DISTINCT`; two rows inserted with both columns empty coexist; and inserting a second
   row with a `(repo, workflow_run_id)` already present raises `23505` from Postgres rather than
   being caught in the service. **R71, R73, R74**
7. In `ci-ingest` tests: a `skipped` artifact produces a row whose status reads `skipped`; an
   artifact carrying `status: 'cancelled'` produces a row whose status is null and a log line
   naming `cancelled`, and the `ci_runs` count went **up** by one, not stayed flat; one
   installation whose poll rejected keeps its previous `last_polled_at` while a sibling that
   succeeded is stamped. **R72, R75, R76**
8. `cd server && pnpm exec vitest run test/context-bundle-exclusion.test.ts` — a scan over a tree
   holding `.devdigest/skills/x.md` and `.devdigest/specs/z.md` persists only the second. **R70**
9. `diff -r server/src/vendor/shared client/src/vendor/shared` prints nothing, and both copies of
   `CiRunStatus` list the same five values. **R65, R72**
10. `cd client && pnpm build` succeeds, then with the API running: open `/agents/<id>?tab=ci` —
    the CI tab is the fourth tab, the empty state reads "Not in CI yet". Compare the rendered tab
    and all four wizard steps against `specs/assets/SPEC-05-export-to-ci-*.png` element by element
    and report every difference. **R1, R2, R3, R4, R8, R11, R12, R13, R16, R58, R59, R60, R61**
11. `/ci-runs` is reachable from the sidebar and shows the empty state with no invented row; the
    last-poll timestamp is present; opening it a second time within 5 minutes makes no network call
    (watch the Network panel), and it still makes none after the API process is restarted — the
    window is in the database, not in memory. **R50, R54, R56, R57, R75**
12. **End to end, through the real entry point.** Against a scratch GitHub repository the token can
    write to: run the wizard to `Install`, confirm one commit on `devdigest/ci` and one PR titled
    "Add DevDigest CI review"; add `OPENROUTER_API_KEY` to that repo's Actions secrets; merge;
    open a PR with a small diff; confirm the job runs, publishes a review, uploads
    `devdigest-result` and exits with the code `Fail CI on` predicts; then press Refresh on
    `/ci-runs` and confirm one row with repository, PR, agent, verdict, findings, cost, duration
    and a working job link, plus one `agent_runs` row with `source='ci'`. Repeat once from a fork
    to confirm the green check, the job-summary line and the `skipped` row.
    **R17, R21, R24, R26, R30, R32, R34, R35, R41, R43, R46, R47, R49, R51, R52, R53, R72, R76**

## Open questions

_None._
