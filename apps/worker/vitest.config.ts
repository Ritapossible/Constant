import { defineConfig } from "vitest/config";

export default defineConfig({
  // Workspace packages resolve to their TypeScript source in tests: no build step needed.
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Each test file gets its own database; files run in parallel safely.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
