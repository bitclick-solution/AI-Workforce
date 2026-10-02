/**
 * Las dos herramientas de conciliación bancaria sobre el MCP dinámico.
 *
 * - `leer_extracto_bancario` lee `account.bank.statement.line`.
 * - `proponer_asiento_diferencia` crea un asiento en borrador (`account.move`
 *   sin contabilizar) por la puerta de escritura del MCP dinámico: preparar,
 *   validar y ejecutar. Ninguna ruta llama a la contabilización: una persona
 *   publica el asiento en el ERP con sus credenciales.
 */
import { extraerAprobacion } from './aprobacion.js';
import { HERRAMIENTAS_DINAMICAS, type ClienteMcpDinamico } from './cliente.js';
import { ErrorConector, traducirError } from './errores.js';
import {
  EntradaLeerExtractoBancario,
  EntradaProponerAsientoDiferencia,
  SalidaLeerExtractoBancario,
  SalidaProponerAsientoDiferencia,
  type EntradaAsientoResuelta,
  type SalidaAsiento,
  type SalidaExtracto,
} from './esquemas-conciliacion.js';
import { CAMPOS_APUNTE, aApunte, compararApuntes } from './mapeo-conciliacion.js';
import {
  leerCreadoEn,
  leerFecha,
  leerIdentificador,
  leerRegistros,
  leerRelacion,
} from './mapeo.js';

export const NOMBRES_CONCILIACION = {
  extracto: 'leer_extracto_bancario',
  asiento: 'proponer_asiento_diferencia',
} as const;

/** Lo guardado bajo una clave: el asiento y la huella de los datos que lo crearon. */
export interface AsientoIdempotente {
  readonly huella: string;
  readonly salida: SalidaAsiento;
}

export interface AlmacenAsientos {
  leer(clave: string): AsientoIdempotente | undefined;
  guardar(clave: string, asiento: AsientoIdempotente): void;
}

/** Claves que caben en memoria antes de empezar a olvidar las más viejas. */
export const CLAVES_ASIENTOS_EN_MEMORIA = 1000;

/** Igual que el almacén de notas: en el proceso y con tope. La garantía duradera es del flujo. */
export function almacenAsientosEnMemoria(maximo = CLAVES_ASIENTOS_EN_MEMORIA): AlmacenAsientos {
  const guardados = new Map<string, AsientoIdempotente>();
  return {
    leer: (clave) => guardados.get(clave),
    guardar: (clave, asiento) => {
      if (guardados.size >= maximo) {
        const primera = guardados.keys().next();
        if (!primera.done) guardados.delete(primera.value);
      }
      guardados.set(clave, asiento);
    },
  };
}

/** Los datos que hacen único a un asiento: si cambian, la clave no vale para los dos. */
export function huellaDeAsiento(argumentos: EntradaAsientoResuelta): string {
  return JSON.stringify([
    argumentos.apunte_id,
    argumentos.documento_id,
    argumentos.importe_diferencia,
    argumentos.cuenta_contrapartida,
    argumentos.motivo,
  ]);
}

export interface OpcionesConciliacion {
  readonly cliente: ClienteMcpDinamico;
  readonly ahora?: () => Date;
  readonly almacen?: AlmacenAsientos;
}

