/**
 * Architecture fitness function for @devdigest/api.
 *
 * Encodes the ring model documented in `.claude/skills/onion-architecture/`:
 * dependencies point inward only. Each rule below is one arrow that must not exist.
 *
 *   pnpm arch            check (ignores the frozen baseline)
 *   pnpm arch:strict     check including known violations — the real backlog
 *   pnpm arch:baseline   re-freeze after a refactor removes violations
 *
 * It also draws the graph, which beats reading imports when a module is new to you:
 *
 *   pnpm exec depcruise src --config -T mermaid --collapse 2
 *   pnpm exec depcruise src --config -T dot | dot -T svg > /tmp/arch.svg   # needs graphviz
 *
 * `--collapse 2` folds to two directory levels — the altitude the ring model lives at.
 *
 * The baseline lives in `.dependency-cruiser-known-violations.json`. It exists so the
 * gate could be switched on without first refactoring pulls/polling/settings/workspace.
 * It is a to-do list that only shrinks — never regenerate it to silence a NEW violation.
 *
 * Paths are regexes, relative to `server/`. reviewer-core enters the graph as
 * `../reviewer-core/src/**` via the tsconfig alias, so `options.tsConfig` is load-bearing:
 * without it every `@devdigest/*` import reads as unresolvable and half these rules
 * silently match nothing.
 */

/** Everything under a module that is allowed to hold SQL. */
const REPOSITORY = 'src/modules/[^/]+/repository(\\.ts$|/)';

/** The composition root plus the HTTP edge — the only places Fastify may appear. */
const HTTP_EDGE = '^src/(app|server)\\.ts$|^src/modules/index\\.ts$|^src/modules/[^/]+/routes\\.ts$';

