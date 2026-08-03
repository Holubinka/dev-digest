---
name: response-schema-contract
description: "Say what a caller receives before and after the diff: fields, optionality, nullability, narrowed types."
---

# Response schema contract

A caller of this API gets no runtime protection: `client/src/lib/api.ts` types a
response with a generic and never parses it. Whatever the handler returns is what
the caller believes. So the shape of the reply is a contract, and this rubric is
about the shape alone — not about who is allowed to call the route, and not about
how severe the change is.

For every route whose reply the diff changes, answer all five in order and report
the ones that come back wrong.

## 1. Which fields does a caller receive before and after?

Read the DTO mapper in `modules/<name>/helpers.ts`, not the SQL. A field that
disappears from the mapper disappears from the reply even when the column is still
there.

- A field removed → CRITICAL. Name the component that reads it.
- A field renamed → CRITICAL, and say what the old name was.
- A field added → SUGGESTION.

## 2. Did an optional field become required, or a required one optional?

Both directions matter, and they break different sides.

**Bad** — the field is now absent for rows that used to carry it:

```ts
// helpers.ts
- evidence_files: row.evidenceFiles ?? [],
+ ...(row.evidenceFiles ? { evidence_files: row.evidenceFiles } : {}),
```

A caller doing `skill.evidence_files.length` now throws on exactly the rows it
used to handle. Report it against the changed line in the mapper.

**Good** — the key is always present, and its emptiness is expressed in its value:

```ts
evidence_files: row.evidenceFiles ?? [],
```

## 3. Did a type narrow?

`string` → an enum, a union losing a member, `number | null` → `number`. Every one
of these is a value a caller handled yesterday and cannot receive today. Narrowing
in the *response* is the break; narrowing in the *request* belongs to the
breaking-change taxonomy.

## 4. Did nullability move?

`null` and a missing key are different values to a caller written in TypeScript,
and `?? fallback` catches only one of them. Say which one the caller now gets.

## 5. Did the contract move in both copies?

`@devdigest/shared` is vendored twice — `server/src/vendor/shared` and
`client/src/vendor/shared`. Each package type-checks against its own copy, so a
one-sided edit compiles cleanly on both sides and is wrong on one. If the diff
touches one copy and not the other, that is a WARNING with the unmirrored path
named.

Cite the changed line that alters the shape. A finding about a caller that was
left unupdated must still be anchored to the line in this diff that created the
obligation.
