/**
 * Caso dorado del puesto Cobros contra el Vertex UE real (ADR-017, ADR-023),
 * para cerrar el criterio de hecho pendiente de la rebanada «Modelos v1» («pasa
 * con el proveedor real», ver `docs/runbooks/modelos-funciones-ausentes.md`).
 *
 * Sin `AIW_VERTEX_REGION_UE`/`AIW_VERTEX_PROJECT_ID` se salta, igual que
 * `anthropic.vertex.integracion.test.ts`: nunca corre en un PR normal, solo en el
 * job **Vertex UE · integración** (`ci.yml`), manual en `main` (ADR-023, revisado
 * el 29-9-2026: sin cuota de Google todavía, este job no tiene cron semanal).
 *
 * El cuerpo de la prueba es común a Vertex y a Bedrock — ver
 * `casos-dorados-proveedor-real.compartido.ts` — para no duplicar el caso entre
 * proveedores.
 */
import { clienteVertexDesdeEntorno } from '@aiw/models';

import { registrarCasoDoradoCobros } from './casos-dorados-proveedor-real.compartido.js';

const REGION = process.env['AIW_VERTEX_REGION_UE'];
const PROYECTO = process.env['AIW_VERTEX_PROJECT_ID'];
const HAY_VERTEX = Boolean(REGION && PROYECTO);

registrarCasoDoradoCobros({
  nombre: 'Vertex UE real',
  disponible: HAY_VERTEX,
  motivoSalto: 'Sin AIW_VERTEX_REGION_UE y AIW_VERTEX_PROJECT_ID: ver docs/runbooks/vertex-wif.md.',
  crearCliente: clienteVertexDesdeEntorno,
  plataforma: 'vertex-eu',
});
