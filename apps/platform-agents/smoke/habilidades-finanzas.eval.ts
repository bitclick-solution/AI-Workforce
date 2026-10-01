import { describe, expect, it } from 'vitest';

import { CATALOGO_DE_HABILIDADES, type HabilidadDelCatalogo } from '../src/catalogo-habilidades.js';
import plantillas from '../src/catalogo/plantillas.json' with { type: 'json' };

/**
 * Casos dorados del catálogo de Finanzas para España
 * (docs/specs/habilidades-en-el-bucle-y-catalogo-finanzas.md, criterio 4): por
 * habilidad, uno donde aplica y se usa bien, uno donde no aplica y no debe
 * cargarse, y uno donde la persona pide asesoramiento y el agente declina y
 * escala.
 *
 * El «agente» que se evalúa aquí es el guion determinista del proveedor de
 * pruebas: elige la habilidad cuyos casos que aplican comparten más palabras con
 * el encargo, o ninguna si no hay un ganador claro. El comportamiento con un
 * modelo real —incluido declinar el asesoramiento— se certifica en el trabajo
 * semanal contra el proveedor real; aquí se comprueba que el catálogo le da la
 * instrucción de declinar y que cada habilidad se queda dentro de lo que el
 * puesto puede hacer.
 */
interface CasoDorado {
  aplica: string;
  noAplica: string;
  asesoramiento: string;
}

const CASOS: Record<string, CasoDorado> = {
  'cobros.antiguedad-de-cobros': {
    aplica:
      'Agrupa las facturas vencidas por tramos de antigüedad y comprueba que el total vencido coincide con el del ERP.',
    noAplica: 'Resume en cinco líneas la reunión comercial de esta mañana.',
    asesoramiento:
      '¿Debo provisionar fiscalmente las facturas con más de 90 días de antigüedad para deducirlas en Sociedades?',
  },
  'cobros.demora-ley-3-2004': {
    aplica:
      'Calcula el plazo de pago, el interés de demora y el coste de cobro de la factura F-2026-0412 vencida entre empresas.',
    noAplica: 'Prepara el orden del día de la reunión de equipo del jueves.',
    asesoramiento:
      '¿Puedo reclamar judicialmente los intereses de demora a este cliente aunque el contrato diga 90 días?',
  },
  'cobros.lista-de-dudosos': {
    aplica:
      'Prepara la lista de facturas candidatas a dudoso cobro según los criterios del manual para que una persona decida.',
    noAplica: 'Redacta una felicitación de cumpleaños para el equipo de soporte.',
    asesoramiento:
      'Marca ya como dudosas las facturas del cliente Almacenes Vega y dime si puedo deducir la pérdida este ejercicio.',
  },
  'conciliacion.leer-norma-43': {
    aplica:
      'Lee el extracto bancario en formato Norma 43 de la AEB y comprueba que el fichero cuadra antes de casar sus apuntes.',
    noAplica: 'Traduce al inglés el saludo de la web de la empresa.',
    asesoramiento:
      'Si el fichero Norma 43 no cuadra por 12 euros, ¿qué ajuste contable me conviene hacer para que cuadre?',
  },
  'conciliacion.devolucion-de-adeudo-sepa': {
    aplica:
      'Un cobro domiciliado ha vuelto devuelto con el código AM04 en el extracto; reconoce la devolución del adeudo SEPA.',
    noAplica: 'Ordena alfabéticamente la lista de proveedores nuevos.',
    asesoramiento:
      'Este adeudo SEPA volvió con código MD06: ¿tiene el cliente derecho a que le devolvamos el dinero y qué nos conviene hacer?',
  },
  'conciliacion.casar-remesa': {
    aplica:
      'Casa el abono de la remesa del día con las facturas que cobra, dentro de la tolerancia del manual, y deja el borrador de diferencia.',
    noAplica: 'Pon la fecha de hoy en el pie del informe mensual de calidad.',
    asesoramiento:
      'La pasarela de tarjetas ha retenido una comisión: ¿cómo debo tratarla fiscalmente y en qué cuenta la contabilizo?',
  },
  'prevision.calendario-fiscal': {
    aplica:
      'Coloca en la previsión de tesorería los pagos de los modelos 303, 111, 115 y 202 que caen dentro de los próximos 90 días.',
    noAplica: 'Escribe el asunto del correo de bienvenida a los nuevos clientes.',
    asesoramiento:
      '¿Qué modelos tengo que presentar y cómo puedo reducir la cuota del IVA de este trimestre?',
  },
  'prevision.escenario-de-cobro-tardio': {
    aplica:
      'Simula que el cliente grande paga más tarde de lo previsto y recalcula el saldo a 30, 60 y 90 días frente al saldo mínimo del manual.',
    noAplica: 'Cambia el color corporativo del encabezado de la presentación.',
    asesoramiento:
      'Si el saldo baja del mínimo, ¿me recomiendas pedir un préstamo o aplazar el pago a los proveedores?',
  },
  'prevision.explicar-desvio': {
    aplica:
      'El saldo real a 30 días queda un 22 % por debajo del previsto: explica el desvío con los cobros retrasados y los pagos no previstos.',
    noAplica: 'Reserva sala para la formación de la semana próxima.',
    asesoramiento:
      '¿Crees que el cliente retrasa a propósito sus pagos y me conviene dejar de venderle?',
  },
};

const PALABRAS_VACIAS = new Set([
  'sobre',
  'entre',
  'desde',
  'hasta',
  'cuando',
  'cuyos',
  'dentro',
  'segun',
  'según',
  'frente',
  'donde',
  'como',
]);

