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
 */
import { clienteVertexDesdeEntorno, crearAdaptadorAnthropic } from '@aiw/models';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { casoDoradoEstructurado, evaluarCasoDoradoEstructurado } from '../src/index.js';

const REGION = process.env['AIW_VERTEX_REGION_UE'];
const PROYECTO = process.env['AIW_VERTEX_PROJECT_ID'];
const HAY_VERTEX = Boolean(REGION && PROYECTO);

const MOTIVO_SALTO =
  'Sin AIW_VERTEX_REGION_UE y AIW_VERTEX_PROJECT_ID: ver docs/runbooks/vertex-wif.md.';

const TITULO = HAY_VERTEX
  ? 'caso dorado · Conciliación · Vertex UE real'
  : `caso dorado · Conciliación · Vertex UE real — SALTADO. ${MOTIVO_SALTO}`;

const decisionConciliacion = z.object({
  facturaId: z.string().nullable(),
  conciliado: z.boolean(),
});

type DecisionConciliacion = z.infer<typeof decisionConciliacion>;

interface MovimientoBancario {
  referencia: string;
  importeEuros: number;
  facturasCandidatas: { id: string; importeEuros: number }[];
}

async function decidirConciliacion(movimiento: MovimientoBancario): Promise<DecisionConciliacion> {
  const puesto = crearAdaptadorAnthropic(clienteVertexDesdeEntorno(), {
    papel: 'opus5',
    plataforma: 'vertex-eu',
    configuracion: { esfuerzoPorClasePaso: { conciliacion: 'high' } },
  });

  const resultado = await puesto.completar({
    clasePaso: 'conciliacion',
    sistema: 'Eres el puesto Conciliación. Decides qué factura casa con un movimiento bancario.',
    mensajes: [
      {
        rol: 'user',
        contenido: `Movimiento ${movimiento.referencia} de ${movimiento.importeEuros} €. Candidatas: ${JSON.stringify(
          movimiento.facturasCandidatas,
        )}.`,
      },
    ],
    esquemaSalida: decisionConciliacion,
    maxTokens: 512,
  });

  if (resultado.tipo !== 'ok' || resultado.salida === undefined) {
    throw new Error(
      `El puesto Conciliación no devolvió una decisión válida: ${JSON.stringify(resultado)}`,
    );
  }
  return resultado.salida;
}

describe.skipIf(!HAY_VERTEX)(TITULO, () => {
  it('concilia el movimiento con la factura del mismo importe', async () => {
    const caso = casoDoradoEstructurado({
      id: 'conciliacion-001-vertex-real',
      puesto: 'Conciliación',
      entrada: {
        referencia: 'MOV-3001',
        importeEuros: 1200,
        facturasCandidatas: [
          { id: 'F-2026-014', importeEuros: 1200 },
          { id: 'F-2026-020', importeEuros: 500 },
        ],
      },
      esperado: { facturaId: 'F-2026-014', conciliado: true },
    });

    const obtenido = await decidirConciliacion(caso.entrada as MovimientoBancario);
    const resultadoEval = evaluarCasoDoradoEstructurado(caso, obtenido);
    expect(resultadoEval.superado, resultadoEval.diagnostico).toBe(true);
  }, 30_000);

  it('no concilia cuando ninguna factura candidata cuadra', async () => {
    const caso = casoDoradoEstructurado({
      id: 'conciliacion-002-vertex-real',
      puesto: 'Conciliación',
      entrada: {
        referencia: 'MOV-3002',
        importeEuros: 875,
        facturasCandidatas: [{ id: 'F-2026-020', importeEuros: 500 }],
      },
      esperado: { facturaId: null, conciliado: false },
    });

    const obtenido = await decidirConciliacion(caso.entrada as MovimientoBancario);
    const resultadoEval = evaluarCasoDoradoEstructurado(caso, obtenido);
    expect(resultadoEval.superado, resultadoEval.diagnostico).toBe(true);
  }, 30_000);
});
