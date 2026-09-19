import js from "@eslint/js";
import next from "eslint-config-next/core-web-vitals";
import sonarjs from "eslint-plugin-sonarjs";
import globals from "globals";
import tseslint from "typescript-eslint";
import architecture from "./scripts/eslint-architecture.mjs";

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
    files: ["src/app/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["src/lib/ai/math-analysis.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        "process",
        "fetch",
        "globalThis",
        "global",
        "window",
        "document",
        "XMLHttpRequest",
        "WebSocket",
        "require",
        "eval",
        "Function",
      ],
    },
  },
];

export default config;
