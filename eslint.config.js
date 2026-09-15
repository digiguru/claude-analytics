// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "data/**", "**/*.d.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Permissive starting point per #26: the codebase already leans on `!`
      // and the odd `any` at API/DB boundaries; tighten these once the base
      // config is bedded in rather than blocking on a big fixup pass now.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": "warn",
      // Flags the classic "call an async loader in an effect" data-fetching
      // pattern used throughout this app (App.tsx, GroupsView.tsx,
      // OverviewView.tsx, MembersView.tsx, SortableTable.tsx) as an error.
      // That pattern is idiomatic here (no data-fetching library in play) and
      // fixing it properly is a real behavioural change, not a lint fix — see
      // #23 for the render-purity issues that are genuine bugs. Downgraded to
      // warn per #26's "start permissive" guidance rather than disabled
      // outright; revisit once #23 is addressed.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  eslintConfigPrettier,
);
