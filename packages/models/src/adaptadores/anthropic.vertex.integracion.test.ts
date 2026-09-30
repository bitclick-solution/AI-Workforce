/**
 * Prueba de integración contra el Vertex AI real de la UE (ADR-017, ADR-023),
 * multirregión europea (`AIW_VERTEX_REGION_UE=eu`).
 *
 * Sin `AIW_VERTEX_REGION_UE` y `AIW_VERTEX_PROJECT_ID` no hay proyecto contra el
 * que probar: la prueba se salta con un mensaje que dice qué falta, igual que la
 * de Bedrock (`anthropic.bedrock.integracion.test.ts`). El job **Vertex UE ·
 * integración** de `ci.yml` solo corre sobre `main` (la confianza de federación de
 * identidades de `aiw-ci-vertex` solo admite ese ref): esta prueba no se ejecuta
 * desde un PR, Jesús la relanza tras fusionar. Pasos exactos para cargar las
 * credenciales: `docs/runbooks/vertex-wif.md`.
 *
 * Sin anular nada, cada papel resuelve al identificador de `identificadores.ts`
 * (tabla `IDENTIFICADOR_VERTEX_UE`), sin nombrarlo aquí — esos identificadores
 * están pendientes de verificar con una llamada real hasta que Jesús pegue la
 * salida de los comandos de Cloud Shell de esta rebanada. Un fallo dice qué papel,
 * qué modelo y qué ubicación estaba probando, para no tener que releer el código
 * para saber qué falló.
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import type { PapelModelo } from '@aiw/domain';

import { identificadorDeModelo } from '../identificadores.js';
import { crearAdaptadorAnthropic } from './anthropic.js';
import { clienteVertexDesdeEntorno } from './clientes.js';

const REGION = process.env['AIW_VERTEX_REGION_UE'];
const PROYECTO = process.env['AIW_VERTEX_PROJECT_ID'];

const HAY_VERTEX = Boolean(REGION && PROYECTO);

const MOTIVO_SALTO =
  'Sin AIW_VERTEX_REGION_UE y AIW_VERTEX_PROJECT_ID: esta prueba necesita un proyecto de Google ' +
  'Cloud con Vertex AI activado en la multirregión europea, con Opus 5.5, Sonnet 5 y Haiku 4.5 ' +
  'concedidos, y credenciales de Google (por defecto de la aplicación o cuenta de servicio). Ver ' +
  'docs/runbooks/vertex-wif.md para activarla.';

const TITULO = HAY_VERTEX
  ? 'adaptador de Anthropic · Vertex UE real (multirregión europea)'
  : `adaptador de Anthropic · Vertex UE real (multirregión europea) — SALTADO. ${MOTIVO_SALTO}`;

const PAPELES: readonly PapelModelo[] = ['haiku45', 'sonnet5', 'opus5'];

function puertoDePapel(papel: PapelModelo) {
  return crearAdaptadorAnthropic(clienteVertexDesdeEntorno(), {
    papel,
    plataforma: 'vertex-eu',
    configuracion: { esfuerzoPorClasePaso: { rutina: 'low', conciliacion: 'high' } },
  });
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
      `Vertex UE real (multirregión europea) falló — papel: ${papel}, modelo: ${modelo}, ` +
        `ubicación: ${REGION}. Causa: ${String(error)}`,
      { cause: error },
    );
  }
}

describe.skipIf(!HAY_VERTEX)(TITULO, () => {
  it.each(PAPELES)(
    'completa una petición mínima con el papel %s y devuelve tokens reales',
    async (papel) => {
      const modelo = identificadorDeModelo(papel, 'vertex-eu');
      const puerto = puertoDePapel(papel);

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

  it.each(PAPELES)(
    'devuelve salida estructurada (output_config.format) validada contra el esquema, con el papel %s',
    async (papel) => {
      const modelo = identificadorDeModelo(papel, 'vertex-eu');
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
    },
    30_000,
  );

  it.each(PAPELES)(
    'acepta una herramienta strict con un entero acotado, con el papel %s',
    async (papel) => {
      const modelo = identificadorDeModelo(papel, 'vertex-eu');
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
    },
    30_000,
  );
});
