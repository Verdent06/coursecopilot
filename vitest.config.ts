import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    pool: "forks",
    testTimeout: 180_000,
    hookTimeout: 180_000,
    globalSetup: "./test/global-setup.ts",
    env: {
      COURSECOPILOT_CRAWL_DELAY_MS: "0",
    },
  },
});
