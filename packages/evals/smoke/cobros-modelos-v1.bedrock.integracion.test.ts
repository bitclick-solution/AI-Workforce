/**
 * Caso dorado del puesto Cobros contra el Bedrock UE real, por el cliente
 * clásico (`clienteBedrockDesdeEntorno`, ADR-017, ADR-023), para cerrar el
 * criterio de hecho pendiente de la rebanada «Modelos v1» («pasa con el
 * proveedor real», ver `docs/runbooks/modelos-funciones-ausentes.md`).
 *
 * Misma condición de salto que `anthropic.bedrock.integracion.test.ts`: sin
 * `AIW_BEDROCK_REGION_UE`, `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY` se
 * salta sola. Nunca corre en un PR — la relación de confianza de OIDC de
 * `aiw-ci-bedrock` solo admite `main` — solo en el job **Bedrock UE ·
 * integración** de `ci.yml`, semanal o a mano.
 *
 * El cuerpo de la prueba es común a Bedrock y a Vertex — ver
 * `casos-dorados-proveedor-real.compartido.ts` — para no duplicar el caso entre
 * proveedores.
 */
import { clienteBedrockDesdeEntorno } from '@aiw/models';

import { registrarCasoDoradoCobros } from './casos-dorados-proveedor-real.compartido.js';

const REGION = process.env['AIW_BEDROCK_REGION_UE'];
const HAY_BEDROCK = Boolean(
  REGION && process.env['AWS_ACCESS_KEY_ID'] && process.env['AWS_SECRET_ACCESS_KEY'],
);

registrarCasoDoradoCobros({
  nombre: 'Bedrock UE real (camino clásico)',
  disponible: HAY_BEDROCK,
  motivoSalto:
    'Sin AIW_BEDROCK_REGION_UE, AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY: ver ' +
    'docs/runbooks/modelos-funciones-ausentes.md.',
  crearCliente: clienteBedrockDesdeEntorno,
  plataforma: 'bedrock-eu',
});
