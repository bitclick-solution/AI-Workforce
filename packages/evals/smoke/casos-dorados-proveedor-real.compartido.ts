/**
 * Cuerpo compartido de los casos dorados de Cobros y de Conciliación contra un
 * proveedor real (Vertex UE o Bedrock UE, ADR-017/ADR-023). Cada proveedor solo
 * aporta el nombre, la condición de disponibilidad, el cliente y la plataforma;
 * las peticiones, los esquemas y las comprobaciones son los mismos para no
 * duplicar el caso entre proveedores (rebanada «Casos dorados de Cobros y
 * Conciliación contra Bedrock UE en el job semanal», criterio de hecho 4).
 *
 * Con `motivo` de Cobros, un modelo real redacta texto libre que nunca va a
 * coincidir cadena a cadena con el caso dorado del eval de humo determinista:
 * por eso aquí solo se exige lo observable y verificable de una decisión de
 * negocio (la decisión coincide con la esperada, el motivo es una frase no
 * vacía que cumple el esquema estricto), igual que ya hacía la prueba de
 * Vertex. Conciliación es enteramente categórica (`facturaId`, `conciliado`),
 * así que sigue comparando por igualdad exacta con `evaluarCasoDoradoEstructurado`.
 */
import { crearAdaptadorAnthropic, type ClienteDeMensajes } from '@aiw/models';
import type { PlataformaModelo } from '@aiw/domain';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { casoDoradoEstructurado, evaluarCasoDoradoEstructurado } from '../src/index.js';

export interface ProveedorRealCasosDorados {
  /** Nombre del proveedor tal como debe aparecer en el título de la suite, p.ej. "Vertex UE real". */
  nombre: string;
  /** Falso si faltan las credenciales o variables del proveedor: la suite entera se salta. */
  disponible: boolean;
  /** Motivo del salto, para el título de la suite cuando `disponible` es falso. */
  motivoSalto: string;
  crearCliente: () => ClienteDeMensajes;
  plataforma: PlataformaModelo;
}

const decisionCobros = z.object({
  proponerNota: z.boolean(),
  motivo: z.string().min(1),
});

export function registrarCasoDoradoCobros(proveedor: ProveedorRealCasosDorados): void {
  const titulo = proveedor.disponible
    ? `caso dorado · Cobros · ${proveedor.nombre}`
    : `caso dorado · Cobros · ${proveedor.nombre} — SALTADO. ${proveedor.motivoSalto}`;

  describe.skipIf(!proveedor.disponible)(titulo, () => {
    it('opus5 (decision_escritura) propone una nota de seguimiento para una factura vencida hace 45 días', async () => {
      const puesto = crearAdaptadorAnthropic(proveedor.crearCliente(), {
        papel: 'opus5',
        plataforma: proveedor.plataforma,
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
      const puesto = crearAdaptadorAnthropic(proveedor.crearCliente(), {
        papel: 'opus5',
        plataforma: proveedor.plataforma,
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
}

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

export function registrarCasoDoradoConciliacion(proveedor: ProveedorRealCasosDorados): void {
  const titulo = proveedor.disponible
    ? `caso dorado · Conciliación · ${proveedor.nombre}`
    : `caso dorado · Conciliación · ${proveedor.nombre} — SALTADO. ${proveedor.motivoSalto}`;

  async function decidirConciliacion(
    movimiento: MovimientoBancario,
  ): Promise<DecisionConciliacion> {
    const puesto = crearAdaptadorAnthropic(proveedor.crearCliente(), {
      papel: 'opus5',
      plataforma: proveedor.plataforma,
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

  describe.skipIf(!proveedor.disponible)(titulo, () => {
    it('concilia el movimiento con la factura del mismo importe', async () => {
      const caso = casoDoradoEstructurado({
        id: `conciliacion-001-${proveedor.plataforma}-real`,
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
        id: `conciliacion-002-${proveedor.plataforma}-real`,
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
}
