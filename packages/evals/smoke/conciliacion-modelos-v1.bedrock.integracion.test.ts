/**
 * Caso dorado del puesto Conciliación contra el Bedrock UE real, por el cliente
 * clásico (`clienteBedrockDesdeEntorno`, ADR-017, ADR-023), para cerrar el
 * criterio de hecho pendiente de la rebanada «Modelos v1». Igual que
 * `cobros-modelos-v1.bedrock.integracion.test.ts`, salvo que aquí se reutiliza
 * `evaluarCasoDoradoEstructurado` (comparación exacta de JSON): la salida de
 * Conciliación es enteramente categórica, sin texto libre.
 *
 * Misma condición de salto que `anthropic.bedrock.integracion.test.ts` — ver
 * `docs/runbooks/modelos-funciones-ausentes.md`.
 *
 * El cuerpo de la prueba es común a Bedrock y a Vertex — ver
 * `casos-dorados-proveedor-real.compartido.ts` — para no duplicar el caso entre
 * proveedores.
 */
import { clienteBedrockDesdeEntorno } from '@aiw/models';

import { registrarCasoDoradoConciliacion } from './casos-dorados-proveedor-real.compartido.js';

const REGION = process.env['AIW_BEDROCK_REGION_UE'];
const HAY_BEDROCK = Boolean(
  REGION && process.env['AWS_ACCESS_KEY_ID'] && process.env['AWS_SECRET_ACCESS_KEY'],
);

registrarCasoDoradoConciliacion({
  nombre: 'Bedrock UE real (camino clásico)',
  disponible: HAY_BEDROCK,
  motivoSalto:
    'Sin AIW_BEDROCK_REGION_UE, AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY: ver ' +
    'docs/runbooks/modelos-funciones-ausentes.md.',
  crearCliente: clienteBedrockDesdeEntorno,
  plataforma: 'bedrock-eu',
});
