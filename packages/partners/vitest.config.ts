import { defineConfig } from "vitest/config";

export default defineConfig({
  // Workspace packages resolve to their TypeScript source in tests: no build step needed.
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    include: ["test/**/*.test.ts"],
    // Rules are pure. A test that needs the network or a clock is a bug.
    environment: "node",
  },
});
