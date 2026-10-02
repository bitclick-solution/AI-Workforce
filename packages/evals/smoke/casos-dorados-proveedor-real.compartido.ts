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
import type { PapelModelo, PlataformaModelo } from '@aiw/domain';
import { enrutadorDesdeEntorno, type ClienteDeMensajes, type PuertoEnrutado } from '@aiw/models';
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

/**
 * Enrutado de los dos puestos, tal como lo dicen sus plantillas certificadas
 * (`apps/platform-agents/src/catalogo/plantillas.json`; un paquete no importa una
 * aplicación, así que aquí se repite y lo vigila `siembra.test.ts` del trabajador).
 * Los casos dorados pasan por el mismo enrutador que el trabajador, no por el
 * adaptador suelto: lo que certifican es el enrutado de verdad.
 */
export const ENRUTADO_COBROS = { papel: 'sonnet5', papelRespaldo: 'haiku45' } as const;
export const ENRUTADO_CONCILIACION = { papel: 'opus5', papelRespaldo: 'sonnet5' } as const;

/**
 * El puerto de un puesto, resuelto por el enrutador del trabajador con el cliente
 * dado. Lo usan los casos contra el proveedor real y los evals de humo contra el
 * servidor simulado: el mismo camino, distinto cliente.
 */
export function puestoConCliente(
  cliente: ClienteDeMensajes,
  plataforma: PlataformaModelo,
  enrutado: { papel: PapelModelo; papelRespaldo: PapelModelo },
): PuertoEnrutado {
  const nombre = plataforma === 'vertex-eu' ? 'vertex-ue' : 'bedrock-ue';
  const enrutador = enrutadorDesdeEntorno(
    { AIW_PROVEEDOR_MODELOS: nombre },
    { clientes: { [nombre]: cliente } },
  );
  const paso = enrutador.resolverPaso(enrutado);
  if (paso.via !== 'puerto')
    throw new Error(`El enrutado ${JSON.stringify(enrutado)} no va por el puerto real.`);
  return paso.puerto;
}

function puestoEnrutado(
  proveedor: ProveedorRealCasosDorados,
  enrutado: { papel: PapelModelo; papelRespaldo: PapelModelo },
): PuertoEnrutado {
  return puestoConCliente(proveedor.crearCliente(), proveedor.plataforma, enrutado);
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
    it('sonnet5 (decision_escritura) propone una nota de seguimiento para una factura vencida hace 45 días', async () => {
      const puesto = puestoEnrutado(proveedor, ENRUTADO_COBROS);

      const { resultado } = await puesto.completar({
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

    it('sonnet5 (decision_escritura) no propone ninguna nota para una factura que todavía no ha vencido', async () => {
      const puesto = puestoEnrutado(proveedor, ENRUTADO_COBROS);

      const { resultado } = await puesto.completar({
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

    it('sonnet5 pide la herramienta y sigue en una segunda vuelta con su resultado (el turno con razonamiento vuelve al proveedor)', async () => {
      const puesto = puestoEnrutado(proveedor, ENRUTADO_COBROS);
      const herramientas = [
        {
          nombre: 'listar_facturas_vencidas',
          descripcion: 'Lee las facturas vencidas del ERP. Llámala siempre antes de decidir.',
          esquemaJson: {
            type: 'object',
            properties: { limite: { type: 'integer', minimum: 1, maximum: 50 } },
            required: [],
          },
        },
      ];
      const sistema =
        'Eres el puesto Cobros. Para revisar las facturas vencidas llama primero a listar_facturas_vencidas.';
      const encargo = { rol: 'user' as const, contenido: 'Revisa las facturas vencidas.' };

      const primera = await puesto.completar({
        clasePaso: 'negocio',
        sistema,
        cacheSistema: true,
        mensajes: [encargo],
        herramientas,
        maxTokens: 1024,
      });
      expect(primera.resultado.tipo).toBe('ok');
      if (primera.resultado.tipo !== 'ok') return;
      const llamada = primera.resultado.llamadasHerramientas?.[0];
      expect(llamada?.nombre).toBe('listar_facturas_vencidas');
      if (!llamada) return;

      const segunda = await puesto.completar({
        clasePaso: 'negocio',
        sistema,
        cacheSistema: true,
        mensajes: [
          encargo,
          {
            rol: 'assistant',
            contenido: primera.resultado.texto,
            llamadas: [{ id: llamada.id, nombre: llamada.nombre, entrada: llamada.entrada }],
            ...(primera.resultado.bloques ? { bloques: primera.resultado.bloques } : {}),
          },
          {
            rol: 'user',
            contenido: '',
            resultados: [
              {
                llamadaId: llamada.id,
                contenido: 'F-2026-014 · Cliente de prueba · 1200 € · vencida hace 45 días.',
              },
            ],
          },
        ],
        herramientas,
        maxTokens: 1024,
      });
      expect(segunda.resultado.tipo).toBe('ok');
    }, 60_000);
  });
}

const decisionConciliacion = z.object({
  facturaId: z.string().nullable(),
  conciliado: z.boolean(),
});

type DecisionConciliacion = z.infer<typeof decisionConciliacion>;

/** Qué hace el puesto con un apunte del extracto que no tiene documento o es una devolución. */
const decisionApunte = z.object({
  proponerAsiento: z.boolean(),
  escalar: z.boolean(),
});

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
    const puesto = puestoEnrutado(proveedor, ENRUTADO_CONCILIACION);

    const { resultado } = await puesto.completar({
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
    // `conciliacion-002` con proveedor real: el modelo recibe un apunte del extracto
    // y decide. Solo se compara lo categórico; el motivo de la escalada es texto libre.
    it.each([
      {
        etiqueta: 'devolucion',
        apunte: 'DEVOLUCION RECIBO CLIENTE DE PRUEBA, -318 €. Facturas candidatas: ninguna.',
      },
      {
        etiqueta: 'sin-documento',
        apunte: 'INGRESO SIN REFERENCIA, 77,77 €. Facturas candidatas: ninguna con ese importe.',
      },
    ])(
      'escala sin proponer asiento: $etiqueta',
      async ({ etiqueta, apunte }) => {
        const caso = casoDoradoEstructurado({
          id: `conciliacion-002-extracto-${etiqueta}-${proveedor.plataforma}-real`,
          puesto: 'Conciliación',
          entrada: { apunte },
          esperado: { proponerAsiento: false, escalar: true },
        });
        const { resultado } = await puestoEnrutado(proveedor, ENRUTADO_CONCILIACION).completar({
          clasePaso: 'conciliacion',
          sistema:
            'Eres el puesto Conciliación. Con un apunte del extracto decides si propones el asiento ' +
            'de diferencia o lo escalas a una persona. Sin documento, o con una devolución de ' +
            'recibo, nunca propones asiento: escalas.',
          mensajes: [{ rol: 'user', contenido: apunte }],
          esquemaSalida: decisionApunte,
          maxTokens: 512,
        });
        expect(resultado.tipo).toBe('ok');
        if (resultado.tipo !== 'ok' || resultado.salida === undefined) return;
        const resultadoEval = evaluarCasoDoradoEstructurado(caso, resultado.salida);
        expect(resultadoEval.superado, resultadoEval.diagnostico).toBe(true);
      },
      30_000,
    );
  });
}
