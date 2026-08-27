# dev-digest-conventions

House conventions observed in `Holubinka/dev-digest`. Flag any change that violates a rule below, and cite the offending `file:line`. A rule not violated by this diff is not a finding.

## api

Provide a typed api object with get, post, put, patch, del, and upload methods that wrap apiFetch.

Observed at `client/src/lib/api.ts:69`, `client/src/lib/hooks/agents.ts:14`, `client/src/lib/hooks/reviews.ts:28`.

Normalize API errors to a custom error class with status, code, and details fields; throw it on network failure and non-OK responses.

Observed at `client/src/lib/api.ts:8`, `client/src/lib/api.ts:23`, `client/src/lib/api.ts:48`.

## naming

Use camelCase for TypeScript variable and property names, and snake_case for database column names.

Observed at `server/src/db/schema/core.ts:6`, `server/src/db/schema/repos.ts:5`, `server/src/db/schema/core.ts:19`, `client/src/lib/hooks/agents.ts:29`.

## error-handling

Define domain-specific error classes that extend AppError with a code, message, statusCode, and optional details.

Observed at `server/src/platform/errors.ts:7`, `server/src/platform/errors.ts:19`, `server/src/platform/errors.ts:25`, `server/src/platform/errors.ts:31`.

## async

Use React Query hooks (useQuery, useMutation) with queryKey arrays and queryFn for server state; invalidate or update cache on success.

Observed at `client/src/lib/hooks/agents.ts:14`, `client/src/lib/hooks/agents.ts:40`, `client/src/lib/hooks/reviews.ts:60`, `client/src/lib/hooks/agents.ts:67`.

Use React Query hooks (useQuery, useMutation) with queryKey arrays and queryFn callbacks for server state management.

Observed at `client/src/lib/hooks/agents.ts:14`, `client/src/lib/hooks/agents.ts:21`, `client/src/lib/hooks/reviews.ts:28`, `client/src/lib/hooks/reviews.ts:40`.

## typing

Use satisfies const to narrow array and object types to readonly literals, especially for configuration and metadata.

Observed at `client/src/app/repos/[repoId]/pulls/constants.ts:41`, `client/src/components/diff-viewer/comments.ts:173`, `server/src/modules/repo-intel/constants.ts:14`, `server/src/modules/repo-intel/constants.ts:17`.