import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Rules are pure. A test that needs the network or a clock is a bug.
    environment: "node",
  },
});
