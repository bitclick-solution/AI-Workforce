/**
 * Las dos herramientas del conector.
 *
 * Mismo contrato que `connectors/odoo` y `connectors/demo`, hablado contra Factusol
 * MCP 3.4.7. El mapeo y sus decisiones están en «Mapeo con Factusol MCP 3.4.7» de
 * `docs/specs/conector-factusol-v0.md`.
 */
import { HERRAMIENTAS_FACTUSOL, type ClienteFactusol } from './cliente.js';
import { elegirConfirmador, type ConfirmadorDeBorrador } from './confirmacion.js';
import { leerBorrador } from './borrador.js';
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
import { resolutorPorFormaDePago, type ResolutorDeVencimiento } from './vencimiento.js';

export const NOMBRES = {
  listar: 'listar_facturas_vencidas',
  nota: 'crear_nota_seguimiento',
} as const;

const MILISEGUNDOS_POR_DIA = 86_400_000;

/** Lo que se pide a Factusol: el máximo del contrato, porque el recorte se hace después de filtrar. */
const LECTURA_MAXIMA = 200;

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
  const confirmador = opciones.confirmador ?? elegirConfirmador('A');
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
    const resolutor: ResolutorDeVencimiento =
      opciones.vencimiento ??
      resolutorPorFormaDePago(() => texto(HERRAMIENTAS_FACTUSOL.formasDePago, {}));
    try {
      // `pendiente` y `parcial` son filtros distintos de `estado`: una parcial vuelve como
      // «pendiente parcial». Se piden las dos y se unen por identificador.
      const unidas = new Map<string, FacturaDeLista>();
      let posibleTruncado = false;
      for (const estado of ['pendiente', 'parcial']) {
        const lista = analizarListaDeFacturas(
          await texto(HERRAMIENTAS_FACTUSOL.listarFacturas, { estado, limite: LECTURA_MAXIMA }),
        );
        posibleTruncado ||= lista.length >= LECTURA_MAXIMA;
        for (const factura of lista) {
          if (factura.estado.startsWith('pendiente')) unidas.set(factura.id, factura);
        }
      }
      const pendientes = [...unidas.values()];

      const cuentas = { sinVencimiento: 0, cobrosSinImporte: 0, conAbonos: 0, sinImporte: 0 };
      const vencidas: { factura: FacturaDeLista; vence: string; dias: number; importe: number }[] =
        [];
      for (const factura of pendientes) {
        // El vencimiento nunca es anterior a la fecha: si ni así llega al umbral, no se mira.
        if (diasVencida(factura.fecha, momento) < umbral) continue;
        const detalle = analizarDetalleDeFactura(
          await texto(HERRAMIENTAS_FACTUSOL.factura, {
            serie: factura.serie,
            numero: factura.numero,
          }),
        );
        const vence = await resolutor.derivar(detalle);
        if (vence === undefined) {
          cuentas.sinVencimiento += 1;
          continue;
        }
        const dias = diasVencida(vence, momento);
        if (dias < umbral) continue;
        // Los importes de la factura no restan abonos: con alguno, o sin la sección, el
        // pendiente no es fiable y no se devuelve.
        if (detalle.abonos !== 'ninguno') {
          cuentas.conAbonos += 1;
          continue;
        }
        if (detalle.cobros.tipo === 'ilegible') {
          cuentas.cobrosSinImporte += 1;
          continue;
        }
        const cobrado = detalle.cobros.tipo === 'importe' ? detalle.cobros.total : 0;
        const importe = Math.round((detalle.total - cobrado) * 100) / 100;
        if (importe <= 0) {
          cuentas.sinImporte += 1;
          continue;
        }
        vencidas.push({ factura: detalle, vence, dias, importe });
      }
      vencidas.sort(
        (una, otra) =>
          otra.dias - una.dias ||
          otra.importe - una.importe ||
          una.factura.id.localeCompare(otra.factura.id),
      );

      const facturas: FacturaVencida[] = [];
      const codigos = new Map<string, string>();
      for (const { factura, vence, dias, importe } of vencidas.slice(0, argumentos.limite)) {
        facturas.push({
          id: factura.id,
          numero: factura.id,
          cliente: {
            id: await codigoDeCliente(factura.clienteNif, codigos),
            nombre: factura.clienteNombre,
          },
          importe_pendiente: importe,
          moneda: 'EUR',
          fecha_emision: factura.fecha,
          fecha_vencimiento: vence,
          dias_vencida: dias,
        });
      }
      registrar(
        `listar_facturas_vencidas: pendientes=${String(pendientes.length)} ` +
          `facturas_sin_vencimiento=${String(cuentas.sinVencimiento)} ` +
          `con_abonos=${String(cuentas.conAbonos)} ` +
          `con_cobros_ilegibles=${String(cuentas.cobrosSinImporte)} ` +
          `sin_importe_pendiente=${String(cuentas.sinImporte)} ` +
          `devueltas=${String(facturas.length)}` +
          (posibleTruncado ? ' posible_truncado=1' : ''),
      );
      return SalidaListarFacturasVencidas.parse({ facturas, total: facturas.length });
    } catch (error) {
      throw traducirError(error, 'No se pudieron leer las facturas vencidas');
    }
  }

  async function escribir(argumentos: EntradaNotaResuelta): Promise<SalidaNota> {
    const momento = ahora();
    try {
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
      const leido = leerBorrador(sondeo.estructurado);
      await cliente.llamar(HERRAMIENTAS_FACTUSOL.cancelarBorrador, { draft_id: leido.draftId });

      const observaciones =
        leido.observacionesActuales.trim() === ''
          ? linea
          : `${leido.observacionesActuales.replace(/\s+$/, '')}\n${linea}`;
      const definitivo = await cliente.llamar(HERRAMIENTAS_FACTUSOL.borradorCliente, {
        cliente: codigo,
        observaciones,
      });
      const borrador = leerBorrador(definitivo.estructurado);
      await confirmador.alCrearBorrador({
        draftId: borrador.draftId,
        clienteCodigo: codigo,
        facturaId: argumentos.factura_id,
        observaciones,
      });
      return SalidaCrearNotaSeguimiento.parse({
        id: borrador.draftId,
        factura_id: argumentos.factura_id,
        tipo: argumentos.tipo,
        creado_en: momento.toISOString(),
      });
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
