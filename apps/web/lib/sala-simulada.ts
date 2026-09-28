/**
 * Fuente simulada de Sala v1: implementa el contrato de `sala-contrato.ts` con
 * datos sintéticos, sin red ni entorno. Sirve a la interfaz hasta que llegue la
 * fuente real del Constructor (`crearFuenteDeSala()` en `sala.ts`).
 *
 * Todos los nombres son inventados. Cubre los siete estados del ADR-022, incluidos
 * los tres que solo tienen los agentes, para que la interfaz los pinte todos.
 *
 * La conversación no está en el contrato: se expone aparte, con un tipo de
 * presentación, hasta que se conecten los mensajes con `salaId` del Constructor.
 */
import type {
  CambioDeSala,
  EstadoDePresencia,
  FuenteDeSala,
  MiembroDeSala,
  ResumenDeSala,
} from './sala-contrato';

const MINUTO = 60_000;
const HORA = 60 * MINUTO;

/** Cada cuánto se renueva la escritura simulada y cuánto dura cada aviso. */
export const RENOVAR_ESCRITURA_MS = 4_000;
export const DURACION_ESCRITURA_MS = 6_000;

/** Quién mira la sala en la simulación: la persona «tú». */
export const ID_DE_QUIEN_MIRA = 'persona-lucia';

const SALAS: ResumenDeSala[] = [
  { id: 'general', nombre: 'general', ambito: 'general', sinLeer: 0, menciones: 0 },
  { id: 'finanzas', nombre: 'finanzas', ambito: 'equipo', sinLeer: 0, menciones: 0 },
  {
    id: 'ventas-y-atencion',
    nombre: 'ventas-y-atención',
    ambito: 'equipo',
    sinLeer: 4,
    menciones: 2,
  },
  { id: 'marketing', nombre: 'marketing', ambito: 'equipo', sinLeer: 1, menciones: 0 },
];

interface MiembroBase {
  id: string;
  tipo: MiembroDeSala['tipo'];
  nombre: string;
  puesto?: string;
  equipo?: string;
  estado: EstadoDePresencia;
  /** Cuánto hace que está en el estado, en milisegundos. */
  hace?: number;
}

const PERSONAS: MiembroBase[] = [
  {
    id: ID_DE_QUIEN_MIRA,
    tipo: 'persona',
    nombre: 'Lucía Ferrán',
    equipo: 'Gerencia',
    estado: 'en-la-sala',
  },
  {
    id: 'persona-tomas',
    tipo: 'persona',
    nombre: 'Tomás Rivel',
    equipo: 'Administración',
    estado: 'inactivo',
    hace: 15 * MINUTO,
  },
  {
    id: 'persona-olmo',
    tipo: 'persona',
    nombre: 'Asesoría Olmo',
    equipo: 'Asesoría externa',
    estado: 'anadido',
    hace: 26 * HORA,
  },
  {
    id: 'persona-irene',
    tipo: 'persona',
    nombre: 'Irene Salcedo',
    equipo: 'Ventas',
    estado: 'anadido',
    hace: 2 * HORA,
  },
];

const AGENTES: MiembroBase[] = [
  {
    id: 'agente-cobros',
    tipo: 'agente',
    nombre: 'Cobros',
    puesto: 'Cobros',
    equipo: 'Finanzas',
    estado: 'te-necesita',
    hace: 6 * MINUTO,
  },
  {
    id: 'agente-conciliacion',
    tipo: 'agente',
    nombre: 'Conciliación',
    puesto: 'Conciliación bancaria',
    equipo: 'Finanzas',
    estado: 'trabajando',
    hace: 12 * MINUTO,
  },
  {
    id: 'agente-moderador',
    tipo: 'agente',
    nombre: 'Moderador',
    puesto: 'Moderador de la sala',
    estado: 'en-la-sala',
  },
  {
    id: 'agente-director',
    tipo: 'agente',
    nombre: 'Director de IA',
    puesto: 'Director de IA',
    estado: 'escribiendo',
  },
  {
    id: 'agente-prevision',
    tipo: 'agente',
    nombre: 'Previsión',
    puesto: 'Previsión de tesorería',
    equipo: 'Finanzas',
    estado: 'en-pausa',
    hace: 3 * HORA,
  },
];

/** Qué miembros tiene cada sala. La general los tiene a todos. */
const MIEMBROS_POR_SALA: Record<string, string[]> = {
  general: [...PERSONAS, ...AGENTES].map((m) => m.id),
  finanzas: [...PERSONAS, ...AGENTES].map((m) => m.id),
  'ventas-y-atencion': [ID_DE_QUIEN_MIRA, 'persona-irene', 'agente-moderador', 'agente-director'],
  marketing: [ID_DE_QUIEN_MIRA, 'agente-moderador'],
};

