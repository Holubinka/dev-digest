# PR Self-Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review every open local change against this repo's own skills and gates, and refuse `git push` / `gh pr create` while a critical finding stands.

**Architecture:** Five small shell scripts, each a pure function over the working tree that prints JSON and exits 0, plus a skill that orchestrates them and adds the model half. `scope.sh` classifies the diff, `gates.sh` runs the deterministic checks, `baseline.sh` filters out what is not yours, `report.sh` renders and writes `.pr-self-review/latest.json`, and `gate.sh` — the only script wired as a hook — reads that verdict and blocks. The hook never reviews: a Claude Code hook is a shell command and cannot call a model.

**Tech Stack:** Bash (portable to macOS BSD userland), `jq` 1.7, `git`, the repo's existing `pnpm`/`npm` scripts. No new dependency.

Spec: [`specs/03-pr-self-review-skill.md`](../../../specs/03-pr-self-review-skill.md).

## Global Constraints

- **Every committed file is English.** No Cyrillic anywhere in the tree.
- **Scripts print findings and exit 0.** Interpretation belongs to the caller. Only `gate.sh` exits non-zero, and only `2`.
- **A finding object is** `{severity, source, file, line, message, fix}` with `severity` one of `critical|major|minor|note`. Track B may add `verifier`. This shape is already set by `registry.sh` and must not change.
- **Portable Bash only.** macOS `xargs` has no `-r`, `sed -i` needs an argument, `readarray` is absent in Bash 3.2. Use `while IFS= read -r` loops.
- **`set -euo pipefail` in scripts, `set -uo pipefail` in tests** — a failing assertion must not abort a test file.
- **Every script gets a `*.test.sh` beside it**, discovered automatically by `scripts/pr-self-review/test/run.sh`.
- **This skill copies no rules** from other skills. It routes and enforces; `routing.md` holds pointers, never restated rules.
- **Divergence from the spec, recorded deliberately:** the spec names the hook `scripts/pr-self-review-gate.sh`. Task 1 already established `scripts/pr-self-review/`, so the hook is `scripts/pr-self-review/gate.sh`. Everything lives in one directory.

---

## File Structure

```
scripts/pr-self-review/
  registry.sh        DONE — skills-registry consistency, JSON findings
  scope.sh           classifies the diff: routed / checklist / skipped / flagged
  gates.sh           runs Track A for the packages in scope
  baseline.sh        drops frozen findings, demotes findings off the diff lines
  report.sh          renders the report, writes latest.json and report.md
  gate.sh            the PreToolUse hook — reads the verdict, never reviews
  test/
    lib.sh           DONE — assertions and make_repo
    run.sh           DONE — discovers *.test.sh
    registry.test.sh DONE
    scope.test.sh · gates.test.sh · baseline.test.sh · report.test.sh · gate.test.sh
.claude/skills/pr-self-review/
  SKILL.md · gates.md · routing.md · severity.md · README.md
.claude/commands/pr-self-review.md
.claude/settings.json
.github/workflows/pr-self-review.yml
```

Each script reads JSON on stdin or from a path argument and writes JSON to stdout, so any stage can be tested in isolation with a hand-written fixture.

---

## Task 1: Test harness and the registry gate — ALREADY DONE

Delivered in commit `8feba32`. `scripts/pr-self-review/test/{run.sh,lib.sh}`, `registry.sh`, and `registry.test.sh` with 7 passing assertions. Verify before starting Task 2:

```bash
bash scripts/pr-self-review/test/run.sh
```
Expected: `all pr-self-review script tests passed`.

**Produces** (relied on by every later task):
- `make_repo` — prints the path to a throwaway git repo with one commit on `main`.
- `assert_eq actual expected label`, `assert_contains haystack needle label`, `assert_json json jq_filter expected label`, `finish`.
- The finding shape, emitted as a JSON array.

---

## Task 2: `scope.sh` — classify the diff

**Files:**
- Create: `scripts/pr-self-review/scope.sh`
- Test: `scripts/pr-self-review/test/scope.test.sh`

**Interfaces:**
- Consumes: `make_repo`, `assert_json`, `finish` from `test/lib.sh`.
- Produces: a JSON object on stdout —
  ```jsonc
  {
    "branch": "feat/x", "base": "<merge-base sha>", "head": "<sha>",
    "worktreeHash": "<sha256>", "packages": ["client","server"],
    "routed":    [ { "path": "client/src/a.tsx", "domains": ["frontend","security"], "lines": [12,40] } ],
    "checklist": [ "scripts/foo.sh" ],
    "skipped":   [ { "path": "client/pnpm-lock.yaml", "reason": "lockfile" } ],
    "flagged":   [ { "severity": "critical", "source": "gate scope", "file": ".env", "line": 1, "message": "...", "fix": "..." } ]
  }
  ```
  `flagged` entries are already finding-shaped so they merge straight into the findings array. `domains` values are exactly `frontend`, `frontend-tests`, `backend`, `data`, `contracts`, `core`, `security`.

- [ ] **Step 1: Write the failing test**

Create `scripts/pr-self-review/test/scope.test.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
. "$HERE/lib.sh"
SCOPE="$HERE/../scope.sh"

# --- a changed client component routes to frontend, and to security ------------
repo="$(make_repo)"
git -C "$repo" checkout -qb feat/x
mkdir -p "$repo/client/src/app"
printf 'export const A = 1\n' >"$repo/client/src/app/a.tsx"
git -C "$repo" add -A && git -C "$repo" commit -qm "add a"

out="$(cd "$repo" && bash "$SCOPE")"
assert_json "$out" '.routed | length' '1' 'one routed file'
assert_json "$out" '.routed[0].path' 'client/src/app/a.tsx' 'the component is routed'
assert_json "$out" '[.routed[0].domains[] | select(. == "frontend")] | length' '1' \
  'a client component goes to the frontend agent'
assert_json "$out" '[.routed[0].domains[] | select(. == "security")] | length' '1' \
  'security is cross-cutting and sees every routed file'
assert_json "$out" '.packages | index("client") != null' 'true' 'client is in packages'
assert_json "$out" '.branch' 'feat/x' 'the branch is reported'
rm -rf "$repo"

# --- a lockfile is skipped, never routed ---------------------------------------
repo="$(make_repo)"
git -C "$repo" checkout -qb feat/x
mkdir -p "$repo/client"
printf 'lockfileVersion: 9\n' >"$repo/client/pnpm-lock.yaml"
git -C "$repo" add -A && git -C "$repo" commit -qm "lock"

out="$(cd "$repo" && bash "$SCOPE")"
assert_json "$out" '.routed | length' '0' 'the lockfile is not routed'
assert_json "$out" '[.skipped[] | select(.path == "client/pnpm-lock.yaml")] | length' '1' \
  'the lockfile is reported as skipped'
assert_json "$out" '[.skipped[] | select(.path == "client/pnpm-lock.yaml")][0].reason' \
  'lockfile' 'the skip reason is named'
rm -rf "$repo"

# --- a committed .env is a critical flag, and its contents are never read -------
repo="$(make_repo)"
git -C "$repo" checkout -qb feat/x
printf 'OPENAI_API_KEY=sk-real\n' >"$repo/.env"
git -C "$repo" add -f .env && git -C "$repo" commit -qm "env"

out="$(cd "$repo" && bash "$SCOPE")"
assert_json "$out" '[.flagged[] | select(.file == ".env")] | length' '1' 'the .env is flagged'
assert_json "$out" '[.flagged[] | select(.file == ".env")][0].severity' 'critical' \
  'a committed .env is critical'
assert_json "$out" '.routed | length' '0' 'a flagged file is never routed'
rm -rf "$repo"

# --- .env.example is ordinary, and lands on the checklist -----------------------
repo="$(make_repo)"
git -C "$repo" checkout -qb feat/x
printf 'OPENAI_API_KEY=\n' >"$repo/.env.example"
git -C "$repo" add -A && git -C "$repo" commit -qm "example"

out="$(cd "$repo" && bash "$SCOPE")"
assert_json "$out" '.flagged | length' '0' '.env.example is not a secret'
assert_json "$out" '[.checklist[] | select(. == ".env.example")] | length' '1' \
  '.env.example is checklist-only'
rm -rf "$repo"

# --- an uncommitted edit is in scope, and moves the worktree hash ---------------
repo="$(make_repo)"
git -C "$repo" checkout -qb feat/x
mkdir -p "$repo/server/src/modules/pulls"
printf 'export const s = 1\n' >"$repo/server/src/modules/pulls/service.ts"
git -C "$repo" add -A && git -C "$repo" commit -qm "service"
before="$(cd "$repo" && bash "$SCOPE" | jq -r '.worktreeHash')"
printf 'export const s = 2\n' >"$repo/server/src/modules/pulls/service.ts"

out="$(cd "$repo" && bash "$SCOPE")"
assert_json "$out" '[.routed[] | select(.path | endswith("service.ts"))][0].domains[0]' \
  'backend' 'a service file goes to the backend agent'
after="$(printf '%s' "$out" | jq -r '.worktreeHash')"
if [ "$before" != "$after" ]; then
  assert_eq ok ok 'an uncommitted edit changes the worktree hash'
else
  assert_eq "$after" "different from $before" 'an uncommitted edit changes the worktree hash'
fi
rm -rf "$repo"

# --- changed lines are recorded, so findings can be anchored to them ------------
repo="$(make_repo)"
git -C "$repo" checkout -qb feat/x
mkdir -p "$repo/client/src"
printf 'a\nb\nc\nd\n' >"$repo/client/src/x.ts"
git -C "$repo" add -A && git -C "$repo" commit -qm "x"
printf 'a\nb\nCHANGED\nd\n' >"$repo/client/src/x.ts"

out="$(cd "$repo" && bash "$SCOPE")"
assert_json "$out" '[.routed[] | select(.path == "client/src/x.ts")][0].lines | index(3) != null' \
  'true' 'the edited line is recorded'
assert_json "$out" '[.routed[] | select(.path == "client/src/x.ts")][0].lines | index(1)' \
  'null' 'an untouched line is not recorded'
rm -rf "$repo"

finish
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash scripts/pr-self-review/test/scope.test.sh`
Expected: FAIL — every assertion errors because `scope.sh` does not exist.

