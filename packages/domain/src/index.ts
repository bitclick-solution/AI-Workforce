/**
 * @aiw/domain
 *
 * Entidades, políticas, niveles de autonomía, brand voice, clase de riesgo y esquemas Zod compartidos.
 * Zona crítica: identidad y permisos, motor de políticas y niveles.
 *
 * Solo tipos y esquemas: aquí no hay Drizzle, ni SQL, ni conexión. El esquema de
 * PostgreSQL y sus migraciones viven en `@aiw/db`, que depende de este paquete para
 * las enumeraciones y los esquemas Zod. Este paquete no depende de ningún otro
 * paquete del monorepo.
 */
export const PAQUETE = {
  nombre: '@aiw/domain',
  tipo: 'paquete',
  responsabilidad:
    'Entidades, políticas, niveles de autonomía, brand voice, clase de riesgo y esquemas Zod compartidos.',
} as const;

export type Paquete = typeof PAQUETE;

export * from './enumeraciones.js';
export * as esquemas from './esquemas/index.js';

// Aprobación por correo v0
export * from './puertos.js';

// Prueba técnica del stack: motor mínimo de políticas y contrato de delegación
export * from './politicas.js';
export * from './delegacion.js';