module.exports = {
  forbidden: [
    // ---- Ring: infrastructure must not leak inward -------------------------------

    {
      name: 'no-db-from-routes',
      comment:
        'A route validates, resolves tenancy and delegates. SQL belongs in a repository. ' +
        'server/AGENTS.md has said so since the context layer landed; this is the check. ' +
        'pulls/routes.ts is what happens without it: 420 lines and 16 container.db calls.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/routes\\.ts$' },
      to: {
        path: '^src/db/(schema|client)',
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'no-sql-outside-repository',
      comment:
        'drizzle-orm operators (eq, and, sql, …) are SQL. They belong in a repository, ' +
        'not in a service, a helper or a platform module.',
      severity: 'error',
      from: {
        path: '^src/(modules|platform|adapters)/',
        pathNot: [REPOSITORY, '^src/modules/[^/]+/routes\\.ts$'],
      },
      to: { path: 'node_modules/drizzle-orm' },
    },
    {
      name: 'no-fastify-outside-http',
      comment:
        'Fastify is a delivery mechanism. Only the HTTP edge and the composition root may ' +
        'name it. A service that imports FastifyRequest cannot be called from a job or a CLI.',
      severity: 'error',
      from: { pathNot: HTTP_EDGE },
      to: { path: 'node_modules/fastify(-|/|$)' },
    },
    {
      name: 'no-adapter-to-module',
      comment:
        'An adapter is a driven, outermost thing: it implements a port and knows nothing ' +
        'about features. If an adapter needs a constant from a module, the constant is in ' +
        'the wrong place — move it to the port or to the adapter.',
      severity: 'error',
      from: { path: '^src/adapters/' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'no-adapter-to-bootstrap',
      comment:
        'db/seed.ts and db/migrate.ts are standalone CLI scripts, not a library. An adapter ' +
        'importing them drags the seed graph into the running server.',
      severity: 'error',
      from: { path: '^src/adapters/' },
      to: { path: '^src/db/(seed|migrate|seed-prompts)' },
    },
    {
      name: 'no-service-to-adapter-impl',
      comment:
        'A service depends on the port, never the implementation. It reaches concrete ' +
        'adapters through platform/container.ts, which is the composition root. ' +
        'Importing SimpleGitClient directly makes the service untestable without git.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/(service|.*-executor)\\.ts$' },
      to: { path: '^src/adapters/', pathNot: '^src/adapters/mocks\\.ts$' },
    },
    {
      name: 'no-fs-in-service',
      comment:
        'Filesystem access is I/O and belongs behind a port — GitClient.readFile already ' +
        'exists. A service that calls node:fs cannot be unit-tested without a real checkout.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/(service|.*-executor)\\.ts$' },
      // The resolver strips the `node:` prefix — `node:fs/promises` arrives as
      // `fs/promises`. Matching '^node:fs' alone silently matches nothing.
      to: { path: '^(node:)?fs(/|$)' },
    },

    // ---- Ring: the core stays pure ------------------------------------------------

    {
      name: 'core-stays-pure',
      comment:
        'reviewer-core is the functional core: two runtime deps, openai and zod. Everything ' +
        'else arrives as a parameter or a callback (estimateCost is the pattern). Adding I/O ' +
        'here breaks the server and the CI runner at once. A ratchet — currently clean.',
      severity: 'error',
      from: { path: '^\\.\\./reviewer-core/src/' },
      to: {
        path:
          'node_modules/(fastify|drizzle-orm|postgres|simple-git|octokit|dotenv)|' +
          '^(node:)?(fs|child_process|http|https|net|os)(/|$)',
      },
    },
    {
      name: 'contracts-stay-pure',
      comment:
        'vendor/shared holds the contracts and the port interfaces — the innermost ring, ' +
        'vendored into both server and client and aliased by reviewer-core. It may import ' +
        'zod and itself, nothing else. A ratchet — currently clean.',
      severity: 'error',
      from: { path: '^src/vendor/shared/' },
      to: {
        pathNot: '^src/vendor/shared/|node_modules/zod',
        dependencyTypesNot: ['core'],
      },
    },

    // ---- Slice isolation ------------------------------------------------------------

    {
      name: 'no-cross-module',
      comment:
        'Modules are vertical slices. One slice reaching into another couples them at the ' +
        'file level and blocks extraction. Share through _shared/, through a port, or ' +
        'through a repository hung off the container (see container.agentsRepo). ' +
        'A re-export barrel does NOT help: the edge is reported against the file you import, ' +
        'so adding an index.ts inside the foreign slice just moves the violation onto the ' +
        'barrel. The shared thing has to leave the slice.',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/' },
      // $1 is the group captured by `from.path` — dependency-cruiser's backreference
      // syntax, NOT a regex \1. With \1 this rule flags every same-module import.
      to: {
        path: '^src/modules/([^/]+)/',
        pathNot: '^src/modules/($1|_shared)/',
      },
    },

    // ---- Generic hygiene --------------------------------------------------------------

    {
      name: 'no-circular',
      comment:
        'A cycle means the two files are really one module with a seam drawn in the wrong ' +
        'place. platform/container.ts importing modules/ is NOT a cycle to fix — it is the ' +
        'composition root, the one place allowed to know every concrete type.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-dev-dep',
      comment:
        'Production code importing a devDependency ships a module that will not exist after ' +
        'a production install.',
      severity: 'error',
      from: { path: '^src/', pathNot: '\\.test\\.ts$' },
      to: { dependencyTypes: ['npm-dev'] },
    },
  ],

  options: {
    // Load-bearing: resolves @devdigest/shared and @devdigest/reviewer-core. Drop it and
    // the aliased imports become unresolvable, so the core/contract rules match nothing
    // and report a green run that proves absolutely nothing.
    tsConfig: { fileName: 'tsconfig.json' },

    // Follow `import type` too — a type-only edge is still an architectural dependency.
    // Individual rules opt out with dependencyTypesNot: ['type-only'] where a $inferSelect
    // row type genuinely is not a database call.
    tsPreCompilationDeps: true,

    // doNotFollow, NOT exclude. `exclude` deletes the module from the graph along with
    // every edge pointing at it — which silently disarms every rule whose `to` names an
    // npm package (no-sql-outside-repository, no-fastify-outside-http, core-stays-pure,
    // not-to-dev-dep). doNotFollow keeps the edge and just refuses to traverse inward.
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: [
        '^src/db/migrations/',
        '^clones/',
        '^dist/',
      ].join('|'),
    },

    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.js', '.mjs', '.cjs', '.json'],
    },

    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
