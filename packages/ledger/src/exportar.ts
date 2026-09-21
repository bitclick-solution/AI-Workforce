/**
 * Exportación del libro de auditoría en CSV y JSON, con la cadena verificada.
 *
 * ADR-010: «CSV y JSON por líneas [...] y verificador de cadena de hashes». Aquí
 * están los tres formatos y el verificador, aplicados a un tenant y a un rango de
 * fechas, que es como los pide un auditor: «dame marzo».
 *
 * `verificarCadena` de `hash.ts` empieza a contar en 1 y solo sabe verificar la
 * cadena entera; un tenant con un millón de entradas no la recorre para exportar un
 * mes. `verificarRango` ancla el rango en el hash de la entrada inmediatamente
 * anterior y comprueba desde ahí, sin tocar `hash.ts` ni la firma de `calcularHash`.
 */
import { conTenant } from '@aiw/db';
import type postgres from 'postgres';

import {
  HASH_GENESIS,
  calcularHash,
  type ContenidoEntrada,
  type DatoReferenciado,
  type EslabonVerificable,
} from './hash.js';

export const FORMATOS_EXPORTACION = ['csv', 'json', 'jsonl'] as const;

export type FormatoExportacion = (typeof FORMATOS_EXPORTACION)[number];

/** Columnas de la exportación, en orden. Se añaden al final; no se reordenan. */
export const COLUMNAS_EXPORTACION = [
  'numero_orden',
  'creado_en',
  'actor_tipo',
  'actor_id',
  'puesto_id',
  'version_puesto_id',
  'tarea_id',
  'paso_id',
  'accion',
  'herramienta',
  'datos_referenciados',
  'resultado',
  'coste_euros',
  'duracion_ms',
  'aprobada_por_persona_id',
  'leccion_aplicada_id',
  'nivel_aplicado',
  'cambio_de_nivel',
  'hash_anterior',
  'hash',
] as const;

export type ColumnaExportacion = (typeof COLUMNAS_EXPORTACION)[number];

/**
 * Una fila tal y como sale en la exportación: nombres de columna de la base.
 *
 * No se traducen a la forma del código a propósito. El auditor compara lo exportado
 * con lo que ve en la base y con el CSV; tres nombres para lo mismo no ayudan a
 * nadie, y renombrar columnas en la exportación es una forma silenciosa de romper
 * las herramientas de quien la consume.
 */
export type FilaExportada = Record<ColumnaExportacion, string | number | null>;

export interface ResultadoVerificacionRango {
  valida: boolean;
  entradas: number;
  /** Número de orden del primer eslabón roto, si lo hay. */
  rotaEn?: number;
  motivo?: string;
  /**
   * Si se pudo comprobar el primer eslabón contra el anterior al rango. Es `false`
   * cuando la entrada anterior ya no está: la retención suelta particiones enteras
   * (ADR-010), así que un rango antiguo puede quedar sin ancla. Los eslabones de
   * dentro del rango se verifican igual.
   */
  anclada: boolean;
}

export interface CabeceraExportacion {
  tipo: 'cabecera';
  tenantId: string;
  desde: string | null;
  hasta: string | null;
  formato: FormatoExportacion;
  entradas: number;
  primerNumeroOrden: number | null;
  ultimoNumeroOrden: number | null;
  generadoEn: string;
  verificacion: ResultadoVerificacionRango;
}

export interface LibroExportado {
  contenido: string;
  cabecera: CabeceraExportacion;
  filas: FilaExportada[];
}

export interface OpcionesExportacion {
  tenantId: string;
  formato: FormatoExportacion;
  /** Inclusivo. Sin valor, desde la primera entrada que quede del tenant. */
  desde?: Date | undefined;
  /** Inclusivo. Sin valor, hasta la última. */
  hasta?: Date | undefined;
  /** Cuántas entradas como máximo. Protege la memoria del proceso que exporta. */
  limite?: number | undefined;
  /**
   * Con la cadena rota, por defecto no se exporta: entregar evidencia alterada sin
   * decirlo es peor que no entregarla. Se pone en `false` cuando lo que se
   * investiga es justo la manipulación y hacen falta las filas.
   */
  exigirCadenaValida?: boolean | undefined;
  momento?: Date | undefined;
}

interface FilaEntradaLeida {
  numero_orden: string;
  creado_en: Date;
  actor_tipo: ContenidoEntrada['actorTipo'];
  actor_id: string | null;
  puesto_id: string | null;
  version_puesto_id: string | null;
  tarea_id: string | null;
  paso_id: string | null;
  accion: string;
  herramienta: string | null;
  datos_referenciados: DatoReferenciado[];
  resultado: ContenidoEntrada['resultado'];
  coste_euros: string;
  duracion_ms: number;
  aprobada_por_persona_id: string | null;
  leccion_aplicada_id: string | null;
  nivel_aplicado: ContenidoEntrada['nivelAplicado'];
  cambio_de_nivel: unknown;
  hash_anterior: string | null;
  hash: string;
}

