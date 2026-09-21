/**
 * Las dos herramientas del conector.
 *
 * Contrato cerrado y estable encima de un MCP dinámico que expone el ERP
 * entero: eso es lo que el gateway puede autorizar por puesto y nivel, y lo
 * que el caso dorado puede evaluar. La lectura y la escritura son las mismas
 * que sirve `connectors/demo` en la prueba técnica del stack.
 */
import { HERRAMIENTAS_DINAMICAS, type ClienteMcpDinamico } from './cliente.js';
import { ErrorConector, traducirError } from './errores.js';
import {
  EntradaCrearNotaSeguimiento,
  EntradaListarFacturasVencidas,
  SalidaCrearNotaSeguimiento,
  SalidaListarFacturasVencidas,
  type EntradaNotaResuelta,
  type FacturaVencida,
  type SalidaListar,
  type SalidaNota,
} from './esquemas.js';
import {
  CAMPOS_FACTURA,
  aFactura,
  diasVencidaDeRegistro,
  leerCreadoEn,
  leerIdentificador,
  leerRegistros,
} from './mapeo.js';

export const NOMBRES = {
  listar: 'listar_facturas_vencidas',
  nota: 'crear_nota_seguimiento',
} as const;

/** Estados de cobro que dejan importe pendiente. Una factura pagada no se reclama. */
const PAGOS_PENDIENTES = ['not_paid', 'partial'] as const;

const MILISEGUNDOS_POR_DIA = 86_400_000;

/**
 * Memoria de claves de idempotencia.
 *
 * Vive en el proceso: basta para que un reintento de la misma llamada no cree
 * dos notas. La idempotencia duradera entre reinicios es del flujo de Temporal
 * y del gateway, que ya llevan clave por paso; queda fuera de esta rebanada.
 */
export interface AlmacenIdempotencia {
  leer(clave: string): SalidaNota | undefined;
  guardar(clave: string, salida: SalidaNota): void;
}

export function almacenEnMemoria(maximo = 1000): AlmacenIdempotencia {
  const notas = new Map<string, SalidaNota>();
  return {
    leer: (clave) => notas.get(clave),
    guardar: (clave, salida) => {
      if (notas.size >= maximo) {
        const primera = notas.keys().next();
        if (!primera.done) notas.delete(primera.value);
      }
      notas.set(clave, salida);
    },
  };
}

export interface OpcionesHerramientas {
  readonly cliente: ClienteMcpDinamico;
  /** Reloj inyectable: las pruebas fijan el día y el mapeo calcula días vencida. */
  readonly ahora?: () => Date;
  readonly almacen?: AlmacenIdempotencia;
}

export interface Herramientas {
  listarFacturasVencidas(entrada: unknown): Promise<SalidaListar>;
  crearNotaSeguimiento(entrada: unknown): Promise<SalidaNota>;
}

/** Fecha de corte: una factura con vencimiento anterior o igual lleva al menos esos días. */
export function fechaDeCorte(ahora: Date, dias: number): string {
  const hoy = Date.parse(`${ahora.toISOString().slice(0, 10)}T00:00:00.000Z`);
  return new Date(hoy - dias * MILISEGUNDOS_POR_DIA).toISOString().slice(0, 10);
}

function validar<T>(
  esquema: { safeParse(valor: unknown): { success: boolean; data?: T; error?: unknown } },
  entrada: unknown,
  herramienta: string,
): T {
  const resultado = esquema.safeParse(entrada);
  if (!resultado.success || resultado.data === undefined) {
    const error = resultado.error;
    const detalle =
      error instanceof Error
        ? error.message.replace(/\s+/g, ' ').slice(0, 500)
        : 'no encaja con el esquema';
    throw new ErrorConector('invalido', `Entrada inválida para «${herramienta}»: ${detalle}`);
  }
  return resultado.data;
}

function extraerAprobacion(carga: unknown): Record<string, unknown> {
  if (typeof carga === 'object' && carga !== null) {
    const objeto = carga as Record<string, unknown>;
    for (const clave of ['approval_id', 'approval_token', 'token', 'id'] as const) {
      const valor = objeto[clave];
      if (typeof valor === 'string' || typeof valor === 'number') return { approval_id: valor };
    }
    const anidada = objeto['approval'] ?? objeto['approval_status'] ?? objeto['data'];
    if (anidada !== undefined && anidada !== objeto) return extraerAprobacion(anidada);
  }
  throw new ErrorConector(
    'invalido',
    'El MCP dinámico no devolvió aprobación para la escritura: la actividad no se crea sin ella.',
  );
}

