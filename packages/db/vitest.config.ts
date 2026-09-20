import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Las pruebas de base de datos comparten una sola base: no compiten por ella.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
