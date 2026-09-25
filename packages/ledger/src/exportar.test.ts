/**
 * Exportación y verificación de rango, sin base de datos.
 *
 * Lo que se prueba aquí es lo que un auditor abre: el CSV que no ejecuta fórmulas,
 * el JSON fiel y el verificador que detecta el hueco, el eslabón que no encadena y
 * la entrada alterada.
 */
import { describe, expect, it } from 'vitest';

import { HASH_GENESIS, calcularHash, normalizarFecha, type ContenidoEntrada } from './hash.js';
import {
  COLUMNAS_EXPORTACION,
  aCsv,
  aJson,
  aJsonl,
  campoCsv,
  neutralizarFormula,
  verificarRango,
  type CabeceraExportacion,
  type FilaExportada,
} from './exportar.js';

const TENANT = '01920000-0000-7000-8000-000000000001';

function contenido(numeroOrden: number, accion = 'aprobacion.aprobada'): ContenidoEntrada {
  return {
    tenantId: TENANT,
    numeroOrden,
    creadoEn: new Date(Date.UTC(2026, 8, 20, 10, numeroOrden)),
    actorTipo: 'persona',
    accion,
    datosReferenciados: [{ tipo: 'aprobacion', id: `a-${numeroOrden}` }],
    resultado: 'exito',
    costeEuros: 0,
    duracionMs: 10,
  };
}

/** Construye una cadena encadenada de `cuantos` eslabones desde el génesis. */
function cadena(cuantos: number, desde = 1) {
  const eslabones = [];
  let anterior = HASH_GENESIS;
  // Cuando el rango no empieza en 1, el ancla es un hash cualquiera que sí existe.
  if (desde > 1) anterior = calcularHash(contenido(desde - 1), HASH_GENESIS);
  const ancla = anterior;
  for (let i = 0; i < cuantos; i += 1) {
    const cuerpo = contenido(desde + i);
    const hash = calcularHash(cuerpo, anterior);
    eslabones.push({ ...cuerpo, hash, hashAnterior: anterior });
    anterior = hash;
  }
  return { eslabones, ancla };
}

describe('verificarRango', () => {
  it('un rango vacío es válido: el tenant no hizo nada en esas fechas', () => {
    expect(verificarRango([])).toEqual({ valida: true, entradas: 0, anclada: true });
  });

  it('acepta el rango que empieza en el génesis', () => {
    const { eslabones } = cadena(5);
    expect(verificarRango(eslabones, HASH_GENESIS).valida).toBe(true);
  });

  it('acepta un rango intermedio anclado en el hash de la entrada anterior', () => {
    const { eslabones, ancla } = cadena(3, 12);
    const resultado = verificarRango(eslabones, ancla);
    expect(resultado.valida).toBe(true);
    expect(resultado.entradas).toBe(3);
  });

  it('rechaza el rango intermedio si el ancla no es la que toca', () => {
    const { eslabones } = cadena(3, 12);
    const resultado = verificarRango(eslabones, HASH_GENESIS);
    expect(resultado.valida).toBe(false);
    expect(resultado.rotaEn).toBe(12);
    expect(resultado.motivo).toContain('no encadena');
  });

  it('detecta el hueco en el número de orden', () => {
    const { eslabones } = cadena(4);
    // Se quita la segunda: es lo que deja una purga mal hecha o una partición suelta.
    const conHueco = eslabones.filter((_, indice) => indice !== 1);
    const resultado = verificarRango(conHueco, HASH_GENESIS);
    expect(resultado.valida).toBe(false);
    expect(resultado.rotaEn).toBe(3);
    expect(resultado.motivo).toContain('Falta la entrada 2');
  });

  it('detecta la entrada alterada aunque el encadenado siga cuadrando', () => {
    const { eslabones } = cadena(3);
    // Se cambia la acción y se deja el hash guardado tal cual: es la manipulación
    // más probable, porque quien altera la base no recalcula la cadena.
    const alterados = eslabones.map((eslabon, indice) =>
      indice === 1 ? { ...eslabon, accion: 'aprobacion.rechazada' } : eslabon,
    );
    const resultado = verificarRango(alterados, HASH_GENESIS);
    expect(resultado.valida).toBe(false);
    expect(resultado.rotaEn).toBe(2);
    expect(resultado.motivo).toContain('alterada');
  });

  it('detecta el eslabón cuyo hash anterior se cambió a mano', () => {
    const { eslabones } = cadena(3);
    const alterados = eslabones.map((eslabon, indice) =>
      indice === 2 ? { ...eslabon, hashAnterior: HASH_GENESIS } : eslabon,
    );
    expect(verificarRango(alterados, HASH_GENESIS).rotaEn).toBe(3);
  });
});

