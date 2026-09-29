import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Las pruebas con PostgreSQL comparten una sola base, y la del contador vacía el
    // libro al terminar: no compiten por ella.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
