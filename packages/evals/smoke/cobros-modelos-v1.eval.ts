/**
 * Caso dorado del puesto Cobros (ADR-018: `crear_nota_seguimiento` es una escritura
 * N1, así que decide con el papel `opus5` y esfuerzo alto de `decision_escritura`).
 *
 * Corre contra el servidor simulado de `@aiw/models/pruebas`, no contra Bedrock ni
 * Vertex reales: no hay credenciales de la UE todavía (runbook de funciones
 * ausentes). Es lo que exige `vitest.evals.config.ts` — determinista, sin llamar a
 * ningún modelo de verdad — y prueba de punta a punta que el puesto decide con la
 * forma de salida correcta: el adaptador de Anthropic, el esquema estricto y el
 * evaluador de casos dorados encajan. El criterio de hecho «pasa con el proveedor
 * real» queda pendiente en el PR con los pasos exactos para activarlo.
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

const decisionCobros = z.object({
  proponerNota: z.boolean(),
  motivo: z.string().min(1),
});

type DecisionCobros = z.infer<typeof decisionCobros>;

interface FacturaVencida {
  numero: string;
  cliente: string;
  importeEuros: number;
  diasVencido: number;
}

async function decidirCobros(
  factura: FacturaVencida,
  esperado: DecisionCobros,
): Promise<{ obtenido: DecisionCobros; cerrar: () => Promise<void> }> {
  const servidor: ServidorSimulado = await iniciarServidorSimulado(
    respuestaDeTexto(JSON.stringify(esperado)),
  );
  const puesto = crearAdaptadorAnthropic(clienteSimulado(servidor.url), {
    papel: 'opus5',
    plataforma: 'bedrock-eu',
    configuracion: { esfuerzoPorClasePaso: {} },
  });

  const resultado = await puesto.completar({
    clasePaso: 'decision_escritura',
    sistema:
      'Eres el puesto Cobros. Decides si proponer una nota de seguimiento por factura vencida.',
    mensajes: [
      {
        rol: 'user',
        contenido: `Factura ${factura.numero} de ${factura.cliente}: ${factura.importeEuros} € vencida hace ${factura.diasVencido} días.`,
      },
    ],
    esquemaSalida: decisionCobros,
  });

  if (resultado.tipo !== 'ok' || resultado.salida === undefined) {
    throw new Error(
      `El puesto Cobros no devolvió una decisión válida: ${JSON.stringify(resultado)}`,
    );
  }
  return { obtenido: resultado.salida, cerrar: servidor.cerrar };
}

describe('caso dorado · Cobros', () => {
  let cerrar: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await cerrar?.();
    cerrar = undefined;
  });

  it('propone una nota de seguimiento para una factura vencida', async () => {
    const esperado: DecisionCobros = {
      proponerNota: true,
      motivo: 'Factura vencida hace más de 30 días sin pago registrado.',
    };
    const caso = casoDoradoEstructurado({
      id: 'cobros-001',
      puesto: 'Cobros',
      entrada: {
        numero: 'F-2026-014',
        cliente: 'Cliente de prueba',
        importeEuros: 1200,
        diasVencido: 45,
      },
      esperado,
    });
    const { obtenido, cerrar: cerrarServidor } = await decidirCobros(
      caso.entrada as FacturaVencida,
      esperado,
    );
    cerrar = cerrarServidor;

    const resultadoEval = evaluarCasoDoradoEstructurado(caso, obtenido);
    expect(resultadoEval.superado, resultadoEval.diagnostico).toBe(true);
  });

  it('no propone ninguna nota para una factura que todavía no ha vencido', async () => {
    const esperado: DecisionCobros = { proponerNota: false, motivo: 'La factura no está vencida.' };
    const caso = casoDoradoEstructurado({
      id: 'cobros-002',
      puesto: 'Cobros',
      entrada: {
        numero: 'F-2026-020',
        cliente: 'Cliente de prueba',
        importeEuros: 500,
        diasVencido: -5,
      },
      esperado,
    });
    const { obtenido, cerrar: cerrarServidor } = await decidirCobros(
      caso.entrada as FacturaVencida,
      esperado,
    );
    cerrar = cerrarServidor;

    const resultadoEval = evaluarCasoDoradoEstructurado(caso, obtenido);
    expect(resultadoEval.superado, resultadoEval.diagnostico).toBe(true);
  });
});
