/**
 * Director de IA v0: de una frase a una propuesta de operación «contratar».
 *
 * Función pura sobre datos: la frase, el catálogo de plantillas, la política de
 * operaciones y lo que la organización ya tiene (departamentos, puestos y
 * herramientas autorizadas por conector). No llama a ningún modelo ni tiene prompt
 * de sistema (docs/specs/sala-v0.md, decisión 2). Devuelve el mismo objeto que
 * producirán el panel y el Director proactivo (ADR-006, ADR-019): una propuesta de
 * operación con ficha, herramientas, guardrails, niveles, coste y reversión, que
 * pasa por el motor de políticas antes de presentarse.
 *
 * Lo que no sabe hacer lo dice con una aclaración, sin inventar: una plantilla que
 * no existe, un departamento que la organización no tiene o un puesto que ya está.
 */
import { decidirPaso, type Nivel, type PapelModelo } from '@aiw/domain';
import { aparece } from '@aiw/rooms';

import catalogoDePlantillas from './catalogo/plantillas.json' with { type: 'json' };
import politicaDeOperaciones from './catalogo/operaciones.json' with { type: 'json' };

export type TipoHerramienta = 'lectura' | 'escritura';

export interface HerramientaDePlantilla {
  nombre: string;
  tipo: TipoHerramienta;
  descripcion: string;
}

/**
 * Con qué modelo decide un puesto, en la forma que lee el enrutador de `@aiw/models`
 * (`enrutadoModelo`): un papel del ADR-018, el papel que prueba tras un rechazo del
 * clasificador y, para las ejecuciones deterministas (CI, evals de humo, demo local),
 * el guion de prueba que lo contesta. El identificador concreto lo resuelve
 * `@aiw/models` según el proveedor que elija cada proceso, no esta plantilla.
 */
export interface EnrutadoDePlantilla {
  papel: PapelModelo;
  papelRespaldo?: PapelModelo;
  modeloDePrueba?: string;
}

export interface Plantilla {
  id: string;
  version: number;
  nombre: string;
  departamento: string;
  sinonimos: string[];
  temas: string[];
  claseRiesgo: string;
  ficha: {
    mision: string;
    tareas: string[];
    limites: string[];
    colabora: string[];
    escala: string;
  };
  herramientas: HerramientaDePlantilla[];
  guardrails: { clase: string; regla: string }[];
  niveles: Record<string, Nivel>;
  presupuestoPorTareaEuros: number;
  guardiasSalida: string[];
  coste: { tareasMes: number; eurosMesCliente: number; eurosMesModelo: number };
  enrutadoModelo: EnrutadoDePlantilla;
  prompt: string;
}

export interface CatalogoDePlantillas {
  version: number;
  plantillas: Plantilla[];
}

export interface PoliticaDeOperaciones {
  version: number;
  niveles: Record<string, Nivel>;
  clasesProhibidas: string[];
  caducidadDias: number;
  diasDePrueba: number;
}

export const CATALOGO: CatalogoDePlantillas = catalogoDePlantillas as CatalogoDePlantillas;
export const POLITICA_OPERACIONES: PoliticaDeOperaciones =
  politicaDeOperaciones as PoliticaDeOperaciones;

/** Clase de acción de la operación en la política de operaciones. */
export const CLASE_CONTRATAR = 'organizacion.contratar';

export interface ContextoDelDirector {
  departamentos: { id: string; nombre: string; estado: string }[];
  puestos: {
    id: string;
    nombre: string;
    departamentoId: string;
    estado: string;
    plantillaId?: string | undefined;
  }[];
  /** Conectores activos con las herramientas que la organización ya autorizó en ellos. */
  conectores: { id: string; nombre: string; herramientasAutorizadas: string[] }[];
}

export interface HerramientaPropuesta extends HerramientaDePlantilla {
  conectorId: string;
  conectorNombre: string;
}