export interface HerramientasConciliacion {
  leerExtractoBancario(entrada: unknown): Promise<SalidaExtracto>;
  proponerAsientoDiferencia(entrada: unknown): Promise<SalidaAsiento>;
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

/** Identificador nativo de Odoo: un entero positivo escrito como cadena. */
function identificadorOdoo(valor: string, campo: string): number {
  if (!/^[1-9]\d{0,17}$/.test(valor)) {
    throw new ErrorConector(
      'invalido',
      `«${campo}» no es un identificador de Odoo: ${campo === 'cuenta_id' ? 'es el número del diario de banco' : 'es un número entero'}.`,
    );
  }
  return Number(valor);
}

const CODIGO_DE_CUENTA = /^[A-Za-z0-9.]{1,64}$/;

export function crearHerramientasConciliacion(
  opciones: OpcionesConciliacion,
): HerramientasConciliacion {
  const { cliente } = opciones;
  const ahora = opciones.ahora ?? (() => new Date());
  const almacen = opciones.almacen ?? almacenAsientosEnMemoria();
  const enCurso = new Map<string, { huella: string; promesa: Promise<SalidaAsiento> }>();

  async function leerExtractoBancario(entrada: unknown): Promise<SalidaExtracto> {
    const argumentos = validar(
      EntradaLeerExtractoBancario,
      entrada ?? {},
      NOMBRES_CONCILIACION.extracto,
    );
    const dominio: unknown[] = [];
    if (argumentos.cuenta_id !== undefined) {
      dominio.push(['journal_id', '=', identificadorOdoo(argumentos.cuenta_id, 'cuenta_id')]);
    }
    if (argumentos.desde !== undefined) dominio.push(['date', '>=', argumentos.desde]);
    if (argumentos.hasta !== undefined) dominio.push(['date', '<=', argumentos.hasta]);
    if (argumentos.solo_sin_casar) dominio.push(['is_reconciled', '=', false]);
    try {
      const carga = await cliente.llamar(HERRAMIENTAS_DINAMICAS.buscar, {
        model: 'account.bank.statement.line',
        domain: dominio,
        fields: [...CAMPOS_APUNTE],
        limit: argumentos.limite,
        order: 'date asc, id asc',
      });
      const apuntes = leerRegistros(carga)
        .map((registro) => aApunte(registro))
        // El dominio ya lo pide; esto defiende el contrato si el ERP lo ignora.
        .filter((apunte) => !argumentos.solo_sin_casar || !apunte.casado)
        .sort(compararApuntes)
        .slice(0, argumentos.limite);
      return SalidaLeerExtractoBancario.parse({ apuntes, total: apuntes.length });
    } catch (error) {
      throw traducirError(error, 'No se pudo leer el extracto bancario');
    }
  }

  /** Un único registro por identificador; si no existe, `no_encontrada`. */
  async function leerUno(
    modelo: string,
    dominio: unknown[],
    campos: string[],
    descripcion: string,
  ): Promise<Record<string, unknown>> {
    const carga = await cliente.llamar(HERRAMIENTAS_DINAMICAS.buscar, {
      model: modelo,
      domain: dominio,
      fields: campos,
      limit: 1,
    });
    const registro = leerRegistros(carga)[0];
    if (typeof registro !== 'object' || registro === null) {
      throw new ErrorConector('no_encontrada', `No se encontró ${descripcion} en el ERP.`);
    }
    return registro as Record<string, unknown>;
  }

  async function crearBorrador(
    argumentos: EntradaAsientoResuelta,
    momento: Date,
  ): Promise<SalidaAsiento> {
    const apunteId = identificadorOdoo(argumentos.apunte_id, 'apunte_id');
    const documentoId = identificadorOdoo(argumentos.documento_id, 'documento_id');
    if (!CODIGO_DE_CUENTA.test(argumentos.cuenta_contrapartida)) {
      throw new ErrorConector(
        'invalido',
        '«cuenta_contrapartida» es el código de una cuenta contable, por ejemplo 629000.',
      );
    }
    const apunte = await leerUno(
      'account.bank.statement.line',
      [['id', '=', apunteId]],
      ['journal_id', 'date'],
      `el apunte bancario ${argumentos.apunte_id}`,
    );
    await leerUno(
      'account.move',
      [['id', '=', documentoId]],
      ['name'],
      `el documento ${argumentos.documento_id}`,
    );
    const diario = leerRelacion(apunte['journal_id'], 'journal_id');
    const datosDiario = await leerUno(
      'account.journal',
      [['id', '=', diario.id]],
      ['default_account_id'],
      `el diario del apunte ${argumentos.apunte_id}`,
    );
    const cuentaBanco = datosDiario['default_account_id'];
    if (cuentaBanco === false || cuentaBanco === null || cuentaBanco === undefined) {
      throw new ErrorConector('invalido', 'El diario del apunte no tiene cuenta de banco.');
    }
    const banco = leerRelacion(cuentaBanco, 'default_account_id');
    const contrapartida = await leerUno(
      'account.account',
      [['code', '=', argumentos.cuenta_contrapartida]],
      ['code'],
      `la cuenta ${argumentos.cuenta_contrapartida}`,
    );
    const contrapartidaId = contrapartida['id'];
    if (typeof contrapartidaId !== 'number') {
      throw new ErrorConector(
        'invalido',
        'La respuesta del ERP no encaja en el contrato: la cuenta no trae «id».',
      );
    }

    const cantidad = Math.abs(argumentos.importe_diferencia);
    const ingreso = argumentos.importe_diferencia > 0;
    const linea = (cuenta: number, debe: boolean) => [
      0,
      0,
      {
        account_id: cuenta,
        name: argumentos.motivo,
        debit: debe ? cantidad : 0,
        credit: debe ? 0 : cantidad,
      },
    ];
    // Sin `state` ni `action_post`: un `create` deja el asiento en borrador y
    // lo publica una persona en el ERP.
    const escritura = {
      model: 'account.move',
      operation: 'create',
      values: {
        move_type: 'entry',
        date: leerFecha(apunte['date'], 'date'),
        ref: `Diferencia de conciliación: apunte ${argumentos.apunte_id}, documento ${argumentos.documento_id}`,
        narration: argumentos.motivo,
        line_ids: [linea(banco.id, ingreso), linea(contrapartidaId, !ingreso)],
      },
    };
    await cliente.llamar(HERRAMIENTAS_DINAMICAS.prepararEscritura, escritura);
    const validada = await cliente.llamar(HERRAMIENTAS_DINAMICAS.validarEscritura, escritura);
    const carga = await cliente.llamar(HERRAMIENTAS_DINAMICAS.ejecutarEscritura, {
      ...extraerAprobacion(validada),
      confirm: true,
    });
    return {
      id: String(leerIdentificador(carga)),
      apunte_id: argumentos.apunte_id,
      estado: 'borrador',
      creado_en: leerCreadoEn(carga, momento),
    };
  }

  async function escribir(argumentos: EntradaAsientoResuelta): Promise<SalidaAsiento> {
    try {
      return SalidaProponerAsientoDiferencia.parse(await crearBorrador(argumentos, ahora()));
    } catch (error) {
      throw traducirError(error, 'No se pudo proponer el asiento de diferencia');
    }
  }

  function comprobarHuella(guardada: string, actual: string, clave: string): void {
    if (guardada === actual) return;
    throw new ErrorConector(
      'invalido',
      `La clave de idempotencia «${clave}» ya se usó para otro asiento. Usa una clave nueva o repite los mismos datos.`,
    );
  }

  async function proponerAsientoDiferencia(entrada: unknown): Promise<SalidaAsiento> {
    const argumentos = validar(
      EntradaProponerAsientoDiferencia,
      entrada,
      NOMBRES_CONCILIACION.asiento,
    );
    const clave = argumentos.clave_idempotencia;
    if (clave === undefined) return escribir(argumentos);

    const huella = huellaDeAsiento(argumentos);
    const guardado = almacen.leer(clave);
    if (guardado !== undefined) {
      comprobarHuella(guardado.huella, huella, clave);
      return guardado.salida;
    }
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

  return { leerExtractoBancario, proponerAsientoDiferencia };
}
