import { defineConfig } from 'tsup';

export default defineConfig({
  // Dos entradas y no una: el paquete de flujos tiene que quedar como fichero propio
  // en `dist/flujos/index.js`, porque el trabajador se lo pasa a Temporal por ruta y
  // Temporal lo vuelve a empaquetar para su entorno aislado. Metido dentro de
  // `main.js` no habría ruta que pasarle.
  entry: ['src/main.ts', 'src/flujos/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  // Los paquetes internos se exportan como TypeScript y se empaquetan aquí.
  noExternal: [/^@aiw\//],
});
