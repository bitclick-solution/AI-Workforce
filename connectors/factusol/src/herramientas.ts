/**
 * Las dos herramientas del conector.
 *
 * Mismo contrato que `connectors/odoo` y `connectors/demo`, hablado contra Factusol
 * MCP 3.4.7. El mapeo y sus decisiones están en «Mapeo con Factusol MCP 3.4.7» de
 * `docs/specs/conector-factusol-v0.md`.
 */
import { HERRAMIENTAS_FACTUSOL, type ClienteFactusol } from './cliente.js';
import {
  almacenDeBorradoresEnMemoria,
  type AlmacenDeBorradores,
  type BorradorGuardado,
} from './almacen-borradores.js';
import {
  leerBorrador,
  leerCambios,
  leerEstado,
  leerIdDeBorrador,
  type BorradorLeido,
} from './borrador.js';
import {
  confirmacionPorPersona,
  observacionesTrasAnotar,
  type ConfirmadorDeBorrador,
} from './confirmacion.js';
import { registrar as registrarPorDefecto } from './entorno.js';
import { ErrorConector, recortarDetalle, traducirError } from './errores.js';
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
  analizarCliente,
  analizarDetalleDeFactura,
  analizarListaDeFacturas,
  esNoEncontrado,
  type FacturaDeLista,
} from './markdown.js';

export const NOMBRES = {
  listar: 'listar_facturas_vencidas',
  nota: 'crear_nota_seguimiento',
} as const;

const MILISEGUNDOS_POR_DIA = 86_400_000;

/** Lo que se pide a Factusol: el máximo del contrato, porque el recorte se hace después de filtrar. */
const LECTURA_MAXIMA = 200;

/**
 * Deriva el vencimiento de una factura desde la forma de pago y la fecha.
 *
 * El informe del Probador no documenta la forma de `get_formas_de_pago` ni dónde
 * aparece la forma de pago de una factura, así que la implementación por defecto
 * no deriva nada y la factura no se devuelve. Cuando el Probador aporte las formas
 * exactas, se sustituye esta implementación sin tocar el resto.
 */
export interface ResolutorDeVencimiento {
  derivar(factura: FacturaDeLista): Promise<string | undefined>;
}

export const sinVencimiento: ResolutorDeVencimiento = {
  derivar: () => Promise.resolve(undefined),
};

/** Lo guardado bajo una clave: la nota y la huella de los datos que la crearon. */
export interface NotaIdempotente {
  readonly huella: string;
  readonly salida: SalidaNota;
}

/**
 * Memoria de claves de idempotencia.
 *
 * Vive en el proceso: basta para que un reintento de la misma llamada no cree
 * dos notas. La idempotencia duradera entre reinicios es del flujo de Temporal
 * y del gateway, que ya llevan clave por paso; queda fuera de esta rebanada.
 */
export interface AlmacenIdempotencia {
  leer(clave: string): NotaIdempotente | undefined;
  guardar(clave: string, nota: NotaIdempotente): void;
}

/** Claves que caben en memoria antes de empezar a olvidar las más viejas. */
export const CLAVES_EN_MEMORIA = 1000;

/**
 * Almacén en memoria con tope y expulsión de la clave más antigua.
 *
 * El tope evita que un proceso largo acumule claves sin fin. Al pasarlo, la
 * clave más vieja se olvida: una repetición suya volvería a escribir en el
 * ERP. Con el volumen de cobros de un tenant no se alcanza, y la garantía
 * duradera es del flujo, no de este almacén.
 */
export function almacenEnMemoria(maximo = CLAVES_EN_MEMORIA): AlmacenIdempotencia {
  const notas = new Map<string, NotaIdempotente>();
  return {
    leer: (clave) => notas.get(clave),
    guardar: (clave, nota) => {
      if (notas.size >= maximo) {
        const primera = notas.keys().next();
        if (!primera.done) notas.delete(primera.value);
      }
      notas.set(clave, nota);
    },
  };
}

/** Los datos que hacen única a una nota: si cambian, la clave no vale para las dos. */
export function huellaDeNota(argumentos: EntradaNotaResuelta): string {
  return JSON.stringify([
    argumentos.factura_id,
    argumentos.tipo,
    argumentos.texto,
    argumentos.fecha_limite ?? null,
  ]);
}

