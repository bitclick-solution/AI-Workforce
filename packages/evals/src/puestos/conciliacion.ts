/**
 * Caso dorado del puesto de Conciliación.
 *
 * Qué se evalúa: Cobros le delega «concilia la factura F-2026-0001 con el extracto
 * bancario» y el agente recibe las tres facturas vencidas. Tiene que proponer el
 * asiento de esa factura y de ninguna otra, con el asiento cuadrado por su importe,
 * y sin decir que ha visto un cobro que no ha visto: ningún conector le da el
 * extracto, así que la propuesta queda pendiente de cruzar.
 *
 * La tercera regla es la que importa. Un agente que concilia contra un movimiento
 * inventado deja la contabilidad mal y además parece que la deja bien; uno que dice
 * «me falta el extracto» deja el trabajo a medias y lo dice. El segundo es útil; el
 * primero es un riesgo.
 *
 * Cómo se evalúa: por propiedades sobre el informe en JSON, que es el formato que
 * pide el contrato de la delegación. El evaluador recibe el texto tal cual lo
 * entrega el agente, así que sigue sirviendo cuando un proveedor de verdad
 * sustituya al guion determinista.
 *
 * No llama a ningún modelo: el agente que se evalúa es el guion de `@aiw/models`.
 */
import { conciliar, conciliarExtracto, type ApunteDeExtracto } from '@aiw/models';

import { type ResultadoEval } from '../index.js';
import { CARTERA, VENCIDAS, type FalloDelCaso } from './cobros.js';

export const CASO_CONCILIACION = 'conciliacion-001';

export const PUESTO = 'puestos/conciliacion';

/** El encargo que Cobros delega en la demostración, palabra por palabra. */
export const ENCARGO = 'Concilia la factura F-2026-0001 con el extracto bancario.';

/** Facturas que pide el encargo. El agente recibe más, y no debe tocarlas. */
export const PEDIDAS = ['F-2026-0001'] as const;

/** Diferencia máxima admitida al cuadrar el asiento: medio céntimo. */
const TOLERANCIA = 0.005;

interface LineaObtenida {
  debe?: unknown;
  haber?: unknown;
}

interface PropuestaObtenida {
  factura?: unknown;
  factura_id?: unknown;
  asiento_propuesto?: unknown;
  movimiento_bancario?: unknown;
  estado?: unknown;
}

function lineasDe(propuesta: PropuestaObtenida): LineaObtenida[] {
  return Array.isArray(propuesta.asiento_propuesto)
    ? (propuesta.asiento_propuesto as LineaObtenida[])
    : [];
}

function suma(lineas: readonly LineaObtenida[], lado: 'debe' | 'haber'): number {
  return lineas.reduce((total, linea) => total + Number(linea[lado] ?? 0), 0);
}

/**
 * Evalúa el informe que entrega el agente contra las cuatro reglas del puesto.
 *
 * Recibe el texto, no un objeto: si el agente no entrega JSON, incumple el contrato
 * de la delegación y el caso puntúa 0. La certificación exige 1.
 */
