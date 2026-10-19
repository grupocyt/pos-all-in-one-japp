// Reglas de estilo que Prettier no cubre: llaves siempre y una declaración por línea.
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "packages/db/src/schema/**", "packages/contracts/src/schema.d.ts", "docs/**"] },
  {
    files: ["**/*.ts"],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaVersion: 2023, sourceType: "module" } },
    rules: {
      curly: ["error", "all"],
      "one-var": ["error", "never"],
      "no-nested-ternary": "warn",
    },
  },
);
