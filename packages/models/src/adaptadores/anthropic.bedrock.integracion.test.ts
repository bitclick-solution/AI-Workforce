/**
 * Prueba de integración contra el Bedrock real de la UE (ADR-017), por el camino
 * clásico (`AnthropicBedrock`, `bedrock-runtime`) — vía provisional mientras la
 * cuenta no tenga acceso al endpoint de Mensajes (ver `clientes.ts` y el runbook
 * de funciones ausentes).
 *
 * Sin `AIW_BEDROCK_REGION_UE`, `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY` no hay
 * cuenta contra la que probar: la prueba se salta con un mensaje que dice qué
 * falta, igual que las pruebas de `@aiw/db` contra PostgreSQL sin `DATABASE_URL`
 * (`packages/db/src/pruebas/entorno.ts`). El job **Bedrock UE · integración** de
 * `ci.yml` solo corre sobre `main` (la confianza OIDC de `aiw-ci-bedrock` solo
 * admite ese ref): esta prueba no se ejecuta desde un PR, Jesús la relanza tras
 * fusionar. Pasos exactos para cargar las credenciales:
 * `docs/runbooks/modelos-funciones-ausentes.md`.
 *
 * Sin anular nada, cada papel resuelve al identificador de `identificadores.ts`
 * (perfil de inferencia UE del camino clásico), sin nombrarlo aquí. Un fallo dice
 * qué papel, qué modelo y qué región estaba probando, para no tener que releer el
 * código para saber qué falló.
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import type { PapelModelo } from '@aiw/domain';

import { identificadorDeModelo } from '../identificadores.js';
import { crearAdaptadorAnthropic } from './anthropic.js';
import { clienteBedrockDesdeEntorno } from './clientes.js';

const REGION = process.env['AIW_BEDROCK_REGION_UE'];

const HAY_BEDROCK = Boolean(
  REGION && process.env['AWS_ACCESS_KEY_ID'] && process.env['AWS_SECRET_ACCESS_KEY'],
);

const MOTIVO_SALTO =
  'Sin AIW_BEDROCK_REGION_UE, AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY: esta prueba necesita ' +
  'una cuenta de AWS con Bedrock activado en una región de la UE y acceso a los perfiles de ' +
  'inferencia UE del camino clásico (hoy, sustitutos provisionales: ver identificadores.ts). ' +
  'Ver docs/runbooks/modelos-funciones-ausentes.md para activarla.';

const TITULO = HAY_BEDROCK
  ? 'adaptador de Anthropic · Bedrock UE real (camino clásico)'
  : `adaptador de Anthropic · Bedrock UE real (camino clásico) — SALTADO. ${MOTIVO_SALTO}`;

const PAPELES: readonly PapelModelo[] = ['haiku45', 'sonnet5', 'opus5'];

/** Construye el puerto para un papel y envuelve cualquier fallo con el papel, el modelo y la región. */
function puertoDePapel(papel: PapelModelo, identificadorModelo?: string) {
  const puerto = crearAdaptadorAnthropic(clienteBedrockDesdeEntorno(), {
    papel,
    plataforma: 'bedrock-eu',
    configuracion: { esfuerzoPorClasePaso: { rutina: 'low', conciliacion: 'high' } },
    identificadorModelo,
  });
  return puerto;
}

async function conContextoDeFallo<T>(
  papel: PapelModelo,
  modelo: string,
  tarea: () => Promise<T>,
): Promise<T> {
  try {
    return await tarea();
  } catch (error) {
    throw new Error(
      `Bedrock UE real (camino clásico) falló — papel: ${papel}, modelo: ${modelo}, región: ${REGION}. ` +
        `Causa: ${String(error)}`,
      { cause: error },
    );
  }
}

describe.skipIf(!HAY_BEDROCK)(TITULO, () => {
  it.each(PAPELES)(
    'completa una petición mínima con el papel %s y devuelve tokens reales',
    async (papel) => {
      const identificadorModelo = process.env['AIW_BEDROCK_IDENTIFICADOR_MODELO'];
      const modelo = identificadorModelo?.trim() || identificadorDeModelo(papel, 'bedrock-eu');
      const puerto = puertoDePapel(papel, identificadorModelo);

      const resultado = await conContextoDeFallo(papel, modelo, () =>
        puerto.completar({
          clasePaso: 'rutina',
          mensajes: [{ rol: 'user', contenido: 'Responde solo con la palabra: ping' }],
          maxTokens: 32,
        }),
      );

      expect(resultado.tipo).toBe('ok');
      if (resultado.tipo !== 'ok') return;
      expect(resultado.tokens.entrada).toBeGreaterThan(0);
      expect(resultado.tokens.salida).toBeGreaterThan(0);
    },
    30_000,
  );

  it('devuelve salida estructurada (output_config.format) validada contra el esquema, con sonnet5', async () => {
    const papel: PapelModelo = 'sonnet5';
    const modelo = identificadorDeModelo(papel, 'bedrock-eu');
    const puerto = puertoDePapel(papel);
    const esquema = z.object({ decision: z.enum(['aprobar', 'rechazar']), motivo: z.string() });

    const resultado = await conContextoDeFallo(papel, modelo, () =>
      puerto.completar({
        clasePaso: 'conciliacion',
        mensajes: [
          {
            rol: 'user',
            contenido:
              'Un movimiento bancario de 100 € cuadra con la factura pendiente. Decide si se aprueba o se rechaza.',
          },
        ],
        esquemaSalida: esquema,
        maxTokens: 256,
      }),
    );

    expect(resultado.tipo).toBe('ok');
    if (resultado.tipo !== 'ok') return;
    expect(esquema.safeParse(resultado.salida).success).toBe(true);
  }, 30_000);

  it('acepta una herramienta strict con un entero acotado, con sonnet5', async () => {
    // El entero acotado (min/max) es el caso que reprodujo el 400 de la API
    // («For 'integer' type, properties maximum, minimum are not supported»,
    // encontrado el 28-9 al ejecutar esta prueba en `main`, PR #32): `anthropic.ts`
    // quita esas palabras clave del esquema que viaja y valida la entrada real
    // contra el esquema Zod original al recibirla.
    const papel: PapelModelo = 'sonnet5';
    const modelo = identificadorDeModelo(papel, 'bedrock-eu');
    const puerto = puertoDePapel(papel);

    const resultado = await conContextoDeFallo(papel, modelo, () =>
      puerto.completar({
        clasePaso: 'conciliacion',
        mensajes: [{ rol: 'user', contenido: 'Busca el movimiento de 100 euros.' }],
        herramientas: [
          {
            nombre: 'buscar_movimiento',
            descripcion: 'Busca un movimiento bancario por importe, en céntimos',
            esquemaEntrada: z.object({
              importeCentimos: z.number().int().min(1).max(100_000_00),
            }),
          },
        ],
        maxTokens: 256,
      }),
    );

    expect(resultado.tipo).toBe('ok');
    if (resultado.tipo !== 'ok') return;
    expect(resultado.tokens.entrada).toBeGreaterThan(0);
  }, 30_000);
});
