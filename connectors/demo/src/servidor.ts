/**
 * Servidor MCP de demostración: las dos herramientas de cobros sobre datos falsos.
 *
 * Es un servidor MCP de verdad, no un doble: habla el protocolo con el SDK oficial
 * y el gateway lo consume con un cliente MCP normal. Eso es deliberado. La prueba
 * técnica tiene que decir si MCP sostiene la frontera de herramientas, y un doble
 * de pruebas que devuelve objetos en memoria no responde a esa pregunta.
 *
 * Tres cosas que este servidor hace a propósito:
 *
 * 1. Clasifica sus herramientas con `annotations.readOnlyHint`, que es lo que lee
 *    el gateway para saber si un paso es lectura o escritura. La clasificación la
 *    declara el servidor y la aplica la plataforma; el modelo no vota.
 * 2. Exige la credencial al conectarse, no en los argumentos de cada llamada. Así
 *    el secreto vive en la conexión y no hay ninguna ruta por la que pueda acabar
 *    en un mensaje al modelo.
 * 3. Falla las primeras llamadas si se lo pides. Sin un fallo inyectable no hay
 *    forma de probar que la actividad reintenta con espera creciente.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { HOY_DEMO, buscarFactura, diasDeRetraso, facturasVencidas } from './datos.js';

export const NOMBRE_CONECTOR_DEMO = 'demo-cobros';

/** Nombre de la variable de entorno donde vive el secreto del conector. */
export const VARIABLE_SECRETO_DEMO = 'DEMO_CONECTOR_SECRETO';

/** Referencia del secreto tal como se guarda en `conector.referencia_secreto`. */
export const REFERENCIA_SECRETO_DEMO = `env:${VARIABLE_SECRETO_DEMO}`;

export const HERRAMIENTA_LISTAR = 'listar_facturas_vencidas';
export const HERRAMIENTA_NOTA = 'crear_nota_seguimiento';

export interface OpcionesServidorDemo {
  /**
   * Credencial que trae la conexión. El servidor la compara con la que espera y
   * rechaza la conexión si no cuadra: un conector mal configurado falla al
   * conectarse, no a mitad de una tarea.
   */
  credencial: string;
  /** Credencial válida. Sin valor, la del entorno; sin entorno, no se comprueba. */
  credencialEsperada?: string | undefined;
  /** Cuántas llamadas fallan antes de que la herramienta empiece a responder. */
  fallosIniciales?: number | undefined;
  /** Fecha con la que se calculan los vencimientos. Fija para que la CI no cambie. */
  hoy?: string | undefined;
}

/** Notas que el servidor ha guardado. La demostración las imprime al terminar. */
export interface NotaGuardada {
  factura: string;
  texto: string;
  creadaEn: number;
}

export interface ServidorDemo {
  servidor: McpServer;
  /** Notas escritas por `crear_nota_seguimiento`. Es el efecto que se aprueba. */
  readonly notas: readonly NotaGuardada[];
  /** Cuántas veces se ha llamado a cada herramienta, incluidos los fallos. */
  readonly llamadas: ReadonlyMap<string, number>;
}

export class CredencialDemoNoValida extends Error {
  constructor() {
    // El mensaje no incluye ni la credencial recibida ni la esperada: un error que
    // filtra el secreto es peor que el error que describe.
    super(
      'El conector de demostración rechaza la credencial: revisa ' +
        `${VARIABLE_SECRETO_DEMO} en el entorno del gateway.`,
    );
    this.name = 'CredencialDemoNoValida';
  }
}

/**
 * Monta el servidor. No lo conecta: el transporte lo elige quien lo usa —en
 * memoria para las pruebas y el gateway, por entrada y salida estándar para el
 * Compose de desarrollo—.
 */
export function crearServidorDemo(opciones: OpcionesServidorDemo): ServidorDemo {
  const esperada = opciones.credencialEsperada ?? process.env[VARIABLE_SECRETO_DEMO];
  if (esperada !== undefined && esperada !== '' && opciones.credencial !== esperada) {
    throw new CredencialDemoNoValida();
  }

  const hoy = opciones.hoy ?? HOY_DEMO;
  const notas: NotaGuardada[] = [];
  const llamadas = new Map<string, number>();
  let fallosPendientes = opciones.fallosIniciales ?? 0;

  function contarYFallarSiToca(herramienta: string): void {
    llamadas.set(herramienta, (llamadas.get(herramienta) ?? 0) + 1);
    if (fallosPendientes > 0) {
      fallosPendientes -= 1;
      throw new Error(
        `El conector de demostración falla a propósito (quedan ${fallosPendientes}): ` +
          'así se prueba el reintento con espera creciente.',
      );
    }
  }

  const servidor = new McpServer(
    { name: NOMBRE_CONECTOR_DEMO, version: '0.1.0' },
    {
      instructions:
        'Cartera de cobros de demostración con datos falsos. Mismas herramientas ' +
        'que el conector de Odoo.',
    },
  );

  servidor.registerTool(
    HERRAMIENTA_LISTAR,
    {
      title: 'Listar facturas vencidas',
      description:
        'Devuelve las facturas de venta cuya fecha de vencimiento ya pasó, con ' +
        'cliente, importe y días de retraso.',
      inputSchema: {},
      // Lo que el gateway lee para clasificar el paso como lectura.
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      _meta: { 'aiw.clase': 'lectura' },
    },
    () => {
      contarYFallarSiToca(HERRAMIENTA_LISTAR);
      const vencidas = facturasVencidas(hoy).map((factura) => ({
        numero: factura.numero,
        cliente: factura.cliente,
        importeEuros: factura.importeEuros,
        vence: factura.vence,
        diasDeRetraso: diasDeRetraso(factura, hoy),
      }));
      return { content: [{ type: 'text', text: JSON.stringify({ facturas: vencidas }) }] };
    },
  );

  servidor.registerTool(
    HERRAMIENTA_NOTA,
    {
      title: 'Crear nota de seguimiento',
      description:
        'Escribe una nota de seguimiento de cobro en la factura indicada. ' +
        'Modifica el sistema de gestión.',
      inputSchema: {
        factura: z.string().min(1).describe('Número de la factura, por ejemplo F-2026-0001.'),
        texto: z.string().min(1).describe('Texto de la nota, en el tono de la organización.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: { 'aiw.clase': 'escritura' },
    },
    ({ factura, texto }) => {
      contarYFallarSiToca(HERRAMIENTA_NOTA);
      if (!buscarFactura(factura)) {
        return {
          isError: true,
          content: [{ type: 'text', text: `No existe la factura ${factura}.` }],
        };
      }
      const nota: NotaGuardada = { factura, texto, creadaEn: notas.length + 1 };
      notas.push(nota);
      return {
        content: [
          { type: 'text', text: JSON.stringify({ factura, nota: nota.creadaEn, guardada: true }) },
        ],
      };
    },
  );

  return { servidor, notas, llamadas };
}