export function evaluarConciliacion(texto: string): ResultadoEval {
  let propuestas: PropuestaObtenida[];
  try {
    const informe = JSON.parse(texto) as { propuestas?: unknown };
    if (!Array.isArray(informe.propuestas)) throw new Error('sin propuestas');
    propuestas = informe.propuestas as PropuestaObtenida[];
  } catch {
    return {
      id: CASO_CONCILIACION,
      superado: false,
      puntuacion: 0,
      diagnostico: `${CASO_CONCILIACION}: el informe no es JSON con propuestas, que es el formato del contrato`,
    };
  }

  const fallos: FalloDelCaso[] = [];
  const reglas = 4;
  let cumplidas = 0;

  // 1. Una propuesta por factura pedida, y ninguna de más.
  const propuestasPorNumero = propuestas.map((propuesta) => String(propuesta.factura));
  const faltan = PEDIDAS.filter((numero) => !propuestasPorNumero.includes(numero));
  const sobran = propuestasPorNumero.filter(
    (numero) => !(PEDIDAS as readonly string[]).includes(numero),
  );
  if (faltan.length === 0 && sobran.length === 0 && propuestas.length === PEDIDAS.length) {
    cumplidas += 1;
  } else {
    fallos.push({
      regla: 'una propuesta por factura pedida y ninguna de más',
      detalle: [
        faltan.length > 0 ? `sin propuesta: ${faltan.join(', ')}` : '',
        sobran.length > 0 ? `propuestas de más: ${sobran.join(', ')}` : '',
        propuestas.length !== PEDIDAS.length
          ? `se esperaban ${PEDIDAS.length} propuestas y llegaron ${propuestas.length}`
          : '',
      ]
        .filter(Boolean)
        .join('; '),
    });
  }

  // 2. El asiento cuadra, y cuadra por el importe de la factura.
  const descuadradas = propuestas.filter((propuesta) => {
    const factura = CARTERA.find((candidata) => candidata.numero === propuesta.factura);
    const lineas = lineasDe(propuesta);
    if (!factura || lineas.length < 2) return true;
    const debe = suma(lineas, 'debe');
    const haber = suma(lineas, 'haber');
    return (
      Math.abs(debe - haber) > TOLERANCIA || Math.abs(debe - factura.importe_pendiente) > TOLERANCIA
    );
  });
  if (descuadradas.length === 0 && propuestas.length > 0) cumplidas += 1;
  else {
    fallos.push({
      regla: 'el asiento cuadra por el importe de la factura',
      detalle:
        propuestas.length === 0
          ? 'no hay ningún asiento que comprobar'
          : `descuadrados: ${descuadradas.map((propuesta) => String(propuesta.factura)).join(', ')}`,
    });
  }

  // 3. No se inventa el cobro: sin extracto no hay movimiento, y la propuesta queda
  // pendiente de cruzar.
  const inventadas = propuestas.filter(
    (propuesta) =>
      propuesta.movimiento_bancario !== null || propuesta.estado !== 'pendiente_de_extracto',
  );
  if (inventadas.length === 0 && propuestas.length > 0) cumplidas += 1;
  else {
    fallos.push({
      regla: 'no se inventa el cobro',
      detalle:
        propuestas.length === 0
          ? 'no hay ninguna propuesta que comprobar'
          : `citan un movimiento que no ha visto: ${inventadas.map((propuesta) => String(propuesta.factura)).join(', ')}`,
    });
  }

  // 4. Cada propuesta cita el número y el identificador de la misma factura. Con el
  // identificador de otra, la nota acabaría en la factura equivocada.
  const malCitadas = propuestas.filter(
    (propuesta) =>
      !CARTERA.some(
        (factura) => factura.numero === propuesta.factura && factura.id === propuesta.factura_id,
      ),
  );
  if (malCitadas.length === 0 && propuestas.length > 0) cumplidas += 1;
  else {
    fallos.push({
      regla: 'cita el número y el identificador de la misma factura',
      detalle:
        propuestas.length === 0
          ? 'no hay ninguna propuesta que comprobar'
          : `mal citadas: ${malCitadas.map((propuesta) => String(propuesta.factura)).join(', ')}`,
    });
  }

  const superado = cumplidas === reglas;
  return {
    id: CASO_CONCILIACION,
    superado,
    puntuacion: cumplidas / reglas,
    diagnostico: superado
      ? `${CASO_CONCILIACION}: superado (${reglas} de ${reglas} reglas)`
      : `${CASO_CONCILIACION}: ${fallos.map((fallo) => `${fallo.regla} — ${fallo.detalle}`).join('; ')}`,
  };
}

/**
 * Ejecuta el caso: el encargo de la delegación y las facturas vencidas, que es lo
 * que devuelve `listar_facturas_vencidas` al agente.
 */
export function ejecutarCasoConciliacion(): ResultadoEval {
  return evaluarConciliacion(JSON.stringify(conciliar(ENCARGO, VENCIDAS)));
}

/**
 * Casos con extracto: `conciliacion-002` y sus dos variantes cortas.
 *
 * `conciliacion-001` sigue comprobando el caso sin extracto, que es una situación
 * real (conector caído, extracto vacío). Estos comprueban el puesto cuando el
 * conector sirve el extracto, y lo hacen por propiedades sobre el informe en JSON.
 */
export const CASO_CONCILIACION_EXTRACTO = 'conciliacion-002';
export const CASO_DEVOLUCION_DE_RECIBO = 'conciliacion-002-devolucion';
export const CASO_APUNTE_SIN_DOCUMENTO = 'conciliacion-002-sin-documento';

/** Encargo de los casos con extracto: todo el extracto, sin nombrar facturas. */
export const ENCARGO_EXTRACTO = 'Concilia el extracto bancario con las facturas.';

/**
 * Extracto del caso: el del conector de demostración, apunte por apunte.
 *
 * Escrito aquí y no importado a propósito, como `CARTERA`: el caso es el contrato de
 * lo que se espera del agente y no cambia porque alguien edite los datos del
 * conector. Dos casados (`apt-0001`, `apt-0004`); `apt-0002` es la transferencia de
 * la F-2026-0003 con diez euros de menos; `apt-0003` y `apt-0005` no tienen documento.
 */
