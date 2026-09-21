// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/evals-report/**',
      'apps/web/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    rules: {
      // Sin secretos ni trazas sueltas: el registro pasa por el libro de auditoría.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Scripts de operación y ficheros de configuración pueden escribir en consola.
    // Los guiones de demostración (`demo-*.ts`) también: su salida por consola es
    // justo lo que se demuestra, y viven junto al código que enseñan.
    files: ['scripts/**', '*.config.{js,ts,mjs}', 'apps/*/src/main.ts', 'apps/*/src/demo-*.ts'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },
  prettier,
);