export interface OpcionesDeSimulacion {
  /** Reloj inyectable para las pruebas. */
  ahora?: () => number;
  /** Simula escritura en vivo al suscribirse. Por defecto, sí. */
  escrituraEnVivo?: boolean;
  /** La simulación puede fallar a propósito para probar el estado de error. */
  fallar?: boolean;
}

export interface FuenteSimulada extends FuenteDeSala {
  /** Salas en las que la persona indicó que escribía: para las pruebas. */
  readonly escriturasIndicadas: readonly string[];
  /** Emite un cambio de presencia, como haría Centrifugo. */
  cambiarPresencia(salaId: string, miembroId: string, estado: EstadoDePresencia): void;
}

function aMiembro(base: MiembroBase, ahora: number): MiembroDeSala {
  return {
    id: base.id,
    tipo: base.tipo,
    nombre: base.nombre,
    estado: base.estado,
    ...(base.puesto ? { puesto: base.puesto } : {}),
    ...(base.equipo ? { equipo: base.equipo } : {}),
    ...(base.hace !== undefined ? { desde: new Date(ahora - base.hace).toISOString() } : {}),
  };
}

export function crearFuenteSimulada(opciones: OpcionesDeSimulacion = {}): FuenteSimulada {
  const ahora = opciones.ahora ?? (() => Date.now());
  const escrituraEnVivo = opciones.escrituraEnVivo ?? true;
  const todos = new Map([...PERSONAS, ...AGENTES].map((m) => [m.id, { ...m }]));
  const oyentes = new Map<string, Set<(cambio: CambioDeSala) => void>>();
  const escrituras: string[] = [];

  const emitir = (salaId: string, cambio: CambioDeSala) => {
    for (const oyente of oyentes.get(salaId) ?? []) oyente(cambio);
  };

  const comprobar = async () => {
    if (opciones.fallar) throw new Error('La sala simulada no responde.');
  };

  return {
    get escriturasIndicadas() {
      return escrituras;
    },

    async salas() {
      await comprobar();
      return SALAS.map((sala) => ({ ...sala }));
    },

    async miembros(salaId) {
      await comprobar();
      const ids = MIEMBROS_POR_SALA[salaId] ?? [];
      const instante = ahora();
      return ids.flatMap((id) => {
        const base = todos.get(id);
        return base ? [aMiembro(base, instante)] : [];
      });
    },

    suscribir(salaId, alCambiar) {
      const conjunto = oyentes.get(salaId) ?? new Set();
      conjunto.add(alCambiar);
      oyentes.set(salaId, conjunto);

      const escritores = (MIEMBROS_POR_SALA[salaId] ?? []).filter(
        (id) => todos.get(id)?.estado === 'escribiendo',
      );
      const avisarEscritura = () => {
        const hasta = new Date(ahora() + DURACION_ESCRITURA_MS).toISOString();
        for (const miembroId of escritores) {
          alCambiar({ tipo: 'escribiendo', salaId, miembroId, hasta });
        }
      };
      let temporizador: ReturnType<typeof setInterval> | undefined;
      let primero: ReturnType<typeof setTimeout> | undefined;
      if (escrituraEnVivo && escritores.length > 0) {
        primero = setTimeout(avisarEscritura, 0);
        temporizador = setInterval(avisarEscritura, RENOVAR_ESCRITURA_MS);
      }

      return () => {
        conjunto.delete(alCambiar);
        if (primero) clearTimeout(primero);
        if (temporizador) clearInterval(temporizador);
      };
    },

    indicarEscritura(salaId) {
      escrituras.push(salaId);
    },

    cambiarPresencia(salaId, miembroId, estado) {
      const base = todos.get(miembroId);
      if (!base) return;
      base.estado = estado;
      base.hace = 0;
      emitir(salaId, { tipo: 'presencia', salaId, miembro: aMiembro(base, ahora()) });
    },
  };
}

/* ─────────────── Conversación de ejemplo (fuera del contrato) ─────────────── */

export interface AutorDeEjemplo {
  id: string;
  nombre: string;
  tipo: MiembroDeSala['tipo'];
}