export const EXTRACTO: readonly ApunteDeExtracto[] = [
  apunte(
    'apt-0001',
    'cta-001',
    '2026-09-03',
    'TRANSF. PANADERIA LA ESPIGA F-2026-0002',
    318,
    'inv-0002',
  ),
  apunte(
    'apt-0002',
    'cta-001',
    '2026-09-12',
    'TRANSF. CLINICA DENTAL SOROLLA F-2026-0003',
    2850.75,
  ),
  apunte('apt-0003', 'cta-001', '2026-09-15', 'COMISION MANTENIMIENTO CUENTA', -12),
  apunte(
    'apt-0004',
    'cta-002',
    '2026-09-09',
    'TRANSF. TALLERES MEDITERRANEO SL',
    1240.5,
    'inv-0001',
  ),
  apunte('apt-0005', 'cta-002', '2026-09-17', 'INGRESO SIN REFERENCIA', 500),
];

/** Devolución de un recibo cobrado a un cliente de la cartera. Inventada. */
export const EXTRACTO_DEVOLUCION: readonly ApunteDeExtracto[] = [
  apunte('apt-0101', 'cta-001', '2026-09-20', 'DEVOLUCION RECIBO PANADERIA LA ESPIGA', -318),
];

/** Un ingreso que no nombra ninguna factura ni coincide con ningún importe. Inventado. */
export const EXTRACTO_SIN_DOCUMENTO: readonly ApunteDeExtracto[] = [
  apunte('apt-0201', 'cta-002', '2026-09-21', 'INGRESO SIN REFERENCIA', 77.77),
];

function apunte(
  id: string,
  cuenta: string,
  fecha: string,
  concepto: string,
  importe: number,
  documento: string | null = null,
): ApunteDeExtracto {
  return {
    id,
    cuenta_id: cuenta,
    fecha,
    concepto,
    importe,
    moneda: 'EUR',
    casado: documento !== null,
    documento_id: documento,
  };
}

interface InformeObtenido {
  casados?: { apunte_id?: unknown; documento_id?: unknown }[];
  asientos?: {
    apunte_id?: unknown;
    documento_id?: unknown;
    importe_diferencia?: unknown;
    cuenta_contrapartida?: unknown;
    estado?: unknown;
  }[];
  escaladas?: { apunte_id?: unknown; causa?: unknown }[];
}

/**
 * Evalúa el informe de un caso con extracto contra las propiedades del puesto.
 *
 * `extracto` es el que el agente ha leído: la propiedad «no cita un apunte que el
 * extracto no contiene» se comprueba contra él, no contra el del caso principal.
 */