const LIMITE_POR_DEFECTO = 100_000;

/**
 * Exporta el libro de un tenant y un rango, con el veredicto de la verificación en
 * la cabecera. La lectura va en una transacción con el tenant fijado: sin ajuste de
 * sesión, la RLS no deja ver ninguna fila, que es el comportamiento seguro.
 */
export async function exportarLibro(
  cliente: postgres.Sql,
  opciones: OpcionesExportacion,
): Promise<LibroExportado> {
  const limite = opciones.limite ?? LIMITE_POR_DEFECTO;
  const desde = opciones.desde ?? null;
  const hasta = opciones.hasta ?? null;

  const { filas, hashAnclaje, anclada } = await conTenant(
    cliente,
    opciones.tenantId,
    async (tx) => {
      const leidas = await tx<FilaEntradaLeida[]>`
        select
          numero_orden, creado_en, actor_tipo, actor_id, puesto_id, version_puesto_id,
          tarea_id, paso_id, accion, herramienta, datos_referenciados, resultado,
          coste_euros, duracion_ms, aprobada_por_persona_id, leccion_aplicada_id,
          nivel_aplicado, cambio_de_nivel, hash_anterior, hash
        from entrada_auditoria
        where tenant_id = ${opciones.tenantId}
          and (${desde}::timestamptz is null or creado_en >= ${desde}::timestamptz)
          and (${hasta}::timestamptz is null or creado_en <= ${hasta}::timestamptz)
        order by numero_orden asc
        limit ${limite}
      `;
      const primera = leidas[0];
      if (!primera) return { filas: leidas, hashAnclaje: HASH_GENESIS, anclada: true };

      const primerNumero = Number(primera.numero_orden);
      if (primerNumero === 1) {
        return { filas: leidas, hashAnclaje: HASH_GENESIS, anclada: true };
      }
      const [anterior] = await tx<{ hash: string }[]>`
        select hash from entrada_auditoria
        where tenant_id = ${opciones.tenantId} and numero_orden = ${primerNumero - 1}
      `;
      return {
        filas: leidas,
        hashAnclaje: anterior?.hash ?? primera.hash_anterior ?? HASH_GENESIS,
        anclada: Boolean(anterior),
      };
    },
  );

  const eslabones = filas.map((fila) => aEslabon(fila, opciones.tenantId));
  const verificacion = { ...verificarRango(eslabones, hashAnclaje), anclada };
  const primera = filas[0];
  const ultima = filas[filas.length - 1];

  const cabecera: CabeceraExportacion = {
    tipo: 'cabecera',
    tenantId: opciones.tenantId,
    desde: desde ? desde.toISOString() : null,
    hasta: hasta ? hasta.toISOString() : null,
    formato: opciones.formato,
    entradas: filas.length,
    primerNumeroOrden: primera ? Number(primera.numero_orden) : null,
    ultimoNumeroOrden: ultima ? Number(ultima.numero_orden) : null,
    generadoEn: (opciones.momento ?? new Date()).toISOString(),
    verificacion,
  };

  if (!verificacion.valida && (opciones.exigirCadenaValida ?? true)) {
    throw new Error(
      `La cadena de auditoría del tenant no verifica: ${verificacion.motivo ?? 'motivo desconocido'} ` +
        'Exporta con exigirCadenaValida: false si necesitas las filas para investigarlo.',
    );
  }

  const exportadas = filas.map(aFilaExportada);
  return { contenido: serializar(cabecera, exportadas), cabecera, filas: exportadas };
}

/**
 * Verifica un tramo de la cadena partiendo de un hash conocido.
 *
 * Comprueba tres cosas por eslabón: que el número de orden es el siguiente, que el
 * hash anterior guardado es el que toca y que el hash recalculado del contenido
 * coincide con el guardado. Alterar una sola columna rompe la tercera.
 */
export function verificarRango(
  eslabones: readonly EslabonVerificable[],
  hashAnteriorAlRango: string = HASH_GENESIS,
): ResultadoVerificacionRango {
  let anterior = hashAnteriorAlRango;
  let esperado: number | null = null;

  for (const eslabon of eslabones) {
    if (esperado !== null && eslabon.numeroOrden !== esperado) {
      return {
        valida: false,
        entradas: eslabones.length,
        rotaEn: eslabon.numeroOrden,
        motivo: `Falta la entrada ${esperado}: el rango salta a ${eslabon.numeroOrden}.`,
        anclada: true,
      };
    }
    const hashAnteriorGuardado = eslabon.hashAnterior ?? HASH_GENESIS;
    if (hashAnteriorGuardado !== anterior) {
      return {
        valida: false,
        entradas: eslabones.length,
        rotaEn: eslabon.numeroOrden,
        motivo: `La entrada ${eslabon.numeroOrden} no encadena con la anterior.`,
        anclada: true,
      };
    }
    if (calcularHash(eslabon, anterior) !== eslabon.hash) {
      return {
        valida: false,
        entradas: eslabones.length,
        rotaEn: eslabon.numeroOrden,
        motivo: `La entrada ${eslabon.numeroOrden} está alterada: el hash no cuadra.`,
        anclada: true,
      };
    }
    anterior = eslabon.hash;
    esperado = eslabon.numeroOrden + 1;
  }

  return { valida: true, entradas: eslabones.length, anclada: true };
}

