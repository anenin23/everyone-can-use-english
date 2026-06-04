import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

export default [
  {
    ignores: [".vite/**", "node_modules/**", "out/**"],
  },
  ...compat.config({
    env: {
      browser: true,
      es6: true,
      node: true,
    },
    extends: [
      "eslint:recommended",
      "plugin:@typescript-eslint/eslint-recommended",
      "plugin:@typescript-eslint/recommended",
      "plugin:import/recommended",
      "plugin:import/electron",
      "plugin:import/typescript",
    ],
    parser: "@typescript-eslint/parser",
    settings: {
      "import/resolver": {
        typescript: {},
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  }),
];
