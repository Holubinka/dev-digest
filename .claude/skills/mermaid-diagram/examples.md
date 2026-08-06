# Mermaid Diagram Examples

Ready-to-use templates, one per diagram type, in the order the Decision Guide in
[`SKILL.md`](SKILL.md) introduces them. Every subject is real code in this repository —
Postgres 16 + pgvector, Fastify 5, Drizzle, Next.js 15 — so a template is a head start, not
something to translate off another stack first.

Each one names the file it was drawn from. When the code moves, re-read that file before
reusing the diagram.

---

## 1. Flowchart — how `scope.sh` classifies one changed path

From `scripts/pr-self-review/scope.sh:190-245`. A branching process with four terminal
buckets, which is exactly what a flowchart is for.

```mermaid
flowchart TD
    P(["one path from git diff --name-only"]) --> PKG["append client / server / reviewer-core<br/>to packages[]"]
    PKG --> SKIP{"skip_reason?"}
    SKIP -->|"lockfile · generated · binary"| S[["skipped[] — with the reason"]]
    SKIP -->|no| FLAG{"flag_for?"}
    FLAG -->|".env · private key · vendor/ · e2e/specs/*.flow.json"| F[["flagged[] — severity + fix"]]
    FLAG -->|no| DOM{"domains_for?"}
    DOM -->|"not source"| C[["checklist[] — read, no subagent"]]
    DOM -->|"client/src · server/src · reviewer-core/src"| R[["routed[] — + changed line numbers"]]

    style F fill:#ff6b6b,color:#fff
```

**Why the package is appended first.** The two `continue`s below it exit the loop body, so a
path counted after them would contribute nothing — the bug the comment at `:192-204` records.
A flowchart earns its place when the *order* of steps is the point.

---

## 2. Flowchart — a repository from URL to searchable index

From `server/src/modules/repos/service.ts:86-106` (`add`) and `:51-79` (`runCloneJob`).
Two background jobs chained by `enqueue`, which no sequence diagram would show as clearly.

```mermaid
flowchart LR
    A["POST /repos"] --> B["RepoService.add<br/>parseRepoUrl → owner/name"]
    B --> C{"already in this workspace?"}
    C -->|yes| C200["200 — existing repo, created: false"]
    C -->|no| D[("insert into repos")]
    D --> E{{"enqueue clone job"}}
    E --> F["201 — response returns now,<br/>the job runs after it"]

    E -.-> G["runCloneJob"]
    G --> H["secrets.get GITHUB_TOKEN"]
    H --> I[["GitClient.clone — depth-limited"]]
    I --> J[("update repos.clone_path")]
    J --> K{{"enqueue index job"}}
    K -.-> L["repo-intel indexer"]
    L --> M[("file_edges · file_facts · file_rank<br/>repo_map_cache")]
```

Dashed edges mean "hands off to a job", not "calls". The response at `F` is already on the
wire while `G` runs.

---

## 3. Sequence Diagram — `POST /repos` through the rings

From `server/src/modules/repos/{routes,service,repository}.ts`. The canonical
`routes → service → repository` shape, with validation ahead of the handler.

`docs/architecture.md:56-75` diagrams the *review* request; this is the shorter one to copy
when the flow is a plain write.

```mermaid
sequenceDiagram
    participant C as client
    participant V as fastify + zod schema
    participant R as repos/routes.ts
    participant S as RepoService
    participant Repo as RepoRepository
    participant D as Postgres
    participant J as JobRunner

    C->>V: POST /repos { url }
    alt body fails RepoInput
        V-->>C: 422 — handler never runs
    else body valid
        V->>R: req.body typed
        activate R
        R->>S: add(workspaceId, userId, url)
        activate S
        S->>Repo: findByFullName(workspaceId, fullName)
        Repo->>D: SELECT … WHERE full_name = $1
        D-->>Repo: row | undefined
        Repo-->>S: row | undefined
        alt already exists
            S-->>R: { repo, created: false }
            R-->>C: 200
        else new
            S->>Repo: insert(values)
            Repo->>D: INSERT … RETURNING *
            D-->>Repo: row
            S->>J: enqueue(clone)
            Note over S,J: fire-and-forget —<br/>the clone outlives this request
            S-->>R: { repo, created: true }
            R-->>C: 201
        end
        deactivate S
        deactivate R
    end
```

**Note the ring discipline:** the route never talks to `D`. `no-db-from-routes` in
`server/.dependency-cruiser.cjs` fails CI on a diagram that would be honest about doing so.

---

## 4. Class Diagram — ports and their adapters

From `server/src/vendor/shared/adapters.ts` (the interfaces) and `server/src/adapters/**`
(the implementations). Use a class diagram for the *shape* of a boundary — not for tables,
which is what §5 is for.

