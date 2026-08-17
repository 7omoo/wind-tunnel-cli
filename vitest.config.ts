import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/tests/**/*.test.ts"],
    coverage: {
      // Source only — the coverage question is "which shipped lines are
      // exercised", not how thoroughly the tests test themselves.
      include: ["packages/*/src/**"],
      reporter: ["text-summary", "html"],
    },
  },
});
