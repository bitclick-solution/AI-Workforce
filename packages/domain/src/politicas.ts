/**
 * Motor mínimo de políticas: qué le pasa a un paso antes de ejecutarse.
 *
 * Zona crítica: motor de políticas y niveles. Aquí no hay base de datos, ni reloj,
 * ni registro: son funciones puras sobre datos. Quien decide qué pasa con un paso
 * no puede depender de nada que se pueda caer, porque la respuesta «no sé» no
 * existe: o el paso ejecuta, o espera permiso, o se simula, o se rechaza.
 *
 * La tabla de decisión tiene tres entradas —clase de acción, nivel de autonomía y
 * estado del puesto— y un cuarto corte que va por delante de todas: el presupuesto.
 * Se decide en ese orden a propósito: una tarea sin presupuesto no ejecuta ni una
 * lectura barata, y eso es más importante que cualquier nivel que tenga el puesto.
 *
 * Qué no hace este motor (ADR-005 completo, fuera de esta rebanada): rangos del
 * Director de IA, ventana de deshacer de N2, muestreo de N3 y ascensos por
 * expediente. Lo que sí hace queda cerrado por la tabla de este módulo.
 */
import { NIVELES, type EstadoPuesto, type Nivel } from './enumeraciones.js';
import type { PoliticaPuesto } from './esquemas/index.js';

/**
 * Lo que una herramienta le hace al mundo. Lo clasifica el registro de
 * herramientas del gateway, no el modelo: si el modelo pudiera decir «esto es una
 * lectura», la frontera no serviría de nada.
 */
export const TIPOS_CLASE_ACCION = ['lectura', 'escritura'] as const;

export type TipoClaseAccion = (typeof TIPOS_CLASE_ACCION)[number];

/**
 * Qué se hace con el paso.
 *
 * - `ejecutar`: adelante, y se anota con el nivel aplicado.
 * - `pedir_aprobacion`: se crea la aprobación con borrador opaco y el flujo espera.
 * - `simular`: se anota lo que se habría hecho y no se toca ningún sistema externo.
 * - `rechazar`: no se hace y queda en el libro como `rechazado`.
 * - `detener`: no es sobre el paso, es sobre la tarea: el bucle para aquí.
 */
export const DECISIONES_PASO = [
  'ejecutar',
  'pedir_aprobacion',
  'simular',
  'rechazar',
  'detener',
] as const;

export type DecisionPaso = (typeof DECISIONES_PASO)[number];

/** Fracción del presupuesto a la que se avisa (ADR-003: aviso al 80 %, pausa al 100 %). */
export const FRACCION_AVISO = 0.8;

/** Paso que el bucle quiere dar, ya clasificado por el registro de herramientas. */
export interface PasoPropuesto {
  /** Clave con la que se busca el nivel en la política. Suele ser el tipo. */
  claseAccion: string;
  tipo: TipoClaseAccion;
  /** Lo que se estima que va a costar. Sin estimación, se supone gratis. */
  costeEstimadoEuros?: number | undefined;
}

/** Lo gastado y lo que se podía gastar. `limiteEuros` nulo es «sin límite declarado». */
export interface PresupuestoTarea {
  limiteEuros: number | null;
  gastadoEuros: number;
}

export interface ContextoPolitica {
  /** Estado del puesto en el momento del paso, no cuando arrancó la tarea. */
  estadoPuesto: EstadoPuesto;
  /** Política congelada en la versión de puesto con la que corre la tarea. */
  politica: PoliticaPuesto;
  presupuesto: PresupuestoTarea;
}

export interface VeredictoPolitica {
  decision: DecisionPaso;
  /** Nivel con el que se resolvió. Nulo cuando la decisión no mira ningún nivel. */
  nivelAplicado: Nivel | null;
  /** Frase en español que va al libro de auditoría tal cual. */
  motivo: string;
  /**
   * Si tras una aprobación el agente ejecuta él mismo. En N0 no: N0 es manual, el
   * agente propone y la persona actúa, así que un N0 aprobado se queda en simulado.
   */
  ejecutaTrasAprobacion: boolean;
  /** Cierto a partir del 80 % del presupuesto consumido. El aviso no detiene nada. */
  avisoPresupuesto: boolean;
}

export interface EstadoPresupuesto {
  /** Entre 0 y 1 con límite declarado; 0 sin límite, porque no hay nada que consumir. */
  fraccionConsumida: number;
  avisar: boolean;
  agotado: boolean;
}

/**
 * Cuánto queda del presupuesto de la tarea contando lo que va a costar el paso.
 *
 * Sin límite declarado no se detiene nada: la tarea la para el número máximo de
 * pasos del bucle, no el dinero. Un límite de cero sí detiene, y eso es deliberado:
 * cero euros es un presupuesto, y significa que esta tarea no gasta.
 */
export function evaluarPresupuesto(
  presupuesto: PresupuestoTarea,
  costeEstimadoEuros = 0,
): EstadoPresupuesto {
  const limite = presupuesto.limiteEuros;
  if (limite === null) return { fraccionConsumida: 0, avisar: false, agotado: false };
  if (limite <= 0) return { fraccionConsumida: 1, avisar: true, agotado: true };

  const gastado = Math.max(0, presupuesto.gastadoEuros);
  const proyectado = gastado + Math.max(0, costeEstimadoEuros);
  return {
    fraccionConsumida: gastado / limite,
    avisar: gastado / limite >= FRACCION_AVISO,
    agotado: gastado >= limite || proyectado > limite,
  };
}