- [ ] **Step 3: Write the implementation**

Create `scripts/pr-self-review/scope.sh`:

```bash
#!/usr/bin/env bash
#
# Classifies everything the branch changed. Pure function over the working
# tree: no model, no network, always exits 0.
#
#   routed     reviewed by a subagent, with the domains that must see it
#   checklist  read, but no skill applies
#   skipped    never read; the reason is always reported
#   flagged    the change itself is the finding; contents are not reviewed
#
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

MAIN="${PR_SELF_REVIEW_BASE:-main}"
branch="$(git rev-parse --abbrev-ref HEAD)"
head="$(git rev-parse HEAD)"
base="$(git merge-base "$MAIN" HEAD 2>/dev/null || git rev-list --max-parents=0 HEAD | tail -1)"

worktree_hash() {
  {
    git diff "$head"
    git ls-files --others --exclude-standard | while IFS= read -r f; do
      printf '%s\n' "$f"
      cat "$f" 2>/dev/null
    done
  } | shasum -a 256 | cut -d' ' -f1
}

# --- every path the branch touches, committed or not --------------------------
paths="$(
  {
    git diff --name-only "$base"
    git ls-files --others --exclude-standard
  } | sort -u
)"

skip_reason() { # path -> reason, or empty when the file is read
  case "$1" in
    */node_modules/*|node_modules/*)            printf 'dependency' ;;
    */dist/*|dist/*|*/.next/*|.next/*)          printf 'build output' ;;
    */coverage/*|coverage/*)                    printf 'coverage output' ;;
    *pnpm-lock.yaml|*package-lock.json)         printf 'lockfile' ;;
    .screenshots/*)                             printf 'screenshot' ;;
    server/clones/*)                            printf 'runtime data' ;;
    server/drizzle/meta/*)                      printf 'generated' ;;
    *.snap)                                     printf 'snapshot' ;;
    *.png|*.jpg|*.jpeg|*.svg|*.webp|*.ico|*.pdf|*.woff|*.woff2) printf 'binary' ;;
    *)                                          printf '' ;;
  esac
}

flag_for() { # path -> "severity<TAB>message<TAB>fix", or empty
  local p="$1"
  case "$p" in
    .env|*/.env|*.env)
      [ "${p%.example}" = "$p" ] || return 0
      printf 'critical\ta committed .env can only be a secret\tgit rm --cached %s and move the value into ~/.devdigest/secrets.json' "$p" ;;
    *.key|*.pem)
      printf 'critical\t%s is a private key\tgit rm --cached %s\n' "$p" "$p" ;;
    server/src/vendor/*|client/src/vendor/*)
      printf 'major\t%s is a vendored copy — both copies must move together\tdiff -r server/src/vendor/shared client/src/vendor/shared' "$p" ;;
    e2e/specs/*.flow.json)
      printf 'major\t%s is a live browser scenario, not documentation\tconfirm the change was deliberate' "$p" ;;
    .claude/skills/*)
      local name="${p#.claude/skills/}"; name="${name%%/*}"
      if [ -f skills-lock.json ] && jq -e --arg n "$name" '.skills | has($n)' skills-lock.json >/dev/null 2>&1; then
        printf 'critical\t%s is pinned upstream in skills-lock.json\trevert it, or drop the lock entry if we now own the skill' "$p"
      fi ;;
  esac
}

domains_for() { # path -> space-separated domains, or empty for checklist-only
  local p="$1" d=""
  case "$p" in
    client/**/*.test.ts|client/**/*.test.tsx|client/*/*.test.ts|client/*/*.test.tsx) d="frontend-tests" ;;
  esac
  [ -n "$d" ] || case "$p" in
    client/src/*.ts|client/src/*.tsx|client/src/**)
      case "$p" in *.ts|*.tsx) d="frontend" ;; esac ;;
  esac
  [ -n "$d" ] || case "$p" in
    server/src/modules/*|server/src/adapters/*|server/src/platform/*) d="backend" ;;
    server/src/db/*|*/schema.ts|server/drizzle/*.sql)               d="data" ;;
    reviewer-core/src/*)                                            d="core" ;;
    */contracts/*|*.schema.ts)                                      d="contracts" ;;
  esac
  [ -n "$d" ] && printf '%s security' "$d"
}

changed_lines() { # path -> JSON array of line numbers touched on this branch
  if git ls-files --error-unmatch "$1" >/dev/null 2>&1; then
    git diff -U0 --no-color "$base" -- "$1" |
      awk '/^@@/ {
             match($0, /\+[0-9]+(,[0-9]+)?/);
             spec = substr($0, RSTART + 1, RLENGTH - 1);
             split(spec, p, ",");
             count = (p[2] == "" ? 1 : p[2]);
             for (i = 0; i < count; i++) print p[1] + i
           }' | jq -R . | jq -s 'map(tonumber)'
  else
    awk 'END { for (i = 1; i <= NR; i++) print i }' "$1" | jq -R . | jq -s 'map(tonumber)'
  fi
}

routed="[]"; checklist="[]"; skipped="[]"; flagged="[]"; packages="[]"

while IFS= read -r path; do
  [ -n "$path" ] || continue

  reason="$(skip_reason "$path")"
  if [ -n "$reason" ]; then
    skipped="$(printf '%s' "$skipped" | jq --arg p "$path" --arg r "$reason" \
      '. + [{path:$p, reason:$r}]')"
    continue
  fi

  flag="$(flag_for "$path")"
  if [ -n "$flag" ]; then
    sev="$(printf '%s' "$flag" | cut -f1)"
    msg="$(printf '%s' "$flag" | cut -f2)"
    fix="$(printf '%s' "$flag" | cut -f3)"
    flagged="$(printf '%s' "$flagged" | jq \
      --arg s "$sev" --arg f "$path" --arg m "$msg" --arg x "$fix" \
      '. + [{severity:$s, source:"gate scope", file:$f, line:1, message:$m, fix:$x}]')"
    continue
  fi

  case "$path" in
    client/*)        packages="$(printf '%s' "$packages" | jq '. + ["client"]')" ;;
    server/*)        packages="$(printf '%s' "$packages" | jq '. + ["server"]')" ;;
    reviewer-core/*) packages="$(printf '%s' "$packages" | jq '. + ["reviewer-core"]')" ;;
  esac

  doms="$(domains_for "$path")"
  if [ -z "$doms" ]; then
    checklist="$(printf '%s' "$checklist" | jq --arg p "$path" '. + [$p]')"
    continue
  fi

  lines="$(changed_lines "$path")"
  routed="$(printf '%s' "$routed" | jq \
    --arg p "$path" --argjson l "$lines" --arg d "$doms" \
    '. + [{path:$p, domains:($d | split(" ")), lines:$l}]')"
done <<EOF
$paths
EOF

jq -n \
  --arg branch "$branch" --arg base "$base" --arg head "$head" \
  --arg hash "$(worktree_hash)" \
  --argjson routed "$routed" --argjson checklist "$checklist" \
  --argjson skipped "$skipped" --argjson flagged "$flagged" \
  --argjson packages "$packages" \
  '{branch:$branch, base:$base, head:$head, worktreeHash:$hash,
    packages:($packages | unique), routed:$routed, checklist:$checklist,
    skipped:$skipped, flagged:$flagged}'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/pr-self-review/test/scope.test.sh`
