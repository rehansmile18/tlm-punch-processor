import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    globals: false,
    setupFiles: ["./tests/setup.ts"],
    // Each test file that calls setupTestContext() spawns its own real mongod process
    // (mongodb-memory-server). Running all ~26 files fully in parallel means that many
    // concurrent mongod processes fighting for CPU/file descriptors at once, which manifested as
    // rare, non-deterministic request failures (a unique index not yet done building, a query
    // timing out) under full parallelism — not specific to any one test. Capping concurrency
    // keeps the suite fast without that contention.
    maxWorkers: 4,
  },
});
