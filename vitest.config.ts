import { defineConfig } from "vitest/config";

// Root config for `vitest run` invoked at the repo top-level. Each artifact
// package may define its own `vitest.config.ts` (e.g. the checkout app uses
// jsdom + the `@/` path alias for component tests); those per-project configs
// are picked up via the `projects` field below. Packages without a
// vitest.config.ts fall back to the default node environment, so existing
// API-server tests continue to run unchanged.
export default defineConfig({
  test: {
    projects: [
      "artifacts/checkout",
      {
        // Catch-all for everything else (api-server lib + route tests, etc.)
        test: {
          name: "api-server",
          include: ["artifacts/api-server/src/**/*.test.{ts,tsx}", "lib/**/*.test.{ts,tsx}"],
          environment: "node",
        },
      },
    ],
  },
});