Expected: PASS — the last line reads `0 failed`. If a glob misfires, fix `domains_for`, not the test.

- [ ] **Step 5: Run the whole suite and commit**

```bash
bash scripts/pr-self-review/test/run.sh
git add scripts/pr-self-review/scope.sh scripts/pr-self-review/test/scope.test.sh
git commit -m "feat(pr-self-review): classify the branch diff into routed, checklist, skipped and flagged"
```

---

## Task 3: `gates.sh` — run Track A

**Files:**
- Create: `scripts/pr-self-review/gates.sh`
- Test: `scripts/pr-self-review/test/gates.test.sh`

**Interfaces:**
- Consumes: the scope object from Task 2 on stdin — reads `.packages` and nothing else.
- Produces:
  ```jsonc
  { "gates":    [ { "package": "server", "name": "arch", "status": "ok|fail|skip", "detail": "baseline 20 -> 20" } ],
    "findings": [ /* finding objects, source "gate <name>", line 0 for whole-package failures */ ] }
  ```
  `line: 0` marks a finding that belongs to no single line; Task 4 must never demote those.

- [ ] **Step 1: Write the failing test**

Create `scripts/pr-self-review/test/gates.test.sh`. The test drives `gates.sh` through `PR_SELF_REVIEW_RUNNER`, an indirection that exists so the suite never shells out to a real `pnpm`:

```bash
#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
. "$HERE/lib.sh"
GATES="$HERE/../gates.sh"

# A fake runner: exits 1 for anything named in FAIL_LIST, 0 otherwise.
runner="$(mktemp)"
cat >"$runner" <<'RUNNER'
#!/usr/bin/env bash
# args: <package> <gate-name>
case " ${FAIL_LIST:-} " in
  *" $2 "*) printf 'boom: %s failed\n' "$2"; exit 1 ;;
esac
printf 'ok\n'; exit 0
RUNNER
chmod +x "$runner"

scope_json() { jq -n --argjson p "$1" '{packages:$p, routed:[], checklist:[], skipped:[], flagged:[]}'; }

# --- only the packages in scope are gated --------------------------------------
out="$(printf '%s' "$(scope_json '["client"]')" | PR_SELF_REVIEW_RUNNER="$runner" bash "$GATES")"
assert_json "$out" '[.gates[] | select(.package == "server" and .status != "skip")] | length' '0' \
  'server gates do not run for a client-only diff'
assert_json "$out" '[.gates[] | select(.package == "server")][0].status' 'skip' \
  'a skipped gate is still reported'
assert_json "$out" '[.gates[] | select(.package == "client" and .name == "lint")][0].status' 'ok' \
  'the client lint gate runs'

# --- the registry gate always runs, package or not -----------------------------
assert_json "$out" '[.gates[] | select(.name == "registry")] | length' '1' \
  'the registry gate is not package-scoped'

# --- a failing gate produces exactly one critical, anchored to no line ----------
out="$(printf '%s' "$(scope_json '["client"]')" |
  FAIL_LIST="lint" PR_SELF_REVIEW_RUNNER="$runner" bash "$GATES")"
assert_json "$out" '[.gates[] | select(.name == "lint")][0].status' 'fail' 'lint reports fail'
assert_json "$out" '[.findings[] | select(.source == "gate lint")] | length' '1' \
  'a failing gate yields one finding'
assert_json "$out" '[.findings[] | select(.source == "gate lint")][0].severity' 'critical' \
  'a Track A failure is critical by definition'
assert_json "$out" '[.findings[] | select(.source == "gate lint")][0].line' '0' \
  'a whole-package failure is anchored to no line'
assert_contains "$(printf '%s' "$out" | jq -r '[.findings[] | select(.source == "gate lint")][0].fix')" \
  'pnpm lint' 'the finding carries the command that reproduces it'

# --- integration tests are never a gate ----------------------------------------
out="$(printf '%s' "$(scope_json '["server"]')" | PR_SELF_REVIEW_RUNNER="$runner" bash "$GATES")"
assert_json "$out" '[.gates[] | select(.name | test("it.test|integration"))] | length' '0' \
  'integration tests stay in CI'

# --- gates.sh exits 0 even when a gate fails -----------------------------------
printf '%s' "$(scope_json '["client"]')" |
  FAIL_LIST="lint typecheck" PR_SELF_REVIEW_RUNNER="$runner" bash "$GATES" >/dev/null
assert_eq "$?" '0' 'gates.sh leaves the verdict to the caller'

rm -f "$runner"
finish
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash scripts/pr-self-review/test/gates.test.sh`
Expected: FAIL — `gates.sh` does not exist.

- [ ] **Step 3: Write the implementation**

Create `scripts/pr-self-review/gates.sh`:

