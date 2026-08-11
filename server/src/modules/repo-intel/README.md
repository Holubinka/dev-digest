# `repo-intel` — the codebase indexer

`repo-intel` reads a cloned repository **once on clone** (and incrementally on
fetch, keyed by file content hash) and turns it into queryable facts: symbols,
the import graph, a PageRank-based file importance score, and a compact **repo
map** (the project skeleton). On a review it is only **read** — the index is
already computed, so adding context to a prompt costs no analysis at request time.

This is **starter infrastructure**: it works from day 1 (the **Indexed** badge),
but you don't write it. Features are built _on top_ of its facade — Blast Radius
(`specs/07-blast-radius.md`), Conventions samples (L02), Onboarding reading-path
(L05), the Phantom-API gate (L06) — by calling `repoIntel.*`, not by re-indexing.

## Pipeline

```mermaid
flowchart LR
  CLONE["git clone / fetch"] --> WALK["walk.ts<br/>discover source files"]
  WALK --> AST["ast-grep adapter<br/>symbols + references"]
  AST --> EDGES["import graph<br/>(dependency-cruiser)"]
  EDGES --> RANK["rank.ts<br/>PageRank + git hotness → file rank"]
  RANK --> MAP["repo-map.ts<br/>compact repo skeleton (cached)"]
  AST --> DB[("Postgres<br/>symbols · references · file_edges · file_rank · repo_map_cache")]
  EDGES --> DB
  RANK --> DB
  MAP --> DB
```

Full vs incremental indexing lives in `pipeline/{full,incremental}.ts`; an
unindexed or partially-indexed repo degrades gracefully (the facade returns empty
results rather than throwing).

## Facade (`repoIntel.*`)

Everything downstream reads through one facade (`service.ts`) so consumers never
touch the pipeline internals:

- `getRepoMap(repoId)` → the cached repo skeleton (fed into the **review prompt**).
- `getFileRank(repoId, files)` → importance percentile per changed file.
- `getCallerSignatures(repoId, files, limit)` → callers of changed symbols.
- `getBlastRadius(repoId, files)` → impacted symbols / callers.
- `getDownstream(repoId, files, maxDepth)` → files that import the changed ones,
  breadth-first over the reverse import graph, capped at depth 2.
- `getIndexState(repoId)` → how much of the index backs an answer.
- `getUnresolvedReferences(repoId, …)` → phantom-symbol detection (used by L06).
- `getConventionSamples(repoId)` → top-ranked files for convention extraction (L02).

Wired today:

- `getRepoMap` / `getFileRank` / `getCallerSignatures` → `modules/reviews/run-executor.ts`,
  which adds the repo map and a high-blast-radius note to the prompt. Toggled by
  `REPO_INTEL_ENABLED` (global) and a per-agent `repo_intel` flag.
- `getIndexState` / `getBlastRadius` / `getDownstream` → `modules/blast/service.ts`, behind
  `GET /pulls/:id/blast` (`specs/07-blast-radius.md`). `getIndexState` gates the other two:
  on an unindexed repo they are never called.
- `getConventionSamples` → `modules/conventions/service.ts:179`.

`getUnresolvedReferences` has no consumer yet.

## Routes

- `GET /repos/:id/index-state` — index status (drives the **Indexed** badge).
- `POST /repos/:id/resync` — enqueue a re-index.
