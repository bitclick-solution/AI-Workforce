/**
 * Único módulo que analiza el Markdown de Factusol MCP.
 *
 * Todas las respuestas del servidor son texto Markdown: `structuredContent.result`
 * repite el mismo texto y no hay JSON de datos. Las formas que se aceptan son las
 * del informe del Probador (1-10) y nada más; lo que no encaja devuelve un error
 * `invalido` con el motivo. Nunca sale un dato a medias.
 */
import { ErrorConector } from './errores.js';
import { FechaCalendario } from './esquemas.js';

export interface FacturaDeLista {
  /** `SERIE-NNNNNN`, tal como la imprime el informe. */
  readonly id: string;
  readonly serie: string;
  readonly numero: number;
  readonly clienteNombre: string;
  readonly clienteNif: string;
  readonly fecha: string;
  readonly estado: string;
  readonly total: number;
}

export interface FormaDePago {
  readonly codigo: string;
  /** Sin nombre configurado, Factusol MCP escribe solo el código. */
  readonly nombre?: string;
}

/** Cobros de una factura: ninguno, un total legible o algo que el adaptador no sabe sumar. */
export type CobrosDeFactura =
  | { readonly tipo: 'ninguno' }
  | { readonly tipo: 'importe'; readonly total: number }
  | { readonly tipo: 'ilegible' };

export interface DetalleDeFactura extends FacturaDeLista {
  /** `- Forma de pago: COD · NOMBRE`. Ausente si Factusol dice «ninguna» o no la trae. */
  readonly formaDePago?: FormaDePago;
  readonly cobros: CobrosDeFactura;
  /**
   * `**Abonos:**`: los importes de la factura no restan abonos. `ninguno` solo con la línea
   * «ninguno enlazado…»; cualquier otra cosa es `hay`, y `sin_seccion` si no viene.
   */
  readonly abonos: 'ninguno' | 'hay' | 'sin_seccion';
}

export interface ClienteDeFactusol {
  readonly codigo: string;
  readonly nombre: string;
  readonly nif: string;
}

function fallo(mensaje: string): never {
  throw new ErrorConector(
    'invalido',
    `La respuesta de Factusol MCP no encaja en el contrato: ${mensaje}`,
  );
}

/** `No se ha encontrado la factura 1-999999.` llega con `isError: false`. */
export function esNoEncontrado(texto: string): boolean {
  return /^\s*No se ha encontrado\b/i.test(texto);
}

/** Importe `1.21 €`, punto decimal, sin separador de miles. */
export function leerImporte(texto: string, campo: string): number {
  const coincide = /^(-?\d+(?:\.\d{1,4})?)\s*€$/.exec(texto.trim());
  if (coincide === null) return fallo(`el campo «${campo}» no es un importe en euros`);
  return Number(coincide[1]);
}

function leerFechaCampo(texto: string, campo: string): string {
  const valor = texto.trim();
  if (!FechaCalendario.safeParse(valor).success) {
    return fallo(`el campo «${campo}» no es una fecha AAAA-MM-DD`);
  }
  return valor;
}

/** `NOMBRE (NIF)`: el NIF es el último paréntesis; el nombre puede llevar otros. */
function separarNombreYNif(texto: string, campo: string): { nombre: string; nif: string } {
  const coincide = /^(.+?)\s*\(([^()]+)\)\s*$/.exec(texto.trim());
  if (coincide === null) return fallo(`el campo «${campo}» no trae «NOMBRE (NIF)»`);
  return { nombre: (coincide[1] ?? '').trim(), nif: (coincide[2] ?? '').trim() };
}

const CABECERA_FACTURA = /^\*\*Factura\s+([A-Za-z0-9]+)-(\d+)\*\*\s*$/;

function campos(lineas: readonly string[]): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const linea of lineas) {
    const coincide = /^-\s+([^:*]+?):\s*(.*)$/.exec(linea.trim());
    if (coincide !== null) mapa.set((coincide[1] ?? '').trim(), (coincide[2] ?? '').trim());
  }
  return mapa;
}

