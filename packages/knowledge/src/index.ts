/**
 * @aiw/knowledge
 *
 * Índice de conocimiento sobre pgvector y texto completo, ingesta por conectores, grafo ligero de entidades y manual de la empresa.
 * La plataforma es dueña del índice, no de los documentos.
 *
 * Esta rebanada solo fija la frontera del paquete. Sin lógica de negocio todavía.
 */
export const PAQUETE = {
  nombre: '@aiw/knowledge',
  tipo: 'paquete',
  responsabilidad:
    'Índice de conocimiento sobre pgvector y texto completo, ingesta por conectores, grafo ligero de entidades y manual de la empresa.',
} as const;

export type Paquete = typeof PAQUETE;
