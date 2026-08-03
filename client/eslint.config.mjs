import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      // Vendored read-only copies — the server's `shared` is the source of
      // truth and `ui` is a design-system drop. Neither is ours to edit, so
      // linting them would only produce violations we are not allowed to fix.
      "src/vendor/**",
    ],
  },

  ...compat.extends("next/core-web-vitals", "next/typescript"),

  {
    // An eslint-disable that no longer suppresses anything is a lie about the
    // code beneath it — this package already carried one.
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      // A leading underscore marks a binding that exists only to be excluded,
      // e.g. `prId: _prId` in lib/hooks/reviews.ts.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
];

export default config;
