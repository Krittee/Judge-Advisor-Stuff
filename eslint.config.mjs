import { FlatCompat } from "@eslint/eslintrc";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: here });

const config = [
  {
    ignores: [".next/**", "node_modules/**", "out/**", "build/**", "next-env.d.ts"],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // A leading underscore marks a destructured field kept only to
      // strip it out (see stripCode in src/lib/data.ts) or an object
      // spread's own discard -- deliberate, not dead code.
      "@typescript-eslint/no-unused-vars": ["warn", { varsIgnorePattern: "^_" }],
    },
  },
];

export default config;
