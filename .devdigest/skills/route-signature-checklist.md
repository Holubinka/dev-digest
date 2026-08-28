# Route signature checklist

In this repository a route's contract is three things that must move together:

1. the Zod `schema.params` / `schema.body` declared in `modules/<name>/routes.ts`;
2. the DTO mapping in that module's `helpers.ts`, which decides every field a
   caller actually receives;
3. the contract under `vendor/shared/contracts/`, which exists as TWO byte-identical
   copies — one in `server/src/vendor/shared`, one in `client/src/vendor/shared`.

For every route the diff touches, check each of these:

- **Did all three move?** A change to one without the others is the break.
- **Was the shared contract mirrored into both copies?** One copy edited is a
  half-landed change that type-checking cannot see, because each package compiles
  against its own copy.
- **Does the route still validate what the handler reads?** A field read from
  `req.body` but absent from the schema arrives as `undefined` at runtime.
- **Did a response field disappear?** `client/src/lib/api.ts` does NOT validate
  responses — it types them with generics only. A removed field therefore fails
  nowhere near the boundary; it surfaces as `undefined` deep inside a component,
  at a moment unrelated to this diff. Treat a silently removed response field as
  CRITICAL.
- **Is the workspace scope still applied?** A route that stopped filtering by
  workspace is a tenancy break, not a contract nicety.