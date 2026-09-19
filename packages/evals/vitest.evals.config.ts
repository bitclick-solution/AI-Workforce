import { defineConfig } from 'vitest/config';

// Evals de humo: casos dorados deterministas que corren en cada PR sin llamar a ningún modelo.
export default defineConfig({
  test: {
    name: 'evals-humo',
    include: ['smoke/**/*.eval.ts'],
    reporters: process.env['CI'] ? ['default', 'junit'] : ['default'],
    outputFile: { junit: 'evals-report/junit.xml' },
  },
});
