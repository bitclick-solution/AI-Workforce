/**
 * Caso dorado del puesto Conciliación contra el Vertex UE real (ADR-017, ADR-023),
 * para cerrar el criterio de hecho pendiente de la rebanada «Modelos v1». Igual
 * que `cobros-modelos-v1.vertex.integracion.test.ts`, salvo que aquí sí se
 * reutiliza `evaluarCasoDoradoEstructurado` (comparación exacta de JSON): la
 * salida de Conciliación es enteramente categórica (`facturaId`, `conciliado`),
 * sin ningún campo de texto libre que un modelo real redacte a su manera, así que
 * la igualdad exacta contra el caso dorado del eval de humo sigue siendo la
 * comprobación correcta.
 *
 * Sin `AIW_VERTEX_REGION_UE`/`AIW_VERTEX_PROJECT_ID` se salta — ver
 * `docs/runbooks/vertex-wif.md`.
 *
 * El cuerpo de la prueba es común a Vertex y a Bedrock — ver
 * `casos-dorados-proveedor-real.compartido.ts` — para no duplicar el caso entre
 * proveedores.
 */
import { clienteVertexDesdeEntorno } from '@aiw/models';

import { registrarCasoDoradoConciliacion } from './casos-dorados-proveedor-real.compartido.js';

const REGION = process.env['AIW_VERTEX_REGION_UE'];
const PROYECTO = process.env['AIW_VERTEX_PROJECT_ID'];
const HAY_VERTEX = Boolean(REGION && PROYECTO);

registrarCasoDoradoConciliacion({
  nombre: 'Vertex UE real',
  disponible: HAY_VERTEX,
  motivoSalto: 'Sin AIW_VERTEX_REGION_UE y AIW_VERTEX_PROJECT_ID: ver docs/runbooks/vertex-wif.md.',
  crearCliente: clienteVertexDesdeEntorno,
  plataforma: 'vertex-eu',
});