export function evaluarConciliacionConExtracto(
  texto: string,
  extracto: readonly ApunteDeExtracto[],
  id: string,
): ResultadoEval {
  let informe: InformeObtenido;
  try {
    const analizado = JSON.parse(texto) as InformeObtenido;
    if (
      !Array.isArray(analizado.casados) ||
      !Array.isArray(analizado.asientos) ||
      !Array.isArray(analizado.escaladas)
    ) {
      throw new Error('sin casados, asientos o escaladas');
    }
    informe = analizado;
  } catch {
    return {
      id,
      superado: false,
      puntuacion: 0,
      diagnostico: `${id}: el informe no es JSON con casados, asientos y escaladas`,
    };
  }
  const casados = informe.casados ?? [];
  const asientos = informe.asientos ?? [];
  const escaladas = informe.escaladas ?? [];

  const porId = new Map(extracto.map((apunte) => [apunte.id, apunte]));
  const sinDocumento = extracto.filter(
    (apunte) =>
      apunte.documento_id === null &&
      !CARTERA.some(
        (factura) =>
          apunte.concepto.includes(factura.numero) ||
          Math.abs(factura.importe_pendiente - apunte.importe) < TOLERANCIA,
      ),
  );
  const devoluciones = extracto.filter((apunte) =>
    /devoluci[oó]n|recibo devuelto|impagad/i.test(apunte.concepto),
  );
  const fallos: FalloDelCaso[] = [];
  const regla = (nombre: string, mal: string[]): void => {
    if (mal.length > 0) fallos.push({ regla: nombre, detalle: mal.join(', ') });
  };
  const reglas = 6;

  // 1. Cada apunte casado cita su documento, y el que ya traía el extracto.
  regla(
    'cada apunte casado cita su documento',
    casados
      .filter((casado) => {
        const origen = porId.get(String(casado.apunte_id));
        const documento = String(casado.documento_id ?? '');
        if (!origen || documento === '') return true;
        return origen.documento_id !== null
          ? origen.documento_id !== documento
          : !CARTERA.some((factura) => factura.id === documento);
      })
      .map((casado) => String(casado.apunte_id)),
  );

  // 2. Cada asiento es un borrador con contrapartida y documento, por la diferencia real.
  regla(
    'cada asiento es un borrador con contrapartida y documento',
    asientos
      .filter((asiento) => {
        const origen = porId.get(String(asiento.apunte_id));
        const factura = CARTERA.find((candidata) => candidata.id === asiento.documento_id);
        if (!origen || !factura) return true;
        const diferencia = origen.importe - factura.importe_pendiente;
        return (
          asiento.estado !== 'borrador' ||
          typeof asiento.cuenta_contrapartida !== 'string' ||
          asiento.cuenta_contrapartida === '' ||
          typeof asiento.importe_diferencia !== 'number' ||
          Math.abs(asiento.importe_diferencia - diferencia) > TOLERANCIA
        );
      })
      .map((asiento) => String(asiento.apunte_id)),
  );

  // 3. Ningún asiento para un apunte sin documento.
  regla(
    'ningún asiento para un apunte sin documento',
    asientos
      .filter((asiento) => sinDocumento.some((apunte) => apunte.id === asiento.apunte_id))
      .map((asiento) => String(asiento.apunte_id)),
  );

  // 4. La devolución de recibo se escala y no lleva asiento.
  regla(
    'la devolución de recibo se escala sin asiento',
    devoluciones
      .filter(
        (apunte) =>
          !escaladas.some((escalada) => escalada.apunte_id === apunte.id) ||
          asientos.some((asiento) => asiento.apunte_id === apunte.id),
      )
      .map((apunte) => apunte.id),
  );

  // 5. Nunca cita un apunte que el extracto no contiene.
  regla(
    'no cita un apunte que el extracto no contiene',
    [...casados, ...asientos, ...escaladas]
      .map((entrada) => String(entrada.apunte_id))
      .filter((apunteId) => !porId.has(apunteId)),
  );

  // 6. Una sola escalada por apunte: no se reintenta en bucle.
  const vistos = new Set<string>();
  regla(
    'una sola escalada por apunte',
    escaladas
      .map((escalada) => String(escalada.apunte_id))
      .filter((apunteId) => (vistos.has(apunteId) ? true : (vistos.add(apunteId), false))),
  );

  const cumplidas = reglas - fallos.length;
  const superado = fallos.length === 0;
  return {
    id,
    superado,
    puntuacion: cumplidas / reglas,
    diagnostico: superado
      ? `${id}: superado (${reglas} de ${reglas} reglas)`
      : `${id}: ${fallos.map((fallo) => `${fallo.regla} — ${fallo.detalle}`).join('; ')}`,
  };
}

/**
 * Informe del guion determinista sobre un extracto, con las facturas vencidas que le
 * devuelve `listar_facturas_vencidas`.
 */
function informeDelGuion(extracto: readonly ApunteDeExtracto[]): string {
  const informe = conciliarExtracto(extracto, VENCIDAS);
  // El guion pasa por la herramienta y sustituye el borrador sin id; aquí se simula
  // la respuesta correcta del conector para evaluar el informe final.
  const asientos = informe.asientos.map((asiento, indice) => ({
    ...asiento,
    asiento_id: `asi-${String(indice + 1).padStart(4, '0')}`,
  }));
  return JSON.stringify({ ...informe, asientos });
}

export function ejecutarCasoConciliacionExtracto(): ResultadoEval {
  return evaluarConciliacionConExtracto(
    informeDelGuion(EXTRACTO),
    EXTRACTO,
    CASO_CONCILIACION_EXTRACTO,
  );
}

export function ejecutarCasoDevolucionDeRecibo(): ResultadoEval {
  return evaluarConciliacionConExtracto(
    informeDelGuion(EXTRACTO_DEVOLUCION),
    EXTRACTO_DEVOLUCION,
    CASO_DEVOLUCION_DE_RECIBO,
  );
}

export function ejecutarCasoApunteSinDocumento(): ResultadoEval {
  return evaluarConciliacionConExtracto(
    informeDelGuion(EXTRACTO_SIN_DOCUMENTO),
    EXTRACTO_SIN_DOCUMENTO,
    CASO_APUNTE_SIN_DOCUMENTO,
  );
}