```bash
#!/usr/bin/env bash
#
# Track A. Deterministic checks only — no model. Reads the scope object on
# stdin, runs one gate per row below for the packages actually in the diff,
# and prints {gates, findings}. Always exits 0.
#
# Integration tests (*.it.test.ts) are deliberately absent: they need
# testcontainers and cost minutes. CI owns them.
#
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

scope="$(cat)"
in_scope() { printf '%s' "$scope" | jq -e --arg p "$1" '.packages | index($p) != null' >/dev/null; }

# package<TAB>name<TAB>command
GATES="$(cat <<'ROWS'
server	arch	cd server && pnpm arch
server	typecheck	cd server && pnpm typecheck
server	test	cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'
client	lint	cd client && pnpm lint
client	typecheck	cd client && pnpm typecheck
client	test	cd client && pnpm test
reviewer-core	typecheck	cd reviewer-core && npm run typecheck
reviewer-core	test	cd reviewer-core && npm test
repo	vendor	diff -r server/src/vendor/shared client/src/vendor/shared
ROWS
)"

gates="[]"; findings="[]"

record() { # package name status detail
  gates="$(printf '%s' "$gates" | jq \
    --arg p "$1" --arg n "$2" --arg s "$3" --arg d "$4" \
    '. + [{package:$p, name:$n, status:$s, detail:$d}]')"
}

fail() { # package name command output
  findings="$(printf '%s' "$findings" | jq \
    --arg n "$2" --arg f "$1" --arg m "$4" --arg x "$3" \
    '. + [{severity:"critical", source:("gate " + $n), file:$f, line:0,
           message:$m, fix:$x}]')"
}

while IFS=$'\t' read -r pkg name cmd; do
  [ -n "${pkg:-}" ] || continue

  if [ "$pkg" != "repo" ] && ! in_scope "$pkg"; then
    record "$pkg" "$name" skip "not run — no $pkg file in the diff"
    continue
  fi

  if [ -n "${PR_SELF_REVIEW_RUNNER:-}" ]; then
    out="$("$PR_SELF_REVIEW_RUNNER" "$pkg" "$name" 2>&1)"; code=$?
  else
    out="$(bash -c "$cmd" 2>&1)"; code=$?
  fi

  if [ "$code" -eq 0 ]; then
    record "$pkg" "$name" ok ""
  else
    record "$pkg" "$name" fail "exit $code"
    fail "$pkg" "$name" "$cmd" "$(printf '%s' "$out" | tail -20)"
  fi
done <<EOF
$GATES
EOF

# The registry gate is a script, not a package command, and always runs.
registry="$(bash "$ROOT/scripts/pr-self-review/registry.sh")"
reg_critical="$(printf '%s' "$registry" | jq '[.[] | select(.severity == "critical")] | length')"
if [ "$reg_critical" -eq 0 ]; then
  record repo registry ok "lock and directories agree"
else
  record repo registry fail "$reg_critical inconsistent entries"
fi
findings="$(jq -n --argjson a "$findings" --argjson b "$registry" '$a + $b')"

jq -n --argjson g "$gates" --argjson f "$findings" '{gates:$g, findings:$f}'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/pr-self-review/test/gates.test.sh`
Expected: PASS — the last line reads `0 failed`.

- [ ] **Step 5: Run it for real once, then commit**

```bash
bash scripts/pr-self-review/scope.sh | bash scripts/pr-self-review/gates.sh | jq '.gates'
```
Expected: real `ok`/`fail`/`skip` rows for this branch. Then:

```bash
bash scripts/pr-self-review/test/run.sh
git add scripts/pr-self-review/gates.sh scripts/pr-self-review/test/gates.test.sh
git commit -m "feat(pr-self-review): run the deterministic gates for the packages in the diff"
```

---

## Task 4: `baseline.sh` — keep only what is yours

**Files:**
- Create: `scripts/pr-self-review/baseline.sh`
- Test: `scripts/pr-self-review/test/baseline.test.sh`

**Interfaces:**
- Consumes: `{scope, findings}` on stdin; reads `.pr-self-review/baseline.json` when it exists.
- Produces: the surviving findings array on stdout. Two filters, in order:
  1. **Frozen** — a finding whose fingerprint `file:line:message` appears in the baseline is dropped.
  2. **Off-diff** — a finding on a line the branch did not touch is demoted to `note` and marked `"anchored": false`. A finding with `line: 0` is exempt: it belongs to no line by construction.
- `baseline.sh --freeze` reads the same stdin and writes today's findings to `.pr-self-review/baseline.json` instead of filtering.

Without this task the first run against `server/src/modules/pulls/routes.ts` — 420 lines, 16 direct `container.db` calls per spec 02 — emits sixteen criticals and the hook is deleted the same day.

- [ ] **Step 1: Write the failing test**

Create `scripts/pr-self-review/test/baseline.test.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
. "$HERE/lib.sh"
BASELINE="$HERE/../baseline.sh"

input() { # findings-json -> {scope, findings} with one file changed on lines 40,41
  jq -n --argjson f "$1" \
    '{scope: {routed: [{path:"server/src/modules/pulls/routes.ts",
                        domains:["backend"], lines:[40,41]}],
              checklist: [], skipped: [], flagged: []},
      findings: $f}'
}

on_line() { # line severity -> one finding
  jq -n --argjson l "$1" --arg s "$2" \
    '{severity:$s, source:"agent backend", file:"server/src/modules/pulls/routes.ts",
      line:$l, message:("container.db at line " + ($l | tostring)), fix:"move it"}'
}

# --- a finding on a changed line survives at full severity ---------------------
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(input "[$(on_line 40 critical)]")" | bash "$BASELINE")"
assert_json "$out" 'length' '1' 'the finding survives'
assert_json "$out" '.[0].severity' 'critical' 'a finding on a changed line keeps its severity'
rm -rf "$repo"

# --- a finding on an untouched line is demoted, not dropped --------------------
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(input "[$(on_line 300 critical)]")" | bash "$BASELINE")"
assert_json "$out" 'length' '1' 'the pre-existing finding is still visible'
assert_json "$out" '.[0].severity' 'note' 'a finding off the diff cannot block'
assert_json "$out" '.[0].anchored' 'false' 'and it is marked unanchored'
rm -rf "$repo"

# --- a whole-package gate failure is never demoted -----------------------------
repo="$(make_repo)"
gate='{"severity":"critical","source":"gate lint","file":"client","line":0,"message":"2 errors","fix":"pnpm lint"}'
out="$(cd "$repo" && printf '%s' "$(input "[$gate]")" | bash "$BASELINE")"
assert_json "$out" '.[0].severity' 'critical' 'a line-0 finding is exempt from anchoring'
rm -rf "$repo"

# --- --freeze writes the baseline ----------------------------------------------
repo="$(make_repo)"
( cd "$repo" && printf '%s' "$(input "[$(on_line 40 critical)]")" | bash "$BASELINE" --freeze )
assert_eq "$([ -f "$repo/.pr-self-review/baseline.json" ] && printf yes || printf no)" yes \
  '--freeze creates the baseline file'
assert_json "$(cat "$repo/.pr-self-review/baseline.json")" 'length' '1' 'and records the finding'
rm -rf "$repo"

# --- a frozen finding is dropped entirely --------------------------------------
repo="$(make_repo)"
( cd "$repo" && printf '%s' "$(input "[$(on_line 40 critical)]")" | bash "$BASELINE" --freeze )
out="$(cd "$repo" && printf '%s' "$(input "[$(on_line 40 critical)]")" | bash "$BASELINE")"
assert_json "$out" 'length' '0' 'a frozen finding does not come back'
rm -rf "$repo"

# --- a new finding on the same file still reports ------------------------------
repo="$(make_repo)"
( cd "$repo" && printf '%s' "$(input "[$(on_line 40 critical)]")" | bash "$BASELINE" --freeze )
out="$(cd "$repo" && printf '%s' "$(input "[$(on_line 41 critical)]")" | bash "$BASELINE")"
assert_json "$out" 'length' '1' 'freezing one line does not silence its neighbour'
assert_json "$out" '.[0].severity' 'critical' 'and the new one still blocks'
rm -rf "$repo"

finish
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash scripts/pr-self-review/test/baseline.test.sh`
Expected: FAIL — `baseline.sh` does not exist.

- [ ] **Step 3: Write the implementation**

Create `scripts/pr-self-review/baseline.sh`:

