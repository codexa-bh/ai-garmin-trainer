import js from "@eslint/js";
import next from "eslint-config-next/core-web-vitals";
import sonarjs from "eslint-plugin-sonarjs";
import globals from "globals";
import tseslint from "typescript-eslint";
import architecture from "./scripts/eslint-architecture.mjs";
import noVoidPromise from "./scripts/eslint-async.mjs";
import { ambientCapabilities } from "./scripts/architecture-policy.mjs";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "data/**",
      ".garmin-token/**",
      ".garmin-mcp/**",
      "next-env.d.ts",
      "dist/**",
      "src-tauri/target/**",
      "src-tauri/gen/**",
      "src-tauri/resources/**",
    ],
  },
  js.configs.recommended,
  ...next,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: { globals: globals.node },
    plugins: { sonarjs, architecture: { rules: { boundaries: architecture } } },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "architecture/boundaries": "error",
      "sonarjs/no-identical-functions": "error",
      "sonarjs/no-all-duplicated-branches": "error",
      "sonarjs/no-identical-conditions": "error",
      "sonarjs/no-element-overwrite": "error",
      "sonarjs/no-extra-arguments": "error",
      "sonarjs/no-ignored-return": "error",
      "sonarjs/no-inverted-boolean-check": "error",
      "sonarjs/no-collection-size-mischeck": "error",
      "sonarjs/no-redundant-jump": "error",
      "sonarjs/no-use-of-empty-return-value": "error",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { async: { rules: { "no-void-promise": noVoidPromise } } },
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": [
        "error",
        { ignoreVoid: false },
      ],
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "async/no-void-promise": "error",
    },
  },
  {
    files: [
      "src/app/**/*.{ts,tsx}",
      "tests/**/*.{ts,tsx}",
      "src-tauri/ui/*.js",
      "src-tauri/debug/*.js",
    ],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["src/lib/ai/math-analysis.ts"],
    rules: {
      "no-restricted-globals": ["error", ...ambientCapabilities],
    },
  },
];

export default config;