/** Estados en los que el puesto no da ni un paso: no está trabajando. */
const ESTADOS_QUE_NO_TRABAJAN = new Set<EstadoPuesto>(['propuesto', 'pausado', 'dado_de_baja']);

/** Nivel máximo que se aplica en cada estado del puesto. Nulo es «sin techo». */
function techoDelEstado(estado: EstadoPuesto): Nivel | null {
  // Un puesto degradado por incidente no vuelve a actuar solo hasta que alguien lo
  // recupere (ADR-005: bajada automática por incidente). El techo es N1: todo lo
  // que hiciera sin pedir permiso, ahora lo pide.
  return estado === 'degradado' ? 'n1' : null;
}

/**
 * El menor de dos niveles. N0 es el más restrictivo y N3 el más autónomo.
 *
 * Es la única comparación de niveles de la plataforma: el gateway la importa de
 * aquí para que la regla viva en un solo sitio.
 */
export function menorNivel(a: Nivel, b: Nivel): Nivel {
  return NIVELES.indexOf(a) <= NIVELES.indexOf(b) ? a : b;
}

/**
 * Decide qué pasa con un paso. Es la tabla completa: clase × nivel × estado.
 *
 * Nadie llama a este motor «por si acaso»: el bucle lo llama antes de cada paso,
 * con el estado del puesto leído en ese momento, y hace exactamente lo que diga.
 */
export function decidirPaso(paso: PasoPropuesto, contexto: ContextoPolitica): VeredictoPolitica {
  const presupuesto = evaluarPresupuesto(contexto.presupuesto, paso.costeEstimadoEuros);

  // El presupuesto va primero. Una tarea sin dinero no ejecuta ni una lectura, y
  // detenerse no es un fallo: es la conducta que el ADR-003 promete al cliente.
  if (presupuesto.agotado) {
    return {
      decision: 'detener',
      nivelAplicado: null,
      motivo: 'Presupuesto de la tarea agotado: el bucle se detiene y pide ampliación.',
      ejecutaTrasAprobacion: false,
      avisoPresupuesto: true,
    };
  }

  const aviso = presupuesto.avisar;

  if (contexto.politica.clasesProhibidas.includes(paso.claseAccion)) {
    return {
      decision: 'rechazar',
      nivelAplicado: null,
      motivo: `La clase de acción «${paso.claseAccion}» está prohibida en la política del puesto.`,
      ejecutaTrasAprobacion: false,
      avisoPresupuesto: aviso,
    };
  }

  if (ESTADOS_QUE_NO_TRABAJAN.has(contexto.estadoPuesto)) {
    return {
      decision: 'rechazar',
      nivelAplicado: null,
      motivo: `El puesto está ${contexto.estadoPuesto}: no toma ningún paso.`,
      ejecutaTrasAprobacion: false,
      avisoPresupuesto: aviso,
    };
  }

  // «En prueba» es operativo, no declarativo (ADR-015): ninguna escritura sale al
  // mundo. No se pide aprobación, porque aprobar no cambiaría nada: se simula.
  if (contexto.estadoPuesto === 'en_prueba' && paso.tipo === 'escritura') {
    return {
      decision: 'simular',
      nivelAplicado: contexto.politica.niveles[paso.claseAccion] ?? null,
      motivo: 'El puesto está en prueba: la escritura se simula y no toca ningún sistema.',
      ejecutaTrasAprobacion: false,
      avisoPresupuesto: aviso,
    };
  }

  const nivelDeclarado = contexto.politica.niveles[paso.claseAccion];
  if (nivelDeclarado === undefined) {
    // Sin nivel para la clase no hay decisión posible, y el silencio no autoriza.
    return {
      decision: 'rechazar',
      nivelAplicado: null,
      motivo: `La política del puesto no asigna nivel a la clase «${paso.claseAccion}».`,
      ejecutaTrasAprobacion: false,
      avisoPresupuesto: aviso,
    };
  }

  const techo = techoDelEstado(contexto.estadoPuesto);
  const nivel = techo === null ? nivelDeclarado : menorNivel(nivelDeclarado, techo);

  if (nivel === 'n0') {
    return {
      decision: 'pedir_aprobacion',
      nivelAplicado: nivel,
      motivo: 'N0 es manual: el agente propone y la persona ejecuta.',
      ejecutaTrasAprobacion: false,
      avisoPresupuesto: aviso,
    };
  }
  if (nivel === 'n1') {
    return {
      decision: 'pedir_aprobacion',
      nivelAplicado: nivel,
      motivo:
        techo === 'n1' && nivelDeclarado !== 'n1'
          ? `El puesto está degradado: la clase «${paso.claseAccion}» baja a N1 y pide permiso.`
          : `N1 supervisado: la clase «${paso.claseAccion}» pide permiso antes de ejecutar.`,
      ejecutaTrasAprobacion: true,
      avisoPresupuesto: aviso,
    };
  }

  return {
    decision: 'ejecutar',
    nivelAplicado: nivel,
    motivo: `${nivel.toUpperCase()} autónomo para la clase «${paso.claseAccion}».`,
    ejecutaTrasAprobacion: true,
    avisoPresupuesto: aviso,
  };
}

/** Clase de acción por defecto de una herramienta: su propio tipo. */
export function claseDeTipo(tipo: TipoClaseAccion): string {
  return tipo;
}