```bash
#!/usr/bin/env bash
#
# Keeps only the findings this branch is responsible for.
#
#   frozen    a fingerprint in .pr-self-review/baseline.json is dropped
#   off-diff  a finding on a line the branch did not touch drops to `note`
#             and is marked anchored:false — visible, unable to block
#
# `line: 0` means "belongs to no single line" (a whole-package gate failure)
# and is exempt from anchoring. Always exits 0.
#
#   baseline.sh            filter, print the survivors
#   baseline.sh --freeze   record today's findings as the baseline instead
#
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

STORE=".pr-self-review/baseline.json"
payload="$(cat)"
findings="$(printf '%s' "$payload" | jq '.findings')"

if [ "${1:-}" = "--freeze" ]; then
  mkdir -p "$(dirname "$STORE")"
  printf '%s' "$findings" |
    jq 'map({file, line, message})' >"$STORE"
  printf 'froze %s findings into %s\n' "$(printf '%s' "$findings" | jq length)" "$STORE" >&2
  exit 0
fi

frozen='[]'
[ -f "$STORE" ] && frozen="$(cat "$STORE")"

printf '%s' "$payload" | jq \
  --argjson frozen "$frozen" '
  ( [ .scope.routed[] | { key: .path, value: .lines } ] | from_entries ) as $touched
  | [ .findings[]
      | . as $f
      | select(
          ($frozen | any(.file == $f.file and .line == $f.line and .message == $f.message)) | not
        )
      | if .line == 0 then
          .
        elif ($touched[.file] // []) | index(.line) then
          .
        else
          .severity = "note" | .anchored = false
        end
    ]'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/pr-self-review/test/baseline.test.sh`
Expected: PASS — the last line reads `0 failed`.

- [ ] **Step 5: Commit**

```bash
bash scripts/pr-self-review/test/run.sh
git add scripts/pr-self-review/baseline.sh scripts/pr-self-review/test/baseline.test.sh
git commit -m "feat(pr-self-review): anchor findings to the diff and freeze the pre-existing ones"
```

---

## Task 5: `report.sh` — render the verdict

**Files:**
- Create: `scripts/pr-self-review/report.sh`
- Test: `scripts/pr-self-review/test/report.test.sh`

**Interfaces:**
- Consumes: `{mode, scope, gates, findings, agents}` on stdin. `mode` is `gates` or `full`. `agents` is `[{name, status, files}]` — empty for a `gates` run.
- Produces: writes `.pr-self-review/latest.json` and `.pr-self-review/report.md`, prints the report to stdout, exits 0.
- Verdict: `incomplete` if any agent `status != "ok"`; else `blocked` if any `critical`; else `pass`. `incomplete` blocks, because otherwise breaking a subagent is the cheapest way past the gate.

- [ ] **Step 1: Write the failing test**

Create `scripts/pr-self-review/test/report.test.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
. "$HERE/lib.sh"
REPORT="$HERE/../report.sh"

payload() { # mode findings agents
  jq -n --arg m "$1" --argjson f "$2" --argjson a "$3" \
    '{mode:$m,
      scope: {branch:"feat/x", base:"aaaaaaa", head:"bbbbbbb", worktreeHash:"h",
              packages:["client"], routed:[{path:"client/src/a.tsx",domains:["frontend"],lines:[1]}],
              checklist:[], skipped:[{path:"client/pnpm-lock.yaml",reason:"lockfile"}], flagged:[]},
      gates: [{package:"client", name:"lint", status:"ok", detail:""}],
      findings: $f, agents: $a}'
}

crit='{"severity":"critical","source":"gate lint","file":"client/src/a.tsx","line":1,"message":"bad","fix":"pnpm lint --fix"}'

# --- a clean full run passes ---------------------------------------------------
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(payload full '[]' '[{"name":"frontend","status":"ok","files":1}]')" | bash "$REPORT")"
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'pass' 'no findings means pass'
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.mode' 'full' 'the mode is recorded'
assert_contains "$out" '0 critical' 'zero findings print as zero, not as silence'
assert_contains "$out" 'pnpm-lock.yaml' 'skipped files are always printed'
assert_contains "$out" '/code-review' 'the report says what it does not do'
rm -rf "$repo"

# --- a critical blocks ---------------------------------------------------------
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(payload full "[$crit]" '[{"name":"frontend","status":"ok","files":1}]')" | bash "$REPORT")"
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'blocked' 'a critical blocks'
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.counts.critical' '1' 'the count is recorded'
assert_contains "$out" 'pnpm lint --fix' 'every critical carries its fix line'
rm -rf "$repo"

# --- a crashed subagent forces incomplete, which also blocks -------------------
repo="$(make_repo)"
out="$(cd "$repo" && printf '%s' "$(payload full '[]' '[{"name":"frontend","status":"failed","files":11}]')" | bash "$REPORT")"
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'incomplete' \
  'a failed agent is not a pass'
assert_contains "$out" '11 files unreviewed' 'and the unreviewed files are named'
rm -rf "$repo"

# --- a gates run records its mode, so the PR hook can refuse it ----------------
repo="$(make_repo)"
( cd "$repo" && printf '%s' "$(payload gates '[]' '[]')" | bash "$REPORT" >/dev/null )
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.mode' 'gates' 'a gates run says so'
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.verdict' 'pass' \
  'an empty agent list is not incomplete in gates mode'
rm -rf "$repo"

# --- report.md is written beside the JSON --------------------------------------
repo="$(make_repo)"
( cd "$repo" && printf '%s' "$(payload full "[$crit]" '[]')" | bash "$REPORT" >/dev/null )
assert_eq "$([ -f "$repo/.pr-self-review/report.md" ] && printf yes || printf no)" yes \
  'report.md is written'
rm -rf "$repo"

# --- a recorded bypass surfaces once, then is cleared --------------------------
repo="$(make_repo)"
mkdir -p "$repo/.pr-self-review"
printf '2026-08-02T10:00:00Z git push (verdict blocked)\n' >"$repo/.pr-self-review/bypassed"
out="$(cd "$repo" && printf '%s' "$(payload full '[]' '[]')" | bash "$REPORT")"
assert_contains "$out" 'BYPASSED' 'a bypass is reported on the next run'
assert_json "$(cat "$repo/.pr-self-review/latest.json")" '.bypassed | length' '1' \
  'and recorded in the verdict'
assert_eq "$([ -f "$repo/.pr-self-review/bypassed" ] && printf yes || printf no)" no \
  'the bypass log is consumed, so it is reported exactly once'
rm -rf "$repo"

finish
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash scripts/pr-self-review/test/report.test.sh`
Expected: FAIL — `report.sh` does not exist.

- [ ] **Step 3: Write the implementation**

Create `scripts/pr-self-review/report.sh`:

