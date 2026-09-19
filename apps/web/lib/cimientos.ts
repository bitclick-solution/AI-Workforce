export interface EstadoCimientos {
  readonly titulo: string;
  readonly piezas: readonly string[];
}

/** Estado estático de los cimientos. El estado real del sistema llega con el panel v1. */
export function estadoCimientos(): EstadoCimientos {
  return {
    titulo: 'Cimientos listos',
    piezas: [
      'Monorepo con pnpm y Turborepo',
      'TypeScript estricto en Node 22',
      'Integración continua: lint, tipos, pruebas, evals de humo, Playwright e imágenes',
      'Compose de desarrollo: PostgreSQL con pgvector, Temporal, Centrifugo, Langfuse y Silo (S3)',
    ],
  };
}