export interface PropuestaDeContratacion {
  tipo: 'contratar';
  resumen: string;
  plantilla: { id: string; version: number };
  departamento: { id: string; nombre: string };
  puesto: {
    nombre: string;
    claseRiesgo: string;
    estadoInicial: 'en_prueba';
    diasDePrueba: number;
    ficha: Plantilla['ficha'] & { temas: string[]; plantilla: { id: string; version: number } };
    enrutadoModelo: EnrutadoDePlantilla;
    prompt: string;
    politica: {
      niveles: Record<string, Nivel>;
      presupuestoPorTareaEuros: number;
      guardiasEntrada: string[];
      guardiasSalida: string[];
      clasesProhibidas: string[];
    };
  };
  herramientas: { disponibles: HerramientaPropuesta[]; porConectar: HerramientaDePlantilla[] };
  guardrails: Plantilla['guardrails'];
  coste: Plantilla['coste'];
  nivelExigido: Nivel;
  motivoNivel: string;
  caducidadDias: number;
  entidadesTocadas: { tipo: string; id: string }[];
  reversion: { operacion: 'dar_de_baja'; descripcion: string };
}

export type RespuestaDelDirector =
  | { tipo: 'propuesta'; propuesta: PropuestaDeContratacion; mensaje: string }
  | { tipo: 'aclaracion'; mensaje: string };

/** La plantilla que más sinónimos comparte con la frase. Ninguna si no hay coincidencia. */
export function elegirPlantilla(
  frase: string,
  catalogo: CatalogoDePlantillas = CATALOGO,
): Plantilla | undefined {
  const puntuadas = catalogo.plantillas
    .map((plantilla) => ({
      plantilla,
      puntos: plantilla.sinonimos.filter((s) => aparece(s, frase)).length,
    }))
    .filter((p) => p.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos);
  return puntuadas[0]?.plantilla;
}

function euros(valor: number): string {
  return `${valor.toLocaleString('es-ES', { maximumFractionDigits: 2 })} €`;
}

