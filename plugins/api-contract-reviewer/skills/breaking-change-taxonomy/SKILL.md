---
name: breaking-change-taxonomy
description: "Classify every contract change as breaking or additive, and take its severity from the table."
---

# Breaking change taxonomy

Classify every contract change in the diff against this table and report it at the
severity given. Do not reach for a severity outside it.

**CRITICAL — an existing caller breaks, with no version, flag or fallback**

- A response field removed or renamed.
- A request field that was optional becoming required.
- A type narrowed: a union shrunk, a nullable field made non-null, a free string
  constrained to an enum.
- Validation tightened: a new `min`, `max`, `regex`, `uuid` or length bound on an
  input that already existed.
- A status code changed for an outcome that already had one.
- A route path or method renamed with no alias left behind.

**WARNING — survivable, but the change is not fully landed**

- A shared contract changed in one copy and not its mirror.
- Documentation still describing the previous shape.
- A default changed so that callers who omit the field now behave differently.
- A field deprecated in prose while still required in the schema.

**SUGGESTION — nothing observable breaks**

- A new optional request or response field.
- Validation loosened, or a union widened.
- A rename confined to code no caller can reach.

For every finding, state the request a caller sends today and what changes about
the reply, then cite the changed line that makes it so.
