import { defineConfig } from 'vitest/config';

export default defineConfig({
  // El tsconfig de Next deja `jsx: "preserve"` porque el JSX lo transforma su
  // propio compilador; el transformador por defecto de Vite (oxc) respeta ese
  // ajuste y deja el JSX sin tocar. Se apaga `oxc` para que use esbuild, al
  // que si le decimos `jsx: "automatic"` explícitamente.
  oxc: false,
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['lib/**/*.test.{ts,tsx}', 'app/**/*.test.{ts,tsx}'],
  },
});
