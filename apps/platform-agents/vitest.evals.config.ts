import { defineConfig } from 'vitest/config';

// Evals de humo del Director de IA: deterministas y sin modelo, como los de @aiw/evals.
export default defineConfig({
  test: {
    name: 'evals-humo-director',
    include: ['smoke/**/*.eval.ts'],
    reporters: process.env['CI'] ? ['default', 'junit'] : ['default'],
    outputFile: { junit: 'evals-report/junit.xml' },
  },
});