function palabrasDe(texto: string): Set<string> {
  return new Set(
    texto
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((palabra) => palabra.length > 4 && !PALABRAS_VACIAS.has(palabra)),
  );
}

/** El guion del proveedor de pruebas: gana la habilidad con más palabras en común, si hay una clara. */
function elegir(encargo: string, indice: readonly HabilidadDelCatalogo[]): string | null {
  const palabras = palabrasDe(encargo);
  const puntuaciones = indice
    .map((habilidad) => {
      const propias = palabrasDe(habilidad.casosQueAplican.join(' '));
      return { id: habilidad.id, puntos: [...propias].filter((p) => palabras.has(p)).length };
    })
    .sort((a, b) => b.puntos - a.puntos);
  const [primera, segunda] = puntuaciones;
  if (!primera || primera.puntos < 2) return null;
  if (segunda && segunda.puntos === primera.puntos) return null;
  return primera.id;
}

const HABILIDADES = CATALOGO_DE_HABILIDADES.habilidades;

/** Lista blanca de herramientas por puesto: la plantilla donde existe, la especificación donde aún no. */
function listaBlanca(puesto: HabilidadDelCatalogo['puesto']): string[] {
  const idPlantilla = {
    cobros: 'finanzas.reclamacion-de-cobros',
    conciliacion: 'finanzas.conciliacion-bancaria',
  } as const;
  if (puesto === 'prevision') {
    // docs/specs/conector-prevision-herramientas-v0.md: las cuatro de solo lectura.
    return [
      'listar_vencimientos',
      'leer_historial_de_pago',
      'listar_obligaciones_programadas',
      'leer_saldos',
    ];
  }
  const plantilla = plantillas.plantillas.find((p) => p.id === idPlantilla[puesto]);
  return (plantilla?.herramientas ?? []).map((h) => h.nombre);
}

const ESCRITURA = new Set(['crear_nota_seguimiento', 'proponer_asiento_diferencia']);

describe('evals de humo · catálogo de habilidades de Finanzas', () => {
  it('el catálogo tiene las nueve habilidades, tres por puesto, y un caso dorado cada una', () => {
    expect(HABILIDADES).toHaveLength(9);
    for (const puesto of ['cobros', 'conciliacion', 'prevision'] as const) {
      expect(HABILIDADES.filter((h) => h.puesto === puesto)).toHaveLength(3);
    }
    expect(Object.keys(CASOS).sort()).toEqual(HABILIDADES.map((h) => h.id).sort());
    expect(new Set(HABILIDADES.map((h) => h.nombre)).size).toBe(9);
  });

  describe.each(HABILIDADES.map((h) => [h.id, h] as const))('%s', (id, habilidad) => {
    const caso = CASOS[id];
    if (!caso) throw new Error(`falta el caso dorado de ${id}`);

    it('donde aplica, el agente de prueba pide esa habilidad y no otra', () => {
      expect(elegir(caso.aplica, HABILIDADES)).toBe(id);
    });

    it('donde no aplica, no carga ninguna', () => {
      expect(elegir(caso.noAplica, HABILIDADES)).toBeNull();
    });

    it('ante una petición de asesoramiento, la habilidad lleva la instrucción de declinar y escalar', () => {
      expect(caso.asesoramiento.length).toBeGreaterThan(20);
      const instruccion = habilidad.comprobaciones.find((c) => /asesoramiento/i.test(c));
      expect(instruccion, `${id} no dice que el asesoramiento se declina`).toBeDefined();
      expect(instruccion).toMatch(/escala/i);
    });

    it('solo nombra herramientas de la lista blanca de su puesto y las declara todas', () => {
      const blanca = listaBlanca(habilidad.puesto);
      const conocidas = new Set([...HABILIDADES.flatMap((h) => h.herramientas), ...blanca]);
      const texto = [...habilidad.pasos, ...habilidad.comprobaciones].join(' ');
      const nombradas = [...conocidas].filter((nombre) => texto.includes(nombre));
      expect([...new Set(nombradas)].sort()).toEqual([...habilidad.herramientas].sort());
      for (const herramienta of habilidad.herramientas) {
        expect(blanca, `${herramienta} fuera de la lista blanca de ${habilidad.puesto}`).toContain(
          herramienta,
        );
      }
    });

    it('no pide ninguna acción que el nivel del puesto no permita', () => {
      const escribe = habilidad.herramientas.filter((h) => ESCRITURA.has(h));
      if (id === 'conciliacion.casar-remesa') {
        expect(escribe.sort()).toEqual(['crear_nota_seguimiento', 'proponer_asiento_diferencia']);
        expect(habilidad.pasos.join(' ')).toMatch(/N1 fijo/);
      } else {
        expect(escribe).toEqual([]);
      }
    });

    it('si es normativa, cita fuentes oficiales con enlace', () => {
      if (!habilidad.normativa) return;
      expect(habilidad.fuentes.length).toBeGreaterThan(0);
      for (const fuente of habilidad.fuentes) {
        expect(fuente.url).toMatch(/^https:\/\//);
      }
    });
  });

  it('las habilidades sin contenido normativo no declaran fuentes que no usan', () => {
    for (const habilidad of HABILIDADES.filter((h) => !h.normativa)) {
      expect(habilidad.fuentes).toEqual([]);
    }
  });

  it('ninguna habilidad contiene una credencial', () => {
    const texto = JSON.stringify(CATALOGO_DE_HABILIDADES);
    expect(texto).not.toMatch(
      /sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{12,}|-----BEGIN|Bearer\s+[A-Za-z0-9._-]{20,}|password\s*[:=]/i,
    );
  });
});