```bash
#!/usr/bin/env bash
#
# Renders the verdict. Writes .pr-self-review/latest.json for the hook and
# .pr-self-review/report.md for people, prints the short form, exits 0.
#
# Five rules the output obeys:
#   1. no finding without file:line and a source
#   2. every critical carries one concrete Fix: line
#   3. skipped files are always printed — a green report with no skipped
#      list is lying
#   4. a failed subagent is visible and forces `incomplete`, which blocks
#   5. the report states what it does not do: conventions, not correctness
#
# Zero findings print as zero. Inventing one so the run looks worthwhile is
# prohibited; INSIGHTS.md records that reviews here legitimately find nothing.
#
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
OUT=".pr-self-review"
mkdir -p "$OUT"

payload="$(cat)"
mode="$(printf '%s' "$payload" | jq -r '.mode')"

# gate.sh appends one line per bypass; a report consumes and clears them, so a
# bypass is reported exactly once, on the next run after it happened.
bypassed='[]'
[ -f "$OUT/bypassed" ] && bypassed="$(jq -R . "$OUT/bypassed" | jq -s .)"

latest="$(printf '%s' "$payload" | jq \
  --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson bypassed "$bypassed" '
  ( [.findings[] | select(.severity == "critical")] | length ) as $c
  | ( [.agents[]? | select(.status != "ok")] | length ) as $broken
  | {
      mode: .mode,
      verdict: (if $broken > 0 then "incomplete" elif $c > 0 then "blocked" else "pass" end),
      baseSha: .scope.base, headSha: .scope.head, worktreeHash: .scope.worktreeHash,
      branch: .scope.branch, generatedAt: $t,
      counts: {
        critical: $c,
        major: ([.findings[] | select(.severity == "major")] | length),
        minor: ([.findings[] | select(.severity == "minor")] | length),
        note:  ([.findings[] | select(.severity == "note")]  | length)
      },
      findings: .findings, gates: .gates,
      skipped: .scope.skipped, coverage: {agents: (.agents // [])},
      bypassed: $bypassed
    }')"

printf '%s\n' "$latest" >"$OUT/latest.json"
rm -f "$OUT/bypassed"

render() {
  local verdict counts
  verdict="$(printf '%s' "$latest" | jq -r '.verdict | ascii_upcase')"
  counts="$(printf '%s' "$latest" | jq -r \
    '"\(.counts.critical) critical · \(.counts.major) major · \(.counts.minor) minor"')"

  printf 'PR Self-Review — %s        %s\n' "$verdict" "$counts"
  printf '%s\n' "$(printf '%s' "$latest" | jq -r \
    '"base \(.baseSha[0:7]) → HEAD \(.headSha[0:7]) · branch \(.branch) · mode \(.mode)"')"
  printf '\nGATES\n'
  printf '%s' "$payload" | jq -r '.gates[] |
    "  \(if .status == "ok" then "ok  " elif .status == "fail" then "FAIL" else "--  " end)  \(.package)  \(.name)  \(.detail)"'

  for sev in critical major minor note; do
    local n
    n="$(printf '%s' "$payload" | jq --arg s "$sev" '[.findings[] | select(.severity == $s)] | length')"
    [ "$n" -eq 0 ] && continue
    printf '\n%s — %s\n' "$(printf '%s' "$sev" | tr '[:lower:]' '[:upper:]')" "$n"
    printf '%s' "$payload" | jq -r --arg s "$sev" '.findings[] | select(.severity == $s) |
      "  \(.file):\(.line)  [\(.source)]\n     \(.message)" +
      (if .verifier then "\n     Verifier: \(.verifier)" else "" end) +
      (if .fix then "\n     Fix: \(.fix)" else "" end)'
  done

  printf '\nSKIPPED\n'
  printf '%s' "$payload" | jq -r '.scope.skipped[]? | "  \(.path) (\(.reason))"'
  printf '%s' "$payload" | jq -r '.agents[]? | select(.status != "ok") |
    "  \(.name) agent \(.status) — \(.files) files unreviewed"'

  if [ "$(printf '%s' "$latest" | jq '.bypassed | length')" -gt 0 ]; then
    printf '\nBYPASSED SINCE THE LAST REPORT\n'
    printf '%s' "$latest" | jq -r '.bypassed[] | "  " + .'
  fi

  printf '\nThis skill checks conventions, not correctness. For logic bugs run /code-review.\n'
}

render | tee "$OUT/report.md"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/pr-self-review/test/report.test.sh`
Expected: PASS — the last line reads `0 failed`.

- [ ] **Step 5: Run the whole Track A chain end to end, then commit**

```bash
bash scripts/pr-self-review/scope.sh > /tmp/scope.json
jq -s '{scope: .[0], gates: .[1].gates, findings: (.[0].flagged + .[1].findings), mode: "gates", agents: []}' \
  /tmp/scope.json <(bash scripts/pr-self-review/gates.sh < /tmp/scope.json) |
  bash scripts/pr-self-review/report.sh
```
Expected: a real report for this branch, and `.pr-self-review/latest.json` on disk.

```bash
bash scripts/pr-self-review/test/run.sh
git add scripts/pr-self-review/report.sh scripts/pr-self-review/test/report.test.sh
git commit -m "feat(pr-self-review): render the verdict and write latest.json"
```

---

## Task 6: `gate.sh` — the blocking hook

**Files:**
- Create: `scripts/pr-self-review/gate.sh`
- Test: `scripts/pr-self-review/test/gate.test.sh`

**Interfaces:**
- Consumes: the `PreToolUse` hook payload on stdin — `{"tool_name":"Bash","tool_input":{"command":"git push"}}`. Reads `.pr-self-review/latest.json` and recomputes freshness the same way `scope.sh` does.
- Produces: exit `0` (allow) or exit `2` with a message on **stderr**, which is what Claude Code hands back to the model.

| Command | Requires | Blocks when |
|---|---|---|
| `git push` | a fresh run of either mode | missing, stale, or a Track A gate failed |
| `gh pr create`, `gh pr ready` | a fresh run with `mode: "full"` | missing, stale, `mode` is `gates`, or the verdict is not `pass` |

`PR_SELF_REVIEW_SKIP=1` allows the call and the bypass is recorded by `report.sh` on the next run.

- [ ] **Step 1: Write the failing test**

Create `scripts/pr-self-review/test/gate.test.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
. "$HERE/lib.sh"
GATE="$HERE/../gate.sh"

hook() { jq -n --arg c "$1" '{tool_name:"Bash", tool_input:{command:$c}}'; }

write_verdict() { # repo mode verdict [headSha] [worktreeHash]
  local repo="$1" head="${4:-}" hash="${5:-}"
  [ -n "$head" ] || head="$(git -C "$repo" rev-parse HEAD)"
  [ -n "$hash" ] || hash="$(cd "$repo" && bash "$HERE/../scope.sh" | jq -r '.worktreeHash')"
  mkdir -p "$repo/.pr-self-review"
  jq -n --arg m "$2" --arg v "$3" --arg h "$head" --arg w "$hash" \
    '{mode:$m, verdict:$v, headSha:$h, worktreeHash:$w, counts:{critical:0}}' \
    >"$repo/.pr-self-review/latest.json"
}

run() { # repo command -> "exit<TAB>stderr"
  local err out code
  err="$(cd "$2" && printf '%s' "$(hook "$3")" | bash "$GATE" 2>&1 >/dev/null)"; code=$?
  printf '%s\t%s' "$code" "$err"
}

# --- an unrelated command is never touched -------------------------------------
repo="$(make_repo)"; git -C "$repo" checkout -qb feat/x
assert_eq "$(run x "$repo" 'ls -la' | cut -f1)" '0' 'the hook ignores commands it does not guard'
rm -rf "$repo"

# --- no verdict at all blocks the push -----------------------------------------
repo="$(make_repo)"; git -C "$repo" checkout -qb feat/x
res="$(run x "$repo" 'git push origin feat/x')"
assert_eq "$(printf '%s' "$res" | cut -f1)" '2' 'a push with no review is blocked'
assert_contains "$(printf '%s' "$res" | cut -f2)" 'pr-self-review' 'and the model is told what to run'
rm -rf "$repo"

# --- a fresh gates run is enough for a push ------------------------------------
repo="$(make_repo)"; git -C "$repo" checkout -qb feat/x
write_verdict "$repo" gates pass
assert_eq "$(run x "$repo" 'git push' | cut -f1)" '0' 'a fresh gates run lets the push through'
rm -rf "$repo"

# --- but not for a PR ----------------------------------------------------------
repo="$(make_repo)"; git -C "$repo" checkout -qb feat/x
write_verdict "$repo" gates pass
res="$(run x "$repo" 'gh pr create --fill')"
assert_eq "$(printf '%s' "$res" | cut -f1)" '2' 'gh pr create needs a full run'
assert_contains "$(printf '%s' "$res" | cut -f2)" 'full' 'and says which mode is missing'
rm -rf "$repo"

# --- a blocked verdict stops both ----------------------------------------------
repo="$(make_repo)"; git -C "$repo" checkout -qb feat/x
write_verdict "$repo" full blocked
assert_eq "$(run x "$repo" 'gh pr create' | cut -f1)" '2' 'a blocked verdict stops the PR'
rm -rf "$repo"

# --- incomplete blocks, exactly like blocked -----------------------------------
repo="$(make_repo)"; git -C "$repo" checkout -qb feat/x
write_verdict "$repo" full incomplete
assert_eq "$(run x "$repo" 'gh pr create' | cut -f1)" '2' 'incomplete is not a pass'
rm -rf "$repo"

# --- a new commit makes the verdict stale --------------------------------------
repo="$(make_repo)"; git -C "$repo" checkout -qb feat/x
write_verdict "$repo" full pass
printf 'more\n' >"$repo/README.md"
git -C "$repo" add -A && git -C "$repo" commit -qm "later"
res="$(run x "$repo" 'git push')"
assert_eq "$(printf '%s' "$res" | cut -f1)" '2' 'a commit after the review invalidates it'
assert_contains "$(printf '%s' "$res" | cut -f2)" 'stale' 'and the reason is named'
rm -rf "$repo"

# --- an uncommitted edit makes it stale too ------------------------------------
repo="$(make_repo)"; git -C "$repo" checkout -qb feat/x
write_verdict "$repo" full pass
printf 'dirty\n' >>"$repo/README.md"
assert_eq "$(run x "$repo" 'git push' | cut -f1)" '2' 'an uncommitted edit invalidates it'
rm -rf "$repo"

# --- the escape hatch works ----------------------------------------------------
repo="$(make_repo)"; git -C "$repo" checkout -qb feat/x
write_verdict "$repo" full blocked
code="$(cd "$repo" && printf '%s' "$(hook 'git push')" | PR_SELF_REVIEW_SKIP=1 bash "$GATE" >/dev/null 2>&1; printf '%s' $?)"
assert_eq "$code" '0' 'PR_SELF_REVIEW_SKIP lets an urgent push through'
assert_eq "$([ -f "$repo/.pr-self-review/bypassed" ] && printf yes || printf no)" yes \
  'and the bypass is written down rather than passing silently'
assert_contains "$(cat "$repo/.pr-self-review/bypassed")" 'git push' \
  'the record names the command that was let through'
rm -rf "$repo"

finish
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash scripts/pr-self-review/test/gate.test.sh`
Expected: FAIL — `gate.sh` does not exist.