export interface OpcionesHerramientas {
  readonly cliente: ClienteFactusol;
  /** Reloj inyectable: las pruebas fijan el día y el mapeo calcula días vencida. */
  readonly ahora?: () => Date;
  readonly almacen?: AlmacenIdempotencia;
  readonly vencimiento?: ResolutorDeVencimiento;
  readonly confirmador?: ConfirmadorDeBorrador;
  /** Borrador pendiente por clave: con él, una reanudación no crea un segundo borrador. */
  readonly borradores?: AlmacenDeBorradores;
  /** Registro del conector: solo recuentos, nunca datos de facturas ni credenciales. */
  readonly registrar?: (mensaje: string) => void;
}

export interface Herramientas {
  listarFacturasVencidas(entrada: unknown): Promise<SalidaListar>;
  crearNotaSeguimiento(entrada: unknown): Promise<SalidaNota>;
}

/** Días completos entre el vencimiento y hoy, contados en UTC. */
export function diasVencida(fechaVencimiento: string, ahora: Date): number {
  const vencimiento = Date.parse(`${fechaVencimiento}T00:00:00.000Z`);
  const hoy = Date.parse(`${ahora.toISOString().slice(0, 10)}T00:00:00.000Z`);
  return Math.floor((hoy - vencimiento) / MILISEGUNDOS_POR_DIA);
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

/** Una factura es `SERIE-NNNNNN`; cualquier otra cosa no llega a Factusol. */
function separarFactura(id: string): { serie: string; numero: number } {
  const coincide = /^([A-Za-z0-9]+)-(\d+)$/.exec(id);
  if (coincide === null) {
    throw new ErrorConector('invalido', 'factura_id va como SERIE-NÚMERO, por ejemplo 1-000123.');
  }
  return { serie: coincide[1] ?? '', numero: Number(coincide[2]) };
}

export function lineaDeObservacion(argumentos: EntradaNotaResuelta, ahora: Date): string {
  const dia = ahora.toISOString().slice(0, 10);
  const limite =
    argumentos.fecha_limite === undefined ? '' : ` (Fecha límite: ${argumentos.fecha_limite})`;
  return `[${dia}] ${argumentos.texto}${limite}`;
}

export function crearHerramientas(opciones: OpcionesHerramientas): Herramientas {
  const { cliente } = opciones;
  const ahora = opciones.ahora ?? (() => new Date());
  const almacen = opciones.almacen ?? almacenEnMemoria();
  const vencimiento = opciones.vencimiento ?? sinVencimiento;
  const confirmador = opciones.confirmador ?? confirmacionPorPersona(cliente);
  const borradores = opciones.borradores ?? almacenDeBorradoresEnMemoria();
  const registrar = opciones.registrar ?? ((mensaje: string) => registrarPorDefecto(mensaje));
  /** Escrituras en vuelo por clave de idempotencia, para las llamadas simultáneas. */
  const enCurso = new Map<string, { huella: string; promesa: Promise<SalidaNota> }>();

  async function texto(herramienta: string, argumentos: Record<string, unknown>): Promise<string> {
    const { texto: cuerpo } = await cliente.llamar(herramienta, argumentos);
    if (esNoEncontrado(cuerpo)) {
      throw new ErrorConector(
        'no_encontrada',
        `Factusol MCP no encuentra lo pedido: ${recortarDetalle(cuerpo)}`,
      );
    }
    return cuerpo;
  }

  async function codigoDeCliente(nif: string, memoria: Map<string, string>): Promise<string> {
    const guardado = memoria.get(nif);
    if (guardado !== undefined) return guardado;
    const ficha = analizarCliente(
      await texto(HERRAMIENTAS_FACTUSOL.cliente, { termino_busqueda: nif }),
      nif,
    );
    memoria.set(nif, ficha.codigo);
    return ficha.codigo;
  }

  async function listarFacturasVencidas(entrada: unknown): Promise<SalidaListar> {
    const argumentos = validar(EntradaListarFacturasVencidas, entrada ?? {}, NOMBRES.listar);
    // Una factura que vence hoy no está vencida: el mínimo real es un día.
    const umbral = Math.max(1, argumentos.dias_vencida_minimo);
    const momento = ahora();
    try {
      const pendientes = analizarListaDeFacturas(
        await texto(HERRAMIENTAS_FACTUSOL.listarFacturas, {
          estado: 'pendiente',
          limite: LECTURA_MAXIMA,
        }),
      ).filter((factura) => factura.estado === 'pendiente');

      let sinVencimientoCuenta = 0;
      const vencidas: { factura: FacturaDeLista; vence: string; dias: number }[] = [];
      for (const factura of pendientes) {
        const vence = await vencimiento.derivar(factura);
        if (vence === undefined) {
          sinVencimientoCuenta += 1;
          continue;
        }
        const dias = diasVencida(vence, momento);
        if (dias >= umbral) vencidas.push({ factura, vence, dias });
      }
      vencidas.sort(
        (una, otra) =>
          otra.dias - una.dias ||
          otra.factura.total - una.factura.total ||
          una.factura.id.localeCompare(otra.factura.id),
      );

      const facturas: FacturaVencida[] = [];
      let conCobrosParciales = 0;
      const codigos = new Map<string, string>();
      for (const { factura, vence, dias } of vencidas) {
        if (facturas.length >= argumentos.limite) break;
        const detalle = analizarDetalleDeFactura(
          await texto(HERRAMIENTAS_FACTUSOL.factura, {
            serie: factura.serie,
            numero: factura.numero,
          }),
        );
        if (!detalle.sinCobros) {
          conCobrosParciales += 1;
          continue;
        }
        facturas.push({
          id: factura.id,
          numero: factura.id,
          cliente: {
            id: await codigoDeCliente(factura.clienteNif, codigos),
            nombre: factura.clienteNombre,
          },
          importe_pendiente: factura.total,
          moneda: 'EUR',
          fecha_emision: factura.fecha,
          fecha_vencimiento: vence,
          dias_vencida: dias,
        });
      }
      registrar(
        `listar_facturas_vencidas: pendientes=${String(pendientes.length)} ` +
          `facturas_sin_vencimiento=${String(sinVencimientoCuenta)} ` +
          `con_cobros_sin_importe=${String(conCobrosParciales)} ` +
          `devueltas=${String(facturas.length)}` +
          (pendientes.length >= LECTURA_MAXIMA ? ' posible_truncado=1' : ''),
      );
      return SalidaListarFacturasVencidas.parse({ facturas, total: facturas.length });
    } catch (error) {
      throw traducirError(error, 'No se pudieron leer las facturas vencidas');
    }
  }

  function salidaDe(
    argumentos: EntradaNotaResuelta,
    draftId: string,
    creadoEn: string,
  ): SalidaNota {
    return SalidaCrearNotaSeguimiento.parse({
      id: draftId,
      factura_id: argumentos.factura_id,
      tipo: argumentos.tipo,
      creado_en: creadoEn,
    });
  }

  /**
   * Reanudación tras una caída entre el borrador y la confirmación: consulta el estado
   * del borrador guardado para esa clave. Devuelve la nota si ya está escrita; `undefined`
   * si hay que seguir creando uno nuevo (caducó, se canceló o no se puede comprobar).
   */
  async function reanudar(
    argumentos: EntradaNotaResuelta,
    previo: BorradorGuardado,
    clave: string,
  ): Promise<SalidaNota | undefined> {
    const estado = leerEstado(
      (await cliente.llamar(HERRAMIENTAS_FACTUSOL.estadoBorrador, { draft_id: previo.draftId }))
        .estructurado,
    );
    if (estado.estado === 'ejecutado') return salidaDe(argumentos, previo.draftId, previo.creadoEn);
    if (estado.estado === 'pendiente') {
      // Sigue vivo: se confirma ese mismo, si su diff se puede comprobar. Sin diff
      // legible se cancela y se crea uno nuevo, que es el único caso de un segundo borrador.
      const cambios = estado.cambios.size > 0 ? estado.cambios : undefined;
      if (cambios !== undefined) {
        await confirmador.alCrearBorrador({
          draftId: previo.draftId,
          clienteCodigo: previo.clienteCodigo,
          facturaId: argumentos.factura_id,
          observaciones: previo.observaciones,
          linea: previo.linea,
          cambios,
        });
        return salidaDe(argumentos, previo.draftId, previo.creadoEn);
      }
      await confirmador.cancelar(previo.draftId).catch(() => undefined);
    }
    await borradores.borrar(clave);
    return undefined;
  }

  /** Un borrador con una forma que no se entiende se cancela si se puede identificar: no queda pendiente. */
  async function leerOCancelar(estructurado: unknown): Promise<BorradorLeido> {
    try {
      return leerBorrador(estructurado);
    } catch (error) {
      const id = leerIdDeBorrador(estructurado);
      if (id !== undefined) await confirmador.cancelar(id).catch(() => undefined);
      throw error;
    }
  }

  async function escribir(argumentos: EntradaNotaResuelta): Promise<SalidaNota> {
    const momento = ahora();
    try {
      // Sin lo necesario para confirmar, la escritura falla aquí y no deja borrador.
      confirmador.antesDeEscribir();
      const clave = argumentos.clave_idempotencia;
      const huella = huellaDeNota(argumentos);
      if (clave !== undefined) {
        const previo = await borradores.leer(clave);
        if (previo !== undefined) {
          comprobarHuella(previo.huella, huella, clave);
          const hecha = await reanudar(argumentos, previo, clave);
          if (hecha !== undefined) return hecha;
        }
      }

      const { serie, numero } = separarFactura(argumentos.factura_id);
      const detalle = analizarDetalleDeFactura(
        await texto(HERRAMIENTAS_FACTUSOL.factura, { serie, numero }),
      );
      const codigo = await codigoDeCliente(detalle.clienteNif, new Map());
      const linea = lineaDeObservacion(argumentos, momento);

      // `get_cliente` no devuelve `observaciones`: el valor actual solo se lee del diff de
      // un borrador. El primero es de sondeo y se cancela; el definitivo lleva lo que había
      // más la línea nueva, para no borrar nunca nada.
      const sondeo = await cliente.llamar(HERRAMIENTAS_FACTUSOL.borradorCliente, {
        cliente: codigo,
        observaciones: linea,
      });
      const leido = await leerOCancelar(sondeo.estructurado);
      await confirmador.cancelar(leido.draftId);

      const observaciones = observacionesTrasAnotar(leido.observacionesActuales, linea);
      const definitivo = await cliente.llamar(HERRAMIENTAS_FACTUSOL.borradorCliente, {
        cliente: codigo,
        observaciones,
      });
      const borrador = await leerOCancelar(definitivo.estructurado);
      if (clave !== undefined) {
        await borradores.guardar(clave, {
          huella,
          draftId: borrador.draftId,
          clienteCodigo: codigo,
          observaciones,
          linea,
          creadoEn: momento.toISOString(),
        });
      }
      await confirmador.alCrearBorrador({
        draftId: borrador.draftId,
        clienteCodigo: codigo,
        facturaId: argumentos.factura_id,
        observaciones,
        linea,
        cambios: leerCambios(definitivo.estructurado),
      });
      return salidaDe(argumentos, borrador.draftId, momento.toISOString());
    } catch (error) {
      throw traducirError(error, 'No se pudo crear la nota de seguimiento');
    }
  }

  /** La misma clave con otros datos es un error del que llama, no una repetición. */
  function comprobarHuella(guardada: string, actual: string, clave: string): void {
    if (guardada === actual) return;
    throw new ErrorConector(
      'invalido',
      `La clave de idempotencia «${clave}» ya se usó para otra nota. Usa una clave nueva o repite los mismos datos.`,
    );
  }

  async function crearNotaSeguimiento(entrada: unknown): Promise<SalidaNota> {
    const argumentos = validar(EntradaCrearNotaSeguimiento, entrada, NOMBRES.nota);
    const clave = argumentos.clave_idempotencia;
    if (clave === undefined) return escribir(argumentos);

    const huella = huellaDeNota(argumentos);
    const guardada = almacen.leer(clave);
    if (guardada !== undefined) {
      comprobarHuella(guardada.huella, huella, clave);
      return guardada.salida;
    }
    // La escritura en vuelo se registra antes del primer `await`: dos llamadas a
    // la vez con la misma clave esperan a la misma promesa y el ERP se escribe
    // una sola vez.
    const enVuelo = enCurso.get(clave);
    if (enVuelo !== undefined) {
      comprobarHuella(enVuelo.huella, huella, clave);
      return enVuelo.promesa;
    }
    const promesa = escribir(argumentos);
    enCurso.set(clave, { huella, promesa });
    try {
      const salida = await promesa;
      almacen.guardar(clave, { huella, salida });
      return salida;
    } finally {
      enCurso.delete(clave);
    }
  }

  return { listarFacturasVencidas, crearNotaSeguimiento };
}
