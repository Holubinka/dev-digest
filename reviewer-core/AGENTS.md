# reviewer-core/ — `@devdigest/reviewer-core`

The review engine: diff + repo map → prompt → LLM → grounded findings. Repo-wide rules
live in the root `AGENTS.md`; this file only covers what is specific to this package.

## Purity is the contract

This package has **two runtime dependencies: `openai` and `zod`.** No Fastify, no
Drizzle, no database client, no filesystem access, no `process.env` reads. Everything
external arrives through injection — the LLM provider, the cost estimator, the diff.

Adding an I/O dependency here breaks both consumers at once and is the single most
damaging change you can make to this package. If you need data, take it as a parameter.

## Consumed as source, never as a build artifact

`build` is `tsc --noEmit`. This package **never emits JavaScript**. The server imports
`src/` directly through a tsconfig path alias, which has two consequences:

- Its `node_modules` must exist on disk or the server dies at start-up with
  `ERR_MODULE_NOT_FOUND`.
- A breaking change here is not caught by any build step. Run the server's typecheck
  after touching an exported signature.

Uses **npm**, not pnpm.

## The pieces

- `src/review/run.ts` — entry point. Single-pass, or map-reduce per file once the diff
  exceeds `DEFAULT_MAP_THRESHOLD_LINES` (400). Both paths end at the same gate.
- `src/prompt.ts` — prompt assembly. Untrusted content (the diff, the repo map) is
  fenced by `INJECTION_GUARD`, which works by stating trusted rules rather than by
  scanning for suspicious keywords. Do not "improve" it into a keyword blocklist.
- `src/llm/openrouter.ts` — the OpenAI SDK pointed at an OpenAI-compatible `baseURL`.
  One class serves both the OpenRouter path and CI.
- `src/llm/structured.ts` — Zod schema → JSON Schema, with a parse-and-repair loop.
- `src/grounding.ts` — the gate. `groundFindings` drops any finding whose line range
  does not intersect a real hunk in the same file. `FULL_FILE_KINDS` (`secret_leak`,
  `lethal_trifecta`, `phantom`, `hook`) only require the file to appear in the diff.

## Read when

- **Read `README.md`** for the pipeline diagram before changing the flow.
- **Read `INSIGHTS.md`** before debugging anything here.
- **Read `../server/AGENTS.md`** before changing an exported type — the server consumes
  this source directly.