export function crearHerramientas(opciones: OpcionesHerramientas): Herramientas {
  const { cliente } = opciones;
  const ahora = opciones.ahora ?? (() => new Date());
  const almacen = opciones.almacen ?? almacenEnMemoria();

  async function listarFacturasVencidas(entrada: unknown): Promise<SalidaListar> {
    const argumentos = validar(EntradaListarFacturasVencidas, entrada ?? {}, NOMBRES.listar);
    // Una factura que vence hoy no está vencida: el mínimo real es un día.
    const umbral = Math.max(1, argumentos.dias_vencida_minimo);
    const momento = ahora();
    try {
      const carga = await cliente.llamar(HERRAMIENTAS_DINAMICAS.buscar, {
        model: 'account.move',
        domain: [
          ['move_type', '=', 'out_invoice'],
          ['state', '=', 'posted'],
          ['payment_state', 'in', [...PAGOS_PENDIENTES]],
          ['invoice_date_due', '<=', fechaDeCorte(momento, umbral)],
        ],
        fields: [...CAMPOS_FACTURA],
        limit: argumentos.limite,
        order: 'invoice_date_due asc',
      });
      const facturas: FacturaVencida[] = leerRegistros(carga)
        .filter((registro) => diasVencidaDeRegistro(registro, momento) >= umbral)
        .map((registro) => aFactura(registro, momento))
        .sort(
          (una, otra) =>
            otra.dias_vencida - una.dias_vencida ||
            otra.importe_pendiente - una.importe_pendiente ||
            una.id - otra.id,
        )
        .slice(0, argumentos.limite);
      return SalidaListarFacturasVencidas.parse({ facturas, total: facturas.length });
    } catch (error) {
      throw traducirError(error, 'No se pudieron leer las facturas vencidas');
    }
  }

  async function anotarEnHistorial(
    argumentos: EntradaNotaResuelta,
    momento: Date,
  ): Promise<SalidaNota> {
    const carga = await cliente.llamar(HERRAMIENTAS_DINAMICAS.notaEnHistorial, {
      model: 'account.move',
      res_id: argumentos.factura_id,
      body: argumentos.texto,
      message_type: 'comment',
      subtype_xmlid: 'mail.mt_note',
    });
    return {
      id: leerIdentificador(carga),
      factura_id: argumentos.factura_id,
      tipo: 'nota',
      creado_en: leerCreadoEn(carga, momento),
    };
  }

  async function crearActividad(
    argumentos: EntradaNotaResuelta,
    momento: Date,
  ): Promise<SalidaNota> {
    const escritura = {
      model: 'mail.activity',
      operation: 'create',
      values: {
        res_model: 'account.move',
        res_id: argumentos.factura_id,
        summary: argumentos.texto.slice(0, 80),
        note: argumentos.texto,
        ...(argumentos.fecha_limite === undefined
          ? {}
          : { date_deadline: argumentos.fecha_limite }),
      },
    };
    // La puerta de escritura del MCP dinámico: preparar, validar y ejecutar.
    await cliente.llamar(HERRAMIENTAS_DINAMICAS.prepararEscritura, escritura);
    const validada = await cliente.llamar(HERRAMIENTAS_DINAMICAS.validarEscritura, escritura);
    const carga = await cliente.llamar(HERRAMIENTAS_DINAMICAS.ejecutarEscritura, {
      ...extraerAprobacion(validada),
      confirm: true,
    });
    return {
      id: leerIdentificador(carga),
      factura_id: argumentos.factura_id,
      tipo: 'actividad',
      creado_en: leerCreadoEn(carga, momento),
    };
  }

  async function crearNotaSeguimiento(entrada: unknown): Promise<SalidaNota> {
    const argumentos = validar(EntradaCrearNotaSeguimiento, entrada, NOMBRES.nota);
    const clave = argumentos.clave_idempotencia;
    if (clave !== undefined) {
      const ya = almacen.leer(clave);
      if (ya !== undefined) return ya;
    }
    const momento = ahora();
    try {
      const salida = SalidaCrearNotaSeguimiento.parse(
        argumentos.tipo === 'actividad'
          ? await crearActividad(argumentos, momento)
          : await anotarEnHistorial(argumentos, momento),
      );
      if (clave !== undefined) almacen.guardar(clave, salida);
      return salida;
    } catch (error) {
      throw traducirError(error, 'No se pudo crear la nota de seguimiento');
    }
  }

  return { listarFacturasVencidas, crearNotaSeguimiento };
}
