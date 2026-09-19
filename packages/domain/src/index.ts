/**
 * @aiw/domain
 *
 * Entidades, políticas, niveles de autonomía, brand voice, clase de riesgo y esquemas Zod compartidos.
 * Zona crítica: identidad y permisos, motor de políticas y niveles.
 *
 * El esquema de PostgreSQL vive en `./db`; los esquemas Zod de las cargas `jsonb`,
 * en `./esquemas`. Este paquete no depende de ningún otro paquete del monorepo.
 */
export const PAQUETE = {
  nombre: '@aiw/domain',
  tipo: 'paquete',
  responsabilidad:
    'Entidades, políticas, niveles de autonomía, brand voice, clase de riesgo y esquemas Zod compartidos.',
} as const;

export type Paquete = typeof PAQUETE;

export * as esquemas from './esquemas/index.js';
