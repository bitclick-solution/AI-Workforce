import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/servidor.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
});
