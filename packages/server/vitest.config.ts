import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The integration tests share one MongoDB instance, so files must not run
    // concurrently against the same database.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