- [ ] **Step 3: Write the implementation**

Create `scripts/pr-self-review/gate.sh`:

```bash
#!/usr/bin/env bash
#
# The PreToolUse hook. Reads a verdict; never produces one — a Claude Code
# hook is a shell command and cannot call a model.
#
# exit 0  allow
# exit 2  block, and hand stderr back to the model
#
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$ROOT"

payload="$(cat)"
command="$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')"

case "$command" in
  *"git push"*)                    guard=push ;;
  *"gh pr create"*|*"gh pr ready"*) guard=pr ;;
  *)                               exit 0 ;;
esac

if [ -n "${PR_SELF_REVIEW_SKIP:-}" ]; then
  # Recorded, not silent. report.sh consumes this file on the next run, so a
  # bypass shows up exactly once, in the next report anyone reads.
  mkdir -p .pr-self-review
  printf '%s %s (verdict %s)\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$command" \
    "$(jq -r '.verdict' .pr-self-review/latest.json 2>/dev/null || printf none)" \
    >>.pr-self-review/bypassed
  exit 0
fi

refuse() {
  printf 'PR Self-Review: %s\n\nRun /pr-self-review%s, fix every critical, then retry.\n' \
    "$1" "$([ "$guard" = pr ] && printf '' || printf ' --gates')" >&2
  exit 2
}

LATEST=".pr-self-review/latest.json"
[ -f "$LATEST" ] || refuse "no review has been run for this branch"

verdict="$(jq -r '.verdict' "$LATEST")"
mode="$(jq -r '.mode' "$LATEST")"
recorded_head="$(jq -r '.headSha' "$LATEST")"
recorded_hash="$(jq -r '.worktreeHash' "$LATEST")"

head="$(git rev-parse HEAD)"
hash="$(bash scripts/pr-self-review/scope.sh | jq -r '.worktreeHash')"

[ "$recorded_head" = "$head" ] || refuse "the verdict is stale — HEAD moved since it was written"
[ "$recorded_hash" = "$hash" ] || refuse "the verdict is stale — the working tree changed since it was written"

if [ "$guard" = pr ] && [ "$mode" != full ]; then
  refuse "the last run was mode \"$mode\"; opening a PR needs a full run"
fi

case "$verdict" in
  pass)  exit 0 ;;
  *)     refuse "the last run ended $verdict" ;;
esac
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/pr-self-review/test/gate.test.sh`
Expected: PASS — the last line reads `0 failed`.

- [ ] **Step 5: Commit**

```bash
bash scripts/pr-self-review/test/run.sh
git add scripts/pr-self-review/gate.sh scripts/pr-self-review/test/gate.test.sh
git commit -m "feat(pr-self-review): block a push or a PR on a stale or failing verdict"
```

---

## Task 7: Wiring — settings, gitignore, slash command

**Files:**
- Create: `.claude/settings.json`, `.claude/commands/pr-self-review.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `gate.sh` from Task 6, and the script chain from Tasks 2–5.
- Produces: `/pr-self-review [--gates|--full|--only critical]`, and a `PreToolUse` hook on `Bash`.

`.claude/settings.json` does not exist in this repo yet. Creating it affects every session, so it holds this hook and nothing else.

- [ ] **Step 1: Ignore the verdict directory**

Add to `.gitignore`:

```
# pr-self-review verdicts — local, per-branch, never shared
.pr-self-review/
```

Keep `.pr-self-review/baseline.json` ignored too: it is per-checkout state, and a shared baseline would be a merge conflict on every branch.

- [ ] **Step 2: Create the hook settings**

Create `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR/scripts/pr-self-review/gate.sh\""
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: Verify the hook is live and does not block ordinary work**

Run: `bash -c 'echo hello'` through the session, then:

```bash
printf '{"tool_name":"Bash","tool_input":{"command":"git push"}}' | bash scripts/pr-self-review/gate.sh; echo "exit $?"
```
Expected: `exit 2` with the refusal on stderr, and ordinary commands unaffected.

- [ ] **Step 4: Write the slash command**

Create `.claude/commands/pr-self-review.md`:

```markdown
---
description: Review every open change against this repo's skills and gates, and write the verdict
---

Run the `pr-self-review` skill over all open changes on this branch.

Arguments: $ARGUMENTS

- no argument, or `--full` — Track A and Track B, writes `mode: "full"`.
  Required before `gh pr create`.
- `--gates` — Track A only, no subagents, seconds. Enough for `git push`.
- `--only critical` — re-check the files that carried a critical last run.
- `--freeze` — record today's findings as the baseline. Use once, deliberately.

Report the verdict, then stop. Do not fix anything unless asked.
```

- [ ] **Step 5: Commit**

```bash
git add .claude/settings.json .claude/commands/pr-self-review.md .gitignore
git commit -m "build(pr-self-review): wire the hook, the slash command and the ignore rule"
```

---

## Task 8: The skill

**Files:**
- Create: `.claude/skills/pr-self-review/{SKILL.md,gates.md,routing.md,severity.md,README.md}`
- Modify: `.claude/skills/README.md` (catalog row)

**Interfaces:**
- Consumes: every script from Tasks 2–6.
- Produces: the Track B half — the procedure that runs the chain, dispatches one subagent per domain, verifies criticals adversarially, and feeds `report.sh`.

`SKILL.md` must stay under 500 lines with references one level deep, `name: pr-self-review` matching the directory, and no top-level `version` in the frontmatter — the registry gate from Task 1 fails the build otherwise. Use `frontend-architecture/` as the reference layout.

- [ ] **Step 1: Write `SKILL.md`**

