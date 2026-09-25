/**
 * Caso dorado del puesto Conciliación (ADR-018: conciliación es esfuerzo alto).
 *
 * Igual que el de Cobros: corre contra el servidor simulado de `@aiw/models/pruebas`
 * porque no hay credenciales de Bedrock ni de Vertex en la UE todavía (runbook de
 * funciones ausentes). El criterio de hecho «pasa con el proveedor real» queda
 * pendiente en el PR con los pasos exactos para activarlo.
 */
import { crearAdaptadorAnthropic, clienteSimulado } from '@aiw/models';
import {
  iniciarServidorSimulado,
  respuestaDeTexto,
  type ServidorSimulado,
} from '@aiw/models/pruebas';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { casoDoradoEstructurado, evaluarCasoDoradoEstructurado } from '../src/index.js';

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

async function decidirConciliacion(
  movimiento: MovimientoBancario,
  esperado: DecisionConciliacion,
): Promise<{ obtenido: DecisionConciliacion; cerrar: () => Promise<void> }> {
  const servidor: ServidorSimulado = await iniciarServidorSimulado(
    respuestaDeTexto(JSON.stringify(esperado)),
  );
  const puesto = crearAdaptadorAnthropic(clienteSimulado(servidor.url), {
    papel: 'opus5',
    plataforma: 'vertex-eu',
    configuracion: { esfuerzoPorClasePaso: {} },
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
  });

  if (resultado.tipo !== 'ok' || resultado.salida === undefined) {
    throw new Error(
      `El puesto Conciliación no devolvió una decisión válida: ${JSON.stringify(resultado)}`,
    );
  }
  return { obtenido: resultado.salida, cerrar: servidor.cerrar };
}

describe('caso dorado · Conciliación', () => {
  let cerrar: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await cerrar?.();
    cerrar = undefined;
  });

  it('concilia el movimiento con la factura del mismo importe', async () => {
    const esperado: DecisionConciliacion = { facturaId: 'F-2026-014', conciliado: true };
    const caso = casoDoradoEstructurado({
      id: 'conciliacion-001',
      puesto: 'Conciliación',
      entrada: {
        referencia: 'MOV-3001',
        importeEuros: 1200,
        facturasCandidatas: [
          { id: 'F-2026-014', importeEuros: 1200 },
          { id: 'F-2026-020', importeEuros: 500 },
        ],
      },
      esperado,
    });
    const { obtenido, cerrar: cerrarServidor } = await decidirConciliacion(
      caso.entrada as MovimientoBancario,
      esperado,
    );
    cerrar = cerrarServidor;

    const resultadoEval = evaluarCasoDoradoEstructurado(caso, obtenido);
    expect(resultadoEval.superado, resultadoEval.diagnostico).toBe(true);
  });

  it('no concilia cuando ninguna factura candidata cuadra', async () => {
    const esperado: DecisionConciliacion = { facturaId: null, conciliado: false };
    const caso = casoDoradoEstructurado({
      id: 'conciliacion-002',
      puesto: 'Conciliación',
      entrada: {
        referencia: 'MOV-3002',
        importeEuros: 875,
        facturasCandidatas: [{ id: 'F-2026-020', importeEuros: 500 }],
      },
      esperado,
    });
    const { obtenido, cerrar: cerrarServidor } = await decidirConciliacion(
      caso.entrada as MovimientoBancario,
      esperado,
    );
    cerrar = cerrarServidor;

    const resultadoEval = evaluarCasoDoradoEstructurado(caso, obtenido);
    expect(resultadoEval.superado, resultadoEval.diagnostico).toBe(true);
  });
});
