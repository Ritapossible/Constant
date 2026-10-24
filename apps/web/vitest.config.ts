import { defineConfig } from "vitest/config";

export default defineConfig({
  // The app's pure logic (lib/), tested without a browser. Workspace packages resolve to their TypeScript source.
  resolve: { conditions: ["@constant/source"] },
  ssr: { resolve: { conditions: ["@constant/source"] } },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