export function proponerContratacion(
  frase: string,
  contexto: ContextoDelDirector,
  catalogo: CatalogoDePlantillas = CATALOGO,
  politica: PoliticaDeOperaciones = POLITICA_OPERACIONES,
): RespuestaDelDirector {
  const plantilla = elegirPlantilla(frase, catalogo);
  if (!plantilla) {
    const nombres = catalogo.plantillas.map((p) => p.nombre).join(', ');
    return {
      tipo: 'aclaracion',
      mensaje: `No encuentro en el catálogo un puesto que encaje con «${frase}». Puedo contratar: ${nombres}.`,
    };
  }

  // El departamento que dice la frase manda; si no dice ninguno, el de la plantilla.
  const nombrado = contexto.departamentos.find((d) => aparece(d.nombre, frase));
  const departamento =
    nombrado ?? contexto.departamentos.find((d) => aparece(d.nombre, plantilla.departamento));
  if (!departamento || departamento.estado !== 'activo') {
    return {
      tipo: 'aclaracion',
      mensaje:
        `${plantilla.nombre} trabaja en ${plantilla.departamento}, y la organización no tiene ` +
        `ese departamento activo. Crear el departamento es otra operación: pídemela primero.`,
    };
  }

  // El nombre es único por departamento, también para un puesto dado de baja: sus
  // 30 días de archivo se recuperan con otra operación, no contratándolo de nuevo.
  const repetido = contexto.puestos.find(
    (p) =>
      p.departamentoId === departamento.id &&
      (p.plantillaId === plantilla.id || aparece(plantilla.nombre, p.nombre)),
  );
  if (repetido) {
    return {
      tipo: 'aclaracion',
      mensaje:
        repetido.estado === 'dado_de_baja'
          ? `${repetido.nombre} está dado de baja en ${departamento.nombre}: recuperarlo es otra operación.`
          : `${departamento.nombre} ya tiene el puesto ${repetido.nombre} (${repetido.estado.replace('_', ' ')}). ` +
            'Si quieres otro igual, dilo y lo trato como un duplicado.',
    };
  }

  const disponibles: HerramientaPropuesta[] = [];
  const porConectar: HerramientaDePlantilla[] = [];
  for (const herramienta of plantilla.herramientas) {
    const conector = contexto.conectores.find((c) =>
      c.herramientasAutorizadas.includes(herramienta.nombre),
    );
    if (conector) {
      disponibles.push({
        ...herramienta,
        conectorId: conector.id,
        conectorNombre: conector.nombre,
      });
    } else {
      porConectar.push(herramienta);
    }
  }

  // Contratar pasa por el motor de políticas como cualquier otro paso: la clase de
  // acción es la operación y la política es dato versionado del catálogo.
  const veredicto = decidirPaso(
    { claseAccion: CLASE_CONTRATAR, tipo: 'escritura' },
    {
      estadoPuesto: 'activo',
      politica: {
        niveles: politica.niveles,
        guardiasEntrada: [],
        guardiasSalida: [],
        clasesProhibidas: politica.clasesProhibidas,
      },
      presupuesto: { limiteEuros: null, gastadoEuros: 0 },
    },
  );
  if (veredicto.decision === 'rechazar' || veredicto.decision === 'detener') {
    return {
      tipo: 'aclaracion',
      mensaje: `La política de la organización no me deja proponer esta contratación: ${veredicto.motivo}`,
    };
  }
  const nivelExigido: Nivel = veredicto.nivelAplicado ?? 'n1';

  const resumen = `Contratar ${plantilla.nombre} en ${departamento.nombre}, en prueba ${politica.diasDePrueba} días`;
  const propuesta: PropuestaDeContratacion = {
    tipo: 'contratar',
    resumen,
    plantilla: { id: plantilla.id, version: plantilla.version },
    departamento: { id: departamento.id, nombre: departamento.nombre },
    puesto: {
      nombre: plantilla.nombre,
      claseRiesgo: plantilla.claseRiesgo,
      estadoInicial: 'en_prueba',
      diasDePrueba: politica.diasDePrueba,
      ficha: {
        ...plantilla.ficha,
        temas: plantilla.temas,
        plantilla: { id: plantilla.id, version: plantilla.version },
      },
      enrutadoModelo: plantilla.enrutadoModelo,
      prompt: plantilla.prompt,
      politica: {
        niveles: plantilla.niveles,
        presupuestoPorTareaEuros: plantilla.presupuestoPorTareaEuros,
        guardiasEntrada: [],
        guardiasSalida: plantilla.guardiasSalida,
        clasesProhibidas: [],
      },
    },
    herramientas: { disponibles, porConectar },
    guardrails: plantilla.guardrails,
    coste: plantilla.coste,
    nivelExigido,
    motivoNivel: veredicto.motivo,
    caducidadDias: politica.caducidadDias,
    entidadesTocadas: [{ tipo: 'departamento', id: departamento.id }],
    reversion: {
      operacion: 'dar_de_baja',
      descripcion: `Dar de baja ${plantilla.nombre} durante el periodo de prueba, sin coste.`,
    },
  };

  const faltan =
    porConectar.length === 0
      ? 'todas disponibles'
      : `${disponibles.length} disponibles y ${porConectar.length} por conectar`;
  const mensaje =
    `Propongo contratar ${plantilla.nombre} en ${departamento.nombre}. ` +
    `Misión: ${plantilla.ficha.mision} Herramientas: ${faltan}. ` +
    `Coste de referencia: ${euros(plantilla.coste.eurosMesCliente)} al mes (unas ${plantilla.coste.tareasMes} tareas). ` +
    `Arranca en prueba ${politica.diasDePrueba} días con las escrituras en N1. ` +
    `Necesita tu confirmación (${nivelExigido.toUpperCase()}).`;
  return { tipo: 'propuesta', propuesta, mensaje };
}