It carries only what routes the work: the trigger, the procedure below, the severity model, the block rule, and the navigation table. Everything else goes in a topic file.

The procedure, verbatim:

```
1  bash scripts/pr-self-review/scope.sh > $TMP/scope.json
   If .branch is "main", stop and say to branch first.
2  bash scripts/pr-self-review/gates.sh < $TMP/scope.json > $TMP/gates.json
   If any gate failed, skip step 3 — Track A already blocks, and subagents
   would be paid for nothing.
3  One subagent per distinct domain in .routed[].domains, dispatched in
   parallel per superpowers:dispatching-parallel-agents. Each is given only
   its own file list, must read the relevant <module>/INSIGHTS.md first, must
   open the skills named for its domain in routing.md, and must return a JSON
   array of findings — no prose.
4  For every critical a subagent returned, dispatch one adversarial verifier:
   "try to refute this finding; if uncertain, treat it as refuted". Unconfirmed
   findings drop to major.
5  jq -s '{scope:.[0], findings:(...)}' | bash scripts/pr-self-review/baseline.sh
6  Assemble {mode, scope, gates, findings, agents} and pipe it to
   bash scripts/pr-self-review/report.sh
7  Print the report. Stop. Do not fix anything unless asked.
```

The two rules that belong in `SKILL.md` and nowhere else:

- **A repo skill overrules an upstream one.** `drizzle-orm-patterns` will show a query inside a handler; `onion-architecture` §3.2 forbids it. The repo skill wins.
- **An empty report is a valid result.** Zero findings print as zero. Never invent one.

- [ ] **Step 2: Write `routing.md`**

The domain-to-skill table from the spec, plus three to six "what to look for" lines per skill for the ten with no `Review checklist` — each a pointer to a section, never a copied rule. Ends with the deliberately-unused list: the rest of `superpowers`, all of `chrome-devtools-mcp`, `mermaid-diagram`, and `claude-api` (skipped by its own rule, since `reviewer-core` depends on `openai`), so the next editor does not add them back.

- [ ] **Step 3: Write `gates.md` and `severity.md`**

`gates.md`: one section per Track A gate — the command, what a failure looks like, and the first thing to try. `severity.md`: the four levels with the repo's own examples, and the rule that a Track A failure is critical by definition while a subagent critical must survive verification.

- [ ] **Step 4: Write `README.md` and the catalog row**

The skill card: scope, the boundary with `/code-review`, `/security-review` and `superpowers:requesting-code-review`, sources, version, and an empty §"How this was tested" for Task 9 to fill.

Add to the table in `.claude/skills/README.md`:

```markdown
| [pr-self-review](pr-self-review/SKILL.md) | Repo | Review every open change against the repo's skills and gates before a PR; blocks on a critical |
```

- [ ] **Step 5: Verify the registry gate accepts the new skill, then commit**

```bash
bash scripts/pr-self-review/registry.sh | jq '[.[] | select(.file | contains("pr-self-review"))]'
```
Expected: `[]` — no critical, no over-500-line warning.

```bash
git add .claude/skills/pr-self-review .claude/skills/README.md
git commit -m "feat(pr-self-review): add the skill that routes the diff and runs the review"
```

---

## Task 9: CI, acceptance, and the record

**Files:**
- Create: `.github/workflows/pr-self-review.yml`
- Modify: `.claude/skills/pr-self-review/README.md`, `INSIGHTS.md`, `specs/README.md`

- [ ] **Step 1: Add the workflow**

Create `.github/workflows/pr-self-review.yml`, matching the shape of `server-arch.yml`:

```yaml
name: pr-self-review scripts

on:
  push:
    paths: ['scripts/pr-self-review/**', '.github/workflows/pr-self-review.yml']
  pull_request:
    paths: ['scripts/pr-self-review/**', '.github/workflows/pr-self-review.yml']

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - run: bash scripts/pr-self-review/test/run.sh
```

`fetch-depth: 0` is required — `scope.sh` needs a real merge-base with `main`.

- [ ] **Step 2: Run the acceptance checks from the spec**

Each is a command, and each must produce the stated result. Record any that does not.

```bash
# 1 — an injected violation fires both tracks
git stash list >/dev/null
printf '\nconst rows = await container.db.select()\n' >> server/src/modules/agents/routes.ts
bash scripts/pr-self-review/scope.sh | bash scripts/pr-self-review/gates.sh | jq '[.gates[] | select(.name=="arch")]'
# expect: status "fail"
git checkout server/src/modules/agents/routes.ts

# 2 — a gates run passes a push and is refused for a PR
printf '{"tool_name":"Bash","tool_input":{"command":"git push"}}' | bash scripts/pr-self-review/gate.sh; echo "push exit $?"
printf '{"tool_name":"Bash","tool_input":{"command":"gh pr create"}}' | bash scripts/pr-self-review/gate.sh; echo "pr exit $?"
# expect: 0 then 2

# 3 — the registry gate reports today's real drift
bash scripts/pr-self-review/registry.sh | jq '[.[] | .message]'
# expect: architecture-patterns and github-workflow-automation locked with no
# directory; seven directories with no lock entry; the missing .cursor/skills symlink

# 4 — Track A alone stays under 90 seconds on a two-package diff
time (bash scripts/pr-self-review/scope.sh | bash scripts/pr-self-review/gates.sh >/dev/null)
```

- [ ] **Step 3: Run the RED prong**

Revert the fix from commit `1d5348d` (*refuse a finding link whose path would resolve out of the repo*), run `/pr-self-review --full`, and confirm the security subagent raises a path-traversal critical with `file:line`. This is the one acceptance check that measures the model half against a defect this repo actually shipped a fix for.

```bash
git revert --no-commit 1d5348d
# run /pr-self-review, read the report
git revert --abort || git checkout -- .
```

- [ ] **Step 4: Run the GREEN comparison and record it**

Run the same scenario with the skill directory moved out of the tree, and record token and tool-call counts for both runs in `.claude/skills/pr-self-review/README.md` §"How this was tested". `.claude/skills/README.md` requires this, and spec 02 found its skill rescued nothing it had assumed it would — assume the same here until measured.

- [ ] **Step 5: Record what the build taught, and close the spec**

Run the `engineering-insights` skill. Then set spec 03's status to `Implemented 2026-08-02` in both the spec header and `specs/README.md`, noting the `gate.sh` path divergence from the spec text.

```bash
git add .github/workflows/pr-self-review.yml .claude/skills/pr-self-review/README.md INSIGHTS.md specs/README.md specs/03-pr-self-review-skill.md
git commit -m "test(pr-self-review): add the CI workflow and record the acceptance run"
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: the verdict file and freshness → Tasks 5 and 6; Track A including the registry gate → Tasks 1 and 3; Track B routing and the INSIGHTS-first rule → Task 8; severity and adversarial verification → Tasks 4, 5, 8; the baseline and diff-line anchoring → Task 4; the three tiers → Task 2; the report's five rules → Task 5; modes and cost control → Tasks 6 and 7; what gets built → Tasks 7 and 8; acceptance → Task 9.

**Known gap, deliberate.** The spec's finding cache by file-content hash (`Modes and cost control`) is not built. `--only critical` in Task 7 covers the same need with a re-run rather than a cache, and a cache with no measured cost problem is speculative. Add it if Task 9's timing shows Track B is the bottleneck.

**Type consistency.** The finding shape `{severity, source, file, line, message, fix}` is fixed by Task 1 and unchanged through Tasks 2–5; `anchored` (Task 4) and `verifier` (Task 8) are the only added keys. `scope.json` keys used in Task 3 (`.packages`), Task 4 (`.scope.routed[].path/.lines`), Task 5 (`.scope.skipped`) and Task 6 (`.worktreeHash`) all exist in Task 2's output. `line: 0` means "no single line" in Tasks 3, 4 and 5 alike.
