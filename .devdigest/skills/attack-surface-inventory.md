# Attack surface inventory

On an imported public repo the PR title, body, commit messages, changed-file paths
and the diff itself are written by whoever opened the pull request. This rubric is
about what happens to those values, and it has two halves: enumerate first, then
judge.

## 1. Enumerate before you look for anything

For each path this diff touches that carries attacker-supplied text, list **every**
input travelling it and name the bound on each: length in code points, size in
bytes, count, allowed characters, resolved location, numeric range.

`Boundary and edge-case rubric` step 1 builds the same list for tests — reuse its
value-kind list rather than rebuilding it. The difference is the question asked of
each entry: that rubric asks *which test pins this*, this one asks *what bounds it*.

- An input whose bound you cannot name **is the finding**.
- When a path is fully bounded, say so and list the bounds. "Every input here is
  bounded, and here they are" is a claim the next reviewer can check; silence is
  not. One such note per path, no more.
- A bound enforced anywhere else on the same path still counts. Do not report an
  input twice because the cap sits in the caller.

Counting is not measuring. A cap of 20 commit messages with no cap on the length of
one is unbounded.

## 2. The seven shapes that block here

Report these as CRITICAL even when the blast radius looks small. Nothing else in
this rubric is CRITICAL.

- **Injection** — attacker text reaching a prompt outside its untrusted-content
  fence, SQL built by concatenation, a shell argument built from a request value.
- **Broken access control** — a query missing its `workspaceId`, or a route that
  resolves a record by id before proving tenancy. `Route signature checklist`
  covers the route-shaped version; this covers the service and repository.
- **Path traversal** — a filesystem path derived from request or repo content. A
  string check cannot see a symlink: only resolving the path can.
- **A secret in the diff** — a key, token or `.env` committed.
- **Missing or bypassable authentication on an endpoint** — a route with no
  session/auth check, or an internal, debug or "reset" endpoint left reachable
  without one. The absence of a check is the finding; there is no line to cite
  for something that isn't there, so cite the route registration instead.
- **Race condition / TOCTOU** — a check (existence, permission, ownership, current
  state) and a later use of the same resource that are not atomic, so another
  request or process can change what's there in between: a symlink swapped
  between a path check and a file open, a read-modify-write on a DB row with no
  version or lock guard, a balance checked and then debited in two steps.
- **Sensitive data reaching a log, error message, or unencrypted store** —
  payment details, credentials, tokens or PII passed to a logger, included in an
  error response, or written in plaintext where a hash or redaction was called
  for. The write is the finding, not just eventual disclosure.

## 3. Storing what a model returned

Model output reaches Postgres. `text` and `jsonb` both refuse U+0000, and an
`integer` column refuses a value outside int4 — each of which destroys the whole
write, not the one field. Check that every model-derived string and number is
sanitised at the repository, not at the call site.

Cite the changed line that introduces the value. State the bound that is missing,
not that "input should be validated".