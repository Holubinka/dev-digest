import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001",
  },

  /**
   * Lets `src/vendor/shared/` resolve its own `.js` specifiers at BUILD time.
   *
   * That folder is a vendored copy of an ESM package, so its internal imports
   * are written the way ESM requires — `export * from './contracts/findings.js'`
   * in `index.ts`, and thirteen siblings the same. `tsc` and vitest both map
   * such a specifier onto the `.ts` file beside it; webpack, which is what
   * `next dev` and `next build` run here, does NOT unless it is told to. So this
   * is not a `.js`-file alias and not a mistake: it is the one line that makes a
   * vendored ESM barrel importable from application code at all.
   *
   * It stayed invisible until 2026-08-14 because the client had only ever
   * imported TYPES from `@devdigest/shared`, and TypeScript erases those before
   * webpack sees them. The first VALUE imported from the barrel (`MAX_DOC_CHARS`,
   * the document write cap the editor and the server must refuse on together)
   * made webpack resolve it for real, and the Project Context page failed to
   * build with `Can't resolve './contracts/findings.js'`. Neither `pnpm
   * typecheck` nor `pnpm test` can catch that — only `pnpm build` and the dev
   * server do.
   *
   * Scoped to the vendored tree through a rule rather than set globally: the
   * mapping is a property of that folder's import style, and nothing in
   * `src/app` or `src/components` writes a `.js` specifier.
   */
  webpack: (config) => {
    config.module.rules.push({
      test: /[\\/]src[\\/]vendor[\\/]shared[\\/]/,
      resolve: { extensionAlias: { ".js": [".ts", ".tsx", ".js"] } },
    });
    return config;
  },
};

export default withNextIntl(nextConfig);