```mermaid
classDiagram
    class LLMProvider {
        <<interface>>
        +readonly id
        +listModels() ModelInfo[]
        +complete(req) CompletionResult
        +completeStructured(req) StructuredResult
        +embed(texts) number[][]
    }
    class GitClient {
        <<interface>>
        +clone(repo, url, opts) path
        +diff(repo, base, head) UnifiedDiff
        +readFile(repo, path) string
        +clonePathFor(repo) string
    }
    class GitHubClient {
        <<interface>>
        +listPullRequests(repo) PrMeta[]
        +getPullRequest(repo, n) PrDetail
        +postReview(repo, n, review) id
    }
    class SecretsProvider {
        <<interface>>
        +get(key) string
        +set(key, value) void
    }

    class OpenAIProvider
    class AnthropicProvider
    class SimpleGitClient
    class OctokitGitHubClient
    class LocalSecretsProvider
    class MockLLMProvider
    class MockGitClient

    class Container {
        +llm(provider) LLMProvider
        +git GitClient
        +github GitHubClient
        +secrets SecretsProvider
    }

    LLMProvider <|.. OpenAIProvider
    LLMProvider <|.. AnthropicProvider
    LLMProvider <|.. MockLLMProvider
    GitClient <|.. SimpleGitClient
    GitClient <|.. MockGitClient
    GitHubClient <|.. OctokitGitHubClient
    SecretsProvider <|.. LocalSecretsProvider

    Container --> LLMProvider
    Container --> GitClient
    Container --> GitHubClient
    Container --> SecretsProvider
```

`Container` points at the **interfaces**, never at the boxes on the right. A diagram with an
arrow from `Container` to `SimpleGitClient` is drawing a violation of `no-service-to-adapter-impl`.
Every port on the left has a mock: that is the rule, not a testing convenience.

---

## 5. ER Diagram — the review tables

From `server/src/db/schema/{core,repos,pulls,reviews,knowledge}.ts`. Column types are the
Postgres ones the migration actually creates, so the diagram can be checked against
`\d+ pull_requests` rather than believed.

```mermaid
erDiagram
    WORKSPACES {
        uuid id PK "defaultRandom()"
        text name
        timestamptz created_at
    }

    REPOS {
        uuid id PK
        uuid workspace_id FK "on delete cascade"
        text owner
        text name
        text full_name "unique per workspace"
        text default_branch "default 'main'"
        text clone_path "null until the clone job lands"
        timestamptz last_polled_at
    }

    PULL_REQUESTS {
        uuid id PK
        uuid workspace_id FK
        uuid repo_id FK
        integer number "unique with repo_id — idempotent import"
        text title
        text head_sha
        text last_reviewed_sha "null until first review"
        text status "GitHub merge state, not review freshness"
        timestamptz updated_at
    }

    PR_FILES {
        uuid id PK
        uuid pr_id FK
        text path
        integer additions
        integer deletions
        text patch "the diff the grounding gate checks against"
    }

    REVIEWS {
        uuid id PK
        uuid workspace_id FK
        uuid pr_id FK
        text kind "enum: summary, review"
        text verdict
        integer score "recomputed server-side"
        text model
        timestamptz created_at
    }

    FINDINGS {
        uuid id PK
        uuid review_id FK
        text file
        integer start_line
        integer end_line
        text severity "CRITICAL, WARNING, SUGGESTION"
        float8 confidence
        jsonb trifecta_components
        timestamptz accepted_at
        timestamptz dismissed_at
    }

    MEMORY {
        uuid id PK
        uuid workspace_id FK
        uuid repo_id FK "nullable — global scope has none"
        text content
        vector embedding "1536 dims, pgvector"
        jsonb sources
    }

    WORKSPACES ||--o{ REPOS : owns
    WORKSPACES ||--o{ PULL_REQUESTS : owns
    WORKSPACES ||--o{ MEMORY : owns
    REPOS ||--o{ PULL_REQUESTS : has
    REPOS ||--o{ MEMORY : "scopes"
    PULL_REQUESTS ||--o{ PR_FILES : has
    PULL_REQUESTS ||--o{ REVIEWS : "reviewed by"
    REVIEWS ||--o{ FINDINGS : produced
```

Every table carries `workspace_id` because tenancy is resolved at the route and every query
filters on it. Drawing it once per table is noise; drawing it never hides the rule.

---

## 6. State Diagram — review freshness for one PR

From `server/src/modules/pulls/status.ts:129-144` (`deriveReviewStatus`). The DB column holds
GitHub's merge state; three of these five are **derived on read** and are not stored anywhere.

```mermaid
stateDiagram-v2
    [*] --> needs_review: imported, never reviewed

    needs_review --> reviewed: review runs against the current head
    reviewed --> needs_review: new commit — head_sha moves past last_reviewed_sha
    reviewed --> stale: no push for STALE_DAYS (7)
    stale --> reviewed: reviewed again
    stale --> needs_review: new commit

    needs_review --> merged
    reviewed --> merged
    stale --> merged
    needs_review --> closed
    reviewed --> closed
    stale --> closed

    merged --> [*]
    closed --> [*]

    note right of stale
        Derived, not stored.
        merged and closed come
        straight from the DB column.
    end note
```

---

## 7. Mindmap — the four packages

From `AGENTS.md` § *Stack*. A mindmap is for a hierarchy with no edges worth naming; the
moment the arrows mean something, use §1 or §3 instead.

```mermaid
mindmap
  root((DevDigest))
    server/
      Fastify 5
      Drizzle 0.38
      Postgres 16 + pgvector
      Zod 3
      pnpm
    client/
      Next.js 15 App Router
      React 19
      TanStack Query 5
      Tailwind 4
      pnpm
    reviewer-core/
      pure TS library
      openai + zod only
      emits no JS
      npm
    e2e/
      agent-browser
      declarative JSON flows
      npm
```

---

## What has no template here, and why

**Gantt** and **pie** are in the Decision Guide but have no template in this file. Neither has
a real subject in this repository: there is no dated schedule to chart, and no measured
distribution to slice. Inventing plausible numbers for a diagram is the same failure as
seeding fake rows to make a screen look fuller — the picture reads as evidence and is not.

Syntax for both is in [`SKILL.md`](SKILL.md); bring your own real numbers.