function obligatorio(mapa: Map<string, string>, campo: string, bloque: string): string {
  const valor = mapa.get(campo);
  if (valor === undefined || valor === '') return fallo(`al bloque ${bloque} le falta «${campo}»`);
  return valor;
}

function aFactura(cabecera: RegExpExecArray, lineas: readonly string[]): FacturaDeLista {
  const serie = cabecera[1] ?? '';
  const numero = Number(cabecera[2]);
  const id = `${serie}-${cabecera[2] ?? ''}`;
  const mapa = campos(lineas);
  const cliente = separarNombreYNif(obligatorio(mapa, 'Cliente', id), 'Cliente');
  return {
    id,
    serie,
    numero,
    clienteNombre: cliente.nombre,
    clienteNif: cliente.nif,
    fecha: leerFechaCampo(obligatorio(mapa, 'Fecha', id), 'Fecha'),
    estado: obligatorio(mapa, 'Estado', id).toLowerCase(),
    total: leerImporte(obligatorio(mapa, 'Total', id), 'Total'),
  };
}

/** Parte el texto en bloques que empiezan en una línea `**Factura S-NNNNNN**`. */
function bloquesDeFactura(texto: string): { cabecera: RegExpExecArray; lineas: string[] }[] {
  const bloques: { cabecera: RegExpExecArray; lineas: string[] }[] = [];
  for (const linea of texto.split(/\r?\n/)) {
    const cabecera = CABECERA_FACTURA.exec(linea.trim());
    if (cabecera !== null) bloques.push({ cabecera, lineas: [] });
    else bloques.at(-1)?.lineas.push(linea);
  }
  return bloques;
}

/** Respuesta de `list_facturas_emitidas`. Sin ningún bloque reconocible es `invalido`. */
export function analizarListaDeFacturas(texto: string): FacturaDeLista[] {
  const bloques = bloquesDeFactura(texto);
  if (bloques.length === 0) return fallo('no trae ningún bloque «**Factura S-NNNNNN**»');
  return bloques.map(({ cabecera, lineas }) => aFactura(cabecera, lineas));
}

const CABECERA_DE_SECCION = /^\*\*([^*]+):\*\*\s*$/;
const LINEA_DE_COBRO =
  /^-\s+(\d{4}-\d{2}-\d{2}):\s+(-?\d+(?:\.\d{1,4})?)\s*€\s+\(cobro\)(?:\s+—.*)?$/;

function formaDePagoDe(valor: string | undefined): FormaDePago | undefined {
  if (valor === undefined || valor.trim() === '' || /^ninguna$/i.test(valor.trim())) {
    return undefined;
  }
  const [codigo, ...resto] = valor.split(' · ');
  const nombre = resto.join(' · ').trim();
  return { codigo: (codigo ?? '').trim(), ...(nombre === '' ? {} : { nombre }) };
}

function leerCobros(lineas: readonly string[], id: string): CobrosDeFactura {
  if (lineas.length === 0) return fallo(`el bloque «**Cobros:**» de ${id} viene vacío`);
  if (lineas.length === 1 && /^-\s+ninguno registrado\s*$/i.test(lineas[0] ?? '')) {
    return { tipo: 'ninguno' };
  }
  let centimos = 0;
  for (const linea of lineas) {
    const coincide = LINEA_DE_COBRO.exec(linea);
    if (coincide === null) return { tipo: 'ilegible' };
    centimos += Math.round(Number(coincide[2]) * 100);
  }
  return { tipo: 'importe', total: centimos / 100 };
}

/**
 * Respuesta de `get_factura`: la cabecera, la forma de pago y las secciones `**Líneas:**`,
 * `**Cobros:**` y `**Abonos:**`. Las líneas que el adaptador no usa se ignoran; sin la
 * sección de cobros es `invalido`.
 */
