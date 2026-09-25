/**
 * Prueba de integración contra el Bedrock real de la UE (ADR-017).
 *
 * Sin `AIW_BEDROCK_REGION_UE`, `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY` no hay
 * cuenta contra la que probar: la prueba se salta con un mensaje que dice qué
 * falta, igual que las pruebas de `@aiw/db` contra PostgreSQL sin `DATABASE_URL`
 * (`packages/db/src/pruebas/entorno.ts`). En cuanto Jesús cargue las credenciales
 * en el entorno de la CI, esta prueba se ejecuta y cierra el criterio de hecho
 * pendiente de la rebanada («los casos dorados de Cobros y Conciliación pasan con
 * el proveedor real»). Pasos exactos para cargarlas:
 * `docs/runbooks/modelos-funciones-ausentes.md`.
 *
 * Sin anular nada, el papel `sonnet5` en Bedrock resuelve hoy a Sonnet 4.6
 * (`identificadores.ts`, decisión de Jesús 2026-09-25: Bedrock en Frankfurt no
 * tiene cuota para la familia 5 todavía), así que esta prueba ya ejercita lo que
 * de verdad hay disponible. `AIW_BEDROCK_MODELO_SONNET5` es opcional y solo hace
 * falta si el catálogo de modelos de Bedrock exige un perfil de inferencia entre
 * regiones (por ejemplo `eu.anthropic.claude-sonnet-4-6`) en vez del identificador
 * bajo demanda.
 */
import { describe, expect, it } from 'vitest';

import { crearAdaptadorAnthropic } from './anthropic.js';
import { clienteBedrockDesdeEntorno } from './clientes.js';

const HAY_BEDROCK = Boolean(
  process.env['AIW_BEDROCK_REGION_UE'] &&
  process.env['AWS_ACCESS_KEY_ID'] &&
  process.env['AWS_SECRET_ACCESS_KEY'],
);

const MOTIVO_SALTO =
  'Sin AIW_BEDROCK_REGION_UE, AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY: esta prueba necesita ' +
  'una cuenta de AWS con Bedrock activado en una región de la UE y cuota concedida para Sonnet 5. ' +
  'Ver docs/runbooks/modelos-funciones-ausentes.md para activarla.';

const TITULO = HAY_BEDROCK
  ? 'adaptador de Anthropic · Bedrock UE real'
  : `adaptador de Anthropic · Bedrock UE real — SALTADO. ${MOTIVO_SALTO}`;

describe.skipIf(!HAY_BEDROCK)(TITULO, () => {
  it('completa una petición mínima con Sonnet 5 y devuelve tokens reales', async () => {
    const cliente = clienteBedrockDesdeEntorno();
    const puerto = crearAdaptadorAnthropic(cliente, {
      papel: 'sonnet5',
      plataforma: 'bedrock-eu',
      configuracion: { esfuerzoPorClasePaso: { rutina: 'low' } },
      identificadorModelo: process.env['AIW_BEDROCK_MODELO_SONNET5'],
    });

    const resultado = await puerto.completar({
      clasePaso: 'rutina',
      mensajes: [{ rol: 'user', contenido: 'Responde solo con la palabra: ping' }],
      maxTokens: 32,
    });

    expect(resultado.tipo).toBe('ok');
    if (resultado.tipo !== 'ok') return;
    expect(resultado.tokens.entrada).toBeGreaterThan(0);
    expect(resultado.tokens.salida).toBeGreaterThan(0);
  }, 30_000);
});