function aEslabon(fila: FilaEntradaLeida, tenantId: string): EslabonVerificable {
  return {
    tenantId,
    numeroOrden: Number(fila.numero_orden),
    creadoEn: fila.creado_en,
    actorTipo: fila.actor_tipo,
    actorId: fila.actor_id,
    puestoId: fila.puesto_id,
    versionPuestoId: fila.version_puesto_id,
    tareaId: fila.tarea_id,
    pasoId: fila.paso_id,
    accion: fila.accion,
    herramienta: fila.herramienta,
    datosReferenciados: fila.datos_referenciados,
    resultado: fila.resultado,
    costeEuros: Number(fila.coste_euros),
    duracionMs: fila.duracion_ms,
    aprobadaPorPersonaId: fila.aprobada_por_persona_id,
    leccionAplicadaId: fila.leccion_aplicada_id,
    nivelAplicado: fila.nivel_aplicado,
    cambioDeNivel: fila.cambio_de_nivel,
    hash: fila.hash,
    hashAnterior: fila.hash_anterior,
  };
}

function aFilaExportada(fila: FilaEntradaLeida): FilaExportada {
  return {
    numero_orden: Number(fila.numero_orden),
    creado_en: fila.creado_en.toISOString(),
    actor_tipo: fila.actor_tipo,
    actor_id: fila.actor_id,
    puesto_id: fila.puesto_id,
    version_puesto_id: fila.version_puesto_id,
    tarea_id: fila.tarea_id,
    paso_id: fila.paso_id,
    accion: fila.accion,
    herramienta: fila.herramienta,
    datos_referenciados: JSON.stringify(fila.datos_referenciados),
    resultado: fila.resultado,
    coste_euros: fila.coste_euros,
    duracion_ms: fila.duracion_ms,
    aprobada_por_persona_id: fila.aprobada_por_persona_id,
    leccion_aplicada_id: fila.leccion_aplicada_id,
    nivel_aplicado: fila.nivel_aplicado ?? null,
    cambio_de_nivel: fila.cambio_de_nivel === null ? null : JSON.stringify(fila.cambio_de_nivel),
    hash_anterior: fila.hash_anterior,
    hash: fila.hash,
  };
}

function serializar(cabecera: CabeceraExportacion, filas: readonly FilaExportada[]): string {
  switch (cabecera.formato) {
    case 'csv':
      return aCsv(filas);
    case 'json':
      return aJson(cabecera, filas);
    case 'jsonl':
      return aJsonl(cabecera, filas);
  }
}

/**
 * Valor que una hoja de cálculo interpretaría como fórmula.
 *
 * `datos_referenciados` lleva identificadores de sistemas externos, así que su
 * contenido no es nuestro. Un valor que empieza por `=`, `+`, `-`, `@`, tabulador o
 * retorno de carro se ejecuta al abrir el CSV en Excel o en LibreOffice.
 */
export const INICIO_DE_FORMULA = /^[=+\-@\t\r]/;

/** Neutraliza la fórmula con un apóstrofo delante. Solo afecta al CSV. */
export function neutralizarFormula(valor: string): string {
  return INICIO_DE_FORMULA.test(valor) ? `'${valor}` : valor;
}

/** Comilla un campo de CSV según RFC 4180: comillas dobladas y campo entrecomillado. */
export function campoCsv(valor: string | number | null): string {
  if (valor === null) return '';
  const texto = neutralizarFormula(String(valor));
  return /["\n\r,]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
}

/**
 * CSV con cabecera de columnas. Es el formato para personas: neutraliza fórmulas y
 * aplana los `jsonb` a texto. La evidencia fiel es el JSON.
 */
export function aCsv(filas: readonly FilaExportada[]): string {
  const lineas = [COLUMNAS_EXPORTACION.join(',')];
  for (const fila of filas) {
    lineas.push(COLUMNAS_EXPORTACION.map((columna) => campoCsv(fila[columna])).join(','));
  }
  return `${lineas.join('\n')}\n`;
}

/** Un solo documento con la cabecera —y el veredicto— y las entradas. */
export function aJson(cabecera: CabeceraExportacion, filas: readonly FilaExportada[]): string {
  return `${JSON.stringify({ cabecera, entradas: filas }, null, 2)}\n`;
}

/**
 * JSON por líneas: la primera es la cabecera con el veredicto y cada siguiente es
 * una entrada. Es el formato que se envía a un SIEM y el que se puede leer sin
 * cargar el fichero entero en memoria.
 */
export function aJsonl(cabecera: CabeceraExportacion, filas: readonly FilaExportada[]): string {
  const lineas = [JSON.stringify(cabecera), ...filas.map((fila) => JSON.stringify(fila))];
  return `${lineas.join('\n')}\n`;
}