export type MensajeDeEjemplo =
  | { tipo: 'texto'; id: string; autor: AutorDeEjemplo; hora: string; texto: string }
  | { tipo: 'nota'; id: string; hora: string; texto: string }
  | {
      tipo: 'aprobacion';
      id: string;
      autor: AutorDeEjemplo;
      hora: string;
      texto: string;
      titulo: string;
      /** Clase de acción, nivel, cuántas tareas y coste: nada importante sin verse. */
      resumen: string;
      porque: string;
      resuelta: string;
    }
  | {
      tipo: 'propuesta';
      id: string;
      autor: AutorDeEjemplo;
      hora: string;
      texto: string;
      titulo: string;
      datos: { etiqueta: string; valor: string }[];
      resuelta: string;
    };

const LUCIA: AutorDeEjemplo = { id: ID_DE_QUIEN_MIRA, nombre: 'Lucía Ferrán', tipo: 'persona' };
const TOMAS: AutorDeEjemplo = { id: 'persona-tomas', nombre: 'Tomás Rivel', tipo: 'persona' };
const COBROS: AutorDeEjemplo = { id: 'agente-cobros', nombre: 'Cobros', tipo: 'agente' };
const DIRECTOR: AutorDeEjemplo = {
  id: 'agente-director',
  nombre: 'Director de IA',
  tipo: 'agente',
};

const CONVERSACION_DE_FINANZAS: MensajeDeEjemplo[] = [
  {
    tipo: 'texto',
    id: 'm1',
    autor: LUCIA,
    hora: '09:02',
    texto: '¿Cómo vamos de cobros este mes?',
  },
  { tipo: 'nota', id: 'm2', hora: '09:02', texto: 'El moderador le pasa la palabra a Cobros.' },
  {
    tipo: 'aprobacion',
    id: 'm3',
    autor: COBROS,
    hora: '09:03',
    texto:
      'Tenemos 14 facturas vencidas por 23.480 €. Nueve son de menos de 30 días: si te parece, hoy les mando el recordatorio.',
    titulo: 'Recordatorio a 9 clientes',
    resumen: 'Comunicar con terceros · N1 · 9 tareas · unos 0,40 € · salen hoy en horario laboral',
    porque:
      'Son facturas de menos de 30 días y es el primer recordatorio: la política de cobros pide avisar con tono amable antes de escalar.',
    resuelta: 'Aprobado por ti. Salen hoy en horario laboral.',
  },
  {
    tipo: 'texto',
    id: 'm4',
    autor: TOMAS,
    hora: '09:10',
    texto: 'Ojo con Talleres Brisa: prometió pagar el viernes.',
  },
  {
    tipo: 'texto',
    id: 'm5',
    autor: COBROS,
    hora: '09:11',
    texto: 'Anotado. A Talleres Brisa no le escribo hasta el lunes.',
  },
  {
    tipo: 'texto',
    id: 'm6',
    autor: LUCIA,
    hora: '09:30',
    texto: '@Director de IA quiero a alguien que lleve la previsión de tesorería.',
  },
  {
    tipo: 'propuesta',
    id: 'm7',
    autor: DIRECTOR,
    hora: '09:31',
    texto: 'Te propongo este puesto. No hace nada hasta que lo confirmes.',
    titulo: 'Contratar Previsión de tesorería',
    datos: [
      { etiqueta: 'Equipo y nivel', valor: 'Finanzas · N1, te pide permiso' },
      { etiqueta: 'Coste', valor: 'Unos 50 € al mes, dentro del plan' },
      { etiqueta: 'Herramientas', valor: 'ERP y banco, solo lectura' },
      { etiqueta: 'Se deshace', valor: 'Despidiéndolo desde Equipo' },
    ],
    resuelta: 'Contratada. Ya está en la sala y se presenta en un momento.',
  },
];

const CONVERSACION_GENERAL: MensajeDeEjemplo[] = [
  {
    tipo: 'texto',
    id: 'g1',
    autor: LUCIA,
    hora: '08:45',
    texto: 'Buenos días. Hoy cerramos el mes: avisad si algo se atasca.',
  },
  {
    tipo: 'texto',
    id: 'g2',
    autor: DIRECTOR,
    hora: '08:46',
    texto: 'Entendido. Os aviso aquí de cualquier aprobación pendiente.',
  },
];

/** Conversación de ejemplo de una sala. Vacía en las salas sin mensajes. */
export function conversacionSimulada(salaId: string): MensajeDeEjemplo[] {
  if (salaId === 'finanzas') return CONVERSACION_DE_FINANZAS;
  if (salaId === 'general') return CONVERSACION_GENERAL;
  return [];
}

/** La sala que se abre sin elegir ninguna: la que tiene la conversación de ejemplo. */
export const SALA_INICIAL_SIMULADA = 'finanzas';
