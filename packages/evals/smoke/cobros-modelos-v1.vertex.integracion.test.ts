/**
 * Caso dorado del puesto Cobros contra el Vertex UE real (ADR-017, ADR-023),
 * para cerrar el criterio de hecho pendiente de la rebanada «Modelos v1» («pasa
 * con el proveedor real», ver `docs/runbooks/modelos-funciones-ausentes.md`).
 *
 * Sin `AIW_VERTEX_REGION_UE`/`AIW_VERTEX_PROJECT_ID` se salta, igual que
 * `anthropic.vertex.integracion.test.ts`: nunca corre en un PR normal, solo en el
 * job **Vertex UE · integración** (`ci.yml`), semanal o manual, en `main`.
 *
 * `evaluarCasoDoradoEstructurado` (`@aiw/evals`) compara por igualdad exacta de
 * JSON, pensado para el servidor simulado que devuelve literalmente el
 * `esperado` — con un modelo real, el campo `motivo` es texto libre que el
 * modelo redacta él mismo y nunca va a coincidir cadena a cadena con el del caso
 * dorado del eval de humo. Por eso esta prueba, contra el proveedor real, solo
 * exige lo que es observable y verificable de una decisión de negocio: la
 * decisión booleana (`proponerNota`) coincide con la esperada y el motivo es una
 * frase no vacía que cumple el esquema estricto — no repite la comparación
 * cadena a cadena del eval de humo determinista.
 */
import { clienteVertexDesdeEntorno, crearAdaptadorAnthropic } from '@aiw/models';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const REGION = process.env['AIW_VERTEX_REGION_UE'];
const PROYECTO = process.env['AIW_VERTEX_PROJECT_ID'];
const HAY_VERTEX = Boolean(REGION && PROYECTO);

const MOTIVO_SALTO =
  'Sin AIW_VERTEX_REGION_UE y AIW_VERTEX_PROJECT_ID: ver docs/runbooks/vertex-wif.md.';

const TITULO = HAY_VERTEX
  ? 'caso dorado · Cobros · Vertex UE real'
  : `caso dorado · Cobros · Vertex UE real — SALTADO. ${MOTIVO_SALTO}`;

const decisionCobros = z.object({
  proponerNota: z.boolean(),
  motivo: z.string().min(1),
});

describe.skipIf(!HAY_VERTEX)(TITULO, () => {
  it('opus5 (decision_escritura) propone una nota de seguimiento para una factura vencida hace 45 días', async () => {
    const puesto = crearAdaptadorAnthropic(clienteVertexDesdeEntorno(), {
      papel: 'opus5',
      plataforma: 'vertex-eu',
      configuracion: { esfuerzoPorClasePaso: { decision_escritura: 'high' } },
    });

    const resultado = await puesto.completar({
      clasePaso: 'decision_escritura',
      sistema:
        'Eres el puesto Cobros. Decides si proponer una nota de seguimiento por factura vencida.',
      mensajes: [
        {
          rol: 'user',
          contenido: 'Factura F-2026-014 de Cliente de prueba: 1200 € vencida hace 45 días.',
        },
      ],
      esquemaSalida: decisionCobros,
      maxTokens: 512,
    });

    expect(resultado.tipo).toBe('ok');
    if (resultado.tipo !== 'ok' || resultado.salida === undefined) return;
    expect(resultado.salida.proponerNota).toBe(true);
    expect(resultado.salida.motivo.length).toBeGreaterThan(0);
  }, 30_000);

  it('opus5 (decision_escritura) no propone ninguna nota para una factura que todavía no ha vencido', async () => {
    const puesto = crearAdaptadorAnthropic(clienteVertexDesdeEntorno(), {
      papel: 'opus5',
      plataforma: 'vertex-eu',
      configuracion: { esfuerzoPorClasePaso: { decision_escritura: 'high' } },
    });

    const resultado = await puesto.completar({
      clasePaso: 'decision_escritura',
      sistema:
        'Eres el puesto Cobros. Decides si proponer una nota de seguimiento por factura vencida.',
      mensajes: [
        {
          rol: 'user',
          contenido: 'Factura F-2026-020 de Cliente de prueba: 500 €, vence dentro de 5 días.',
        },
      ],
      esquemaSalida: decisionCobros,
      maxTokens: 512,
    });

    expect(resultado.tipo).toBe('ok');
    if (resultado.tipo !== 'ok' || resultado.salida === undefined) return;
    expect(resultado.salida.proponerNota).toBe(false);
  }, 30_000);
});