describe('CSV', () => {
  it('entrecomilla comas, comillas y saltos de línea, y dobla las comillas', () => {
    expect(campoCsv('sin nada')).toBe('sin nada');
    expect(campoCsv('con, coma')).toBe('"con, coma"');
    expect(campoCsv('con "comillas"')).toBe('"con ""comillas"""');
    expect(campoCsv('con\nsalto')).toBe('"con\nsalto"');
    expect(campoCsv(null)).toBe('');
    expect(campoCsv(42)).toBe('42');
  });

  it('neutraliza lo que una hoja de cálculo ejecutaría como fórmula', () => {
    expect(neutralizarFormula('=1+1')).toBe("'=1+1");
    expect(neutralizarFormula('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(neutralizarFormula('-2+3')).toBe("'-2+3");
    expect(neutralizarFormula('+34600000000')).toBe("'+34600000000");
    expect(neutralizarFormula('0.0042')).toBe('0.0042');
    expect(neutralizarFormula('aprobacion.aprobada')).toBe('aprobacion.aprobada');
  });

  it('el campo con fórmula sale neutralizado y entrecomillado si además lleva coma', () => {
    expect(campoCsv('=HYPERLINK("http://x"),1')).toBe('"\'=HYPERLINK(""http://x""),1"');
  });

  it('escribe la cabecera de columnas y una línea por entrada', () => {
    const csv = aCsv([fila(1), fila(2)]);
    const lineas = csv.trimEnd().split('\n');
    expect(lineas[0]).toBe(COLUMNAS_EXPORTACION.join(','));
    expect(lineas).toHaveLength(3);
    expect(lineas[1]).toContain('aprobacion.aprobada');
  });

  it('un CSV sin entradas es solo la cabecera', () => {
    expect(aCsv([]).trimEnd().split('\n')).toHaveLength(1);
  });
});

describe('JSON y JSON por líneas', () => {
  it('el JSON lleva la cabecera con el veredicto y las entradas sin tocar', () => {
    const documento = JSON.parse(aJson(cabecera('json'), [fila(1)])) as {
      cabecera: CabeceraExportacion;
      entradas: FilaExportada[];
    };
    expect(documento.cabecera.verificacion.valida).toBe(true);
    expect(documento.entradas).toHaveLength(1);
    // Ni fórmulas neutralizadas ni valores reescritos: el JSON es la evidencia fiel.
    expect(documento.entradas[0]?.accion).toBe('aprobacion.aprobada');
  });

  it('el JSON por líneas empieza por la cabecera y sigue con una entrada por línea', () => {
    const lineas = aJsonl(cabecera('jsonl'), [fila(1), fila(2)])
      .trimEnd()
      .split('\n');
    expect(lineas).toHaveLength(3);
    expect((JSON.parse(lineas[0] ?? '{}') as CabeceraExportacion).tipo).toBe('cabecera');
    expect((JSON.parse(lineas[2] ?? '{}') as FilaExportada).numero_orden).toBe(2);
  });

  it('el JSON no neutraliza fórmulas: eso es cosa del CSV', () => {
    const conFormula = { ...fila(1), accion: '=1+1' };
    const lineas = aJsonl(cabecera('jsonl'), [conFormula]).trimEnd().split('\n');
    expect(JSON.parse(lineas[1] ?? '{}')).toEqual(conFormula);
  });
});

function fila(numeroOrden: number): FilaExportada {
  const cuerpo = contenido(numeroOrden);
  return {
    numero_orden: numeroOrden,
    creado_en: normalizarFecha(cuerpo.creadoEn).toISOString(),
    actor_tipo: 'persona',
    actor_id: null,
    puesto_id: null,
    version_puesto_id: null,
    tarea_id: null,
    paso_id: null,
    accion: cuerpo.accion,
    herramienta: 'correo',
    datos_referenciados: JSON.stringify(cuerpo.datosReferenciados),
    resultado: 'exito',
    coste_euros: '0.0000',
    duracion_ms: 10,
    aprobada_por_persona_id: null,
    leccion_aplicada_id: null,
    nivel_aplicado: 'n1',
    cambio_de_nivel: null,
    hash_anterior: HASH_GENESIS,
    hash: calcularHash(cuerpo, HASH_GENESIS),
  };
}

function cabecera(formato: 'json' | 'jsonl'): CabeceraExportacion {
  return {
    tipo: 'cabecera',
    tenantId: TENANT,
    desde: null,
    hasta: null,
    formato,
    entradas: 1,
    primerNumeroOrden: 1,
    ultimoNumeroOrden: 1,
    generadoEn: new Date(Date.UTC(2026, 8, 20, 12)).toISOString(),
    verificacion: { valida: true, entradas: 1, anclada: true },
  };
}
