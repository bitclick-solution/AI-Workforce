import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  // Los paquetes internos se exportan como TypeScript y se empaquetan aquí.
  noExternal: [/^@aiw\//],
});