export function analizarDetalleDeFactura(texto: string): DetalleDeFactura {
  const bloques = bloquesDeFactura(texto);
  if (bloques.length !== 1) return fallo('el detalle no trae exactamente una factura');
  const [bloque] = bloques;
  if (bloque === undefined) return fallo('el detalle no trae ninguna factura');

  // Los campos de cabecera son solo los anteriores a la primera sección: el texto libre de
  // líneas y cobros no puede pisarlos.
  const cabecera: string[] = [];
  const secciones = new Map<string, string[]>();
  let actual: string[] = cabecera;
  for (const linea of bloque.lineas) {
    const seccion = CABECERA_DE_SECCION.exec(linea.trim());
    if (seccion !== null) {
      actual = [];
      secciones.set((seccion[1] ?? '').trim(), actual);
    } else if (linea.trim().startsWith('- ')) {
      actual.push(linea.trim());
    }
  }

  const factura = aFactura(bloque.cabecera, cabecera);
  const cobros = secciones.get('Cobros');
  if (cobros === undefined)
    return fallo(`a la factura ${factura.id} le falta el bloque «**Cobros:**»`);
  const abonos = secciones.get('Abonos');
  const forma = formaDePagoDe(campos(cabecera).get('Forma de pago'));
  return {
    ...factura,
    ...(forma === undefined ? {} : { formaDePago: forma }),
    cobros: leerCobros(cobros, factura.id),
    abonos:
      abonos === undefined
        ? 'sin_seccion'
        : abonos.length === 1 && /^-\s+ninguno enlazado/i.test(abonos[0] ?? '')
          ? 'ninguno'
          : 'hay',
  };
}

export interface FormaDePagoListada {
  readonly codigo: string;
  readonly nombre: string;
  readonly vencimientos: number;
}

/** Respuesta de `get_formas_de_pago`: una línea ``- **NOMBRE** (`COD`) · N vencimiento(s)`` por forma. */
export function analizarFormasDePago(texto: string): Map<string, FormaDePagoListada> {
  const formas = new Map<string, FormaDePagoListada>();
  for (const linea of texto.split(/\r?\n/)) {
    if (linea.trim() === '') continue;
    const coincide =
      /^-\s+\*\*(.+)\*\*\s+\(`([A-Za-z0-9]+)`\)\s+·\s+(\d+)\s+vencimiento\(s\)\s*$/.exec(
        linea.trim(),
      );
    if (coincide === null) return fallo('una línea de formas de pago no encaja');
    formas.set(coincide[2] ?? '', {
      codigo: coincide[2] ?? '',
      nombre: (coincide[1] ?? '').trim(),
      vencimientos: Number(coincide[3]),
    });
  }
  if (formas.size === 0) return fallo('no trae ninguna forma de pago');
  return formas;
}

/** Respuesta de `get_cliente` buscando por NIF: un único `**NOMBRE** (NIF · NIE)` y `- Código: N`. */
export function analizarCliente(texto: string, nifEsperado: string): ClienteDeFactusol {
  const cabeceras = texto
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter((linea) => /^\*\*[^*]+\*\*\s*\(/.test(linea) && !CABECERA_FACTURA.test(linea));
  if (cabeceras.length !== 1) {
    return fallo(
      cabeceras.length === 0
        ? 'la ficha no trae «**NOMBRE** (NIF · NIE)»'
        : 'la búsqueda del cliente devuelve más de una ficha',
    );
  }
  const cabecera = /^\*\*([^*]+)\*\*\s*\((.*)\)\s*$/.exec(cabeceras[0] ?? '');
  if (cabecera === null) return fallo('la cabecera de la ficha no encaja');
  const nombre = (cabecera[1] ?? '').trim();
  if (!(cabecera[2] ?? '').includes(nifEsperado)) {
    return fallo('la ficha no corresponde al NIF buscado');
  }
  const codigo = campos(texto.split(/\r?\n/)).get('Código') ?? '';
  if (!/^\d+$/.test(codigo)) return fallo('la ficha no trae «- Código: N»');
  return { codigo, nombre, nif: nifEsperado };
}
