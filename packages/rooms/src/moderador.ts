/**
 * Moderador de sala v0: decide quién habla después de cada mensaje humano.
 *
 * Es una función pura sobre datos: el mensaje y la ficha de cada puesto de la sala.
 * No llama a ningún modelo ni tiene prompt de sistema; la especificación de la
 * rebanada explica por qué (docs/specs/sala-v0.md, decisión 2). Lo que decide y
 * cómo lo limita es lo que fija el ADR-004:
 *
 * - Una mención obliga a responder al mencionado.
 * - Nunca más de dos intervenciones por mensaje, tampoco con menciones ni con
 *   «@todos»: los que se quedan fuera los nombra el motivo. «Salvo que la persona
 *   pida más» (plan v8) llega con los hilos; en v0 el tope es fijo.
 * - Sin mención, habla el puesto cuya ficha declara el tema del mensaje, con una
 *   intervención por defecto y dos como máximo.
 * - Una petición de operación de organización («contrata…») no es para ningún
 *   puesto: va al Director de IA.
 * - Si nadie tiene el tema, el moderador calla y lo dice. El silencio es una
 *   respuesta válida; un agente que habla de lo que no sabe, no.
 */

/** Intervenciones por mensaje humano: una por defecto, dos como máximo (ADR-004). */
export const LIMITE_POR_DEFECTO = 1;
export const LIMITE_MAXIMO = 2;

/** Estados de puesto que pueden hablar en la sala (ADR-006). */
export const ESTADOS_QUE_INTERVIENEN = ['activo', 'en_prueba'] as const;

/**
 * Formas de pedir una contratación. Son raíces normalizadas (sin tildes, en
 * minúsculas) que se buscan al principio de una palabra o de una expresión.
 */
export const EXPRESIONES_DE_CONTRATAR = [
  'contrata',
  'contratar',
  'contratame',
  'contratemos',
  'da de alta un agente',
  'dar de alta un agente',
  'necesito alguien que',
  'necesito un agente',
  'quiero un agente',
] as const;

/** Menciones que llaman a todos los agentes de la sala. */
export const MENCIONES_A_TODOS = ['@todos', '@equipo', 'todo el equipo'] as const;

export interface ParticipanteDeSala {
  puestoId: string;
  nombre: string;
  estado: string;
  /** Raíces de los temas de su ficha, p. ej. `cobro`, `factura vencida`. */
  temas: readonly string[];
}

export interface Turno {
  puestoId: string;
  nombre: string;
  motivo: string;
  porMencion: boolean;
  /** Temas de la ficha que aparecen en el mensaje. Cero si habla por mención. */
  coincidencias: number;
}

export type DecisionDelModerador =
  | { tipo: 'intervenir'; turnos: Turno[]; motivo: string }
  | { tipo: 'operacion'; operacion: 'contratar'; motivo: string }
  | { tipo: 'silencio'; motivo: string };

export interface OpcionesModerador {
  /** Límite de intervenciones sin mención. Se acota entre 1 y `LIMITE_MAXIMO`. */
  limite?: number | undefined;
}

/** Minúsculas, sin tildes y con la puntuación como espacio. La `@` se conserva. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}@]+/gu, ' ')
    .trim();
}

function palabras(texto: string): string[] {
  return normalizar(texto).split(' ').filter(Boolean);
}

/**
 * Una expresión aparece si sus palabras van seguidas en el texto y cada una empieza
 * como la de la expresión: `cobro` encaja con «cobros», `factura vencida` con
 * «facturas vencidas». Es la única «lingüística» del moderador v0, a propósito.
 */
export function aparece(expresion: string, texto: string): boolean {
  const buscadas = palabras(expresion);
  const dichas = palabras(texto);
  if (buscadas.length === 0) return false;
  for (let inicio = 0; inicio + buscadas.length <= dichas.length; inicio += 1) {
    if (buscadas.every((buscada, i) => dichas[inicio + i]?.startsWith(buscada) === true)) {
      return true;
    }
  }
  return false;
}

/** Mención a un puesto: `@` seguida del nombre sin espacios o de su primera palabra. */
function mencionado(participante: ParticipanteDeSala, texto: string): boolean {
  const nombre = palabras(participante.nombre);
  const junto = nombre.join('');
  const primera = nombre[0];
  return palabras(texto).some(
    (palabra) =>
      palabra.startsWith('@') &&
      (palabra.slice(1) === junto || (primera !== undefined && palabra.slice(1) === primera)),
  );
}

function acotar(limite: number | undefined): number {
  const valor = Math.trunc(limite ?? LIMITE_POR_DEFECTO);
  if (!Number.isFinite(valor) || valor < 1) return LIMITE_POR_DEFECTO;
  return Math.min(valor, LIMITE_MAXIMO);
}

export function pideContratar(texto: string): boolean {
  return EXPRESIONES_DE_CONTRATAR.some((expresion) => aparece(expresion, texto));
}

export function moderar(
  texto: string,
  participantes: readonly ParticipanteDeSala[],
  opciones: OpcionesModerador = {},
): DecisionDelModerador {
  if (pideContratar(texto)) {
    return {
      tipo: 'operacion',
      operacion: 'contratar',
      motivo:
        'El mensaje pide contratar un agente: es una operación de organización y la atiende el Director de IA.',
    };
  }

  const disponibles = participantes.filter((p) =>
    (ESTADOS_QUE_INTERVIENEN as readonly string[]).includes(p.estado),
  );

  // Llamar a todos o mencionar a varios obliga a responder, pero sin pasar del
  // tope: una mención de más no puede convertir la sala en ruido ni en coste.
  const aTodos = MENCIONES_A_TODOS.some((mencion) => aparece(mencion, texto));
  const mencionados = aTodos ? disponibles : disponibles.filter((p) => mencionado(p, texto));
  if (aTodos && disponibles.length === 0) {
    return {
      tipo: 'silencio',
      motivo: 'Se llamó a todo el equipo, pero no hay agentes en la sala.',
    };
  }
  if (mencionados.length > 0) {
    const hablan = mencionados.slice(0, LIMITE_MAXIMO);
    const esperan = mencionados.slice(LIMITE_MAXIMO).map((p) => p.nombre);
    return {
      tipo: 'intervenir',
      turnos: hablan.map((p) => ({
        puestoId: p.puestoId,
        nombre: p.nombre,
        motivo: aTodos
          ? 'La persona ha llamado a todo el equipo.'
          : `La persona ha mencionado a ${p.nombre}: una mención obliga a responder.`,
        porMencion: true,
        coincidencias: 0,
      })),
      motivo:
        (aTodos ? 'Mención a todo el equipo' : 'Responden los agentes mencionados') +
        (esperan.length > 0
          ? `: hablan ${hablan.map((p) => p.nombre).join(' y ')}; ${esperan.join(', ')} ` +
            `no, por el límite de ${LIMITE_MAXIMO} por mensaje.`
          : '.'),
    };
  }

  const puntuados = disponibles
    .map((p) => {
      const temas = p.temas.filter((tema) => aparece(tema, texto));
      return { participante: p, temas };
    })
    .filter((candidato) => candidato.temas.length > 0)
    .sort(
      (a, b) =>
        b.temas.length - a.temas.length ||
        // A igualdad de temas, antes el activo que el que está en prueba.
        Number(b.participante.estado === 'activo') - Number(a.participante.estado === 'activo') ||
        a.participante.nombre.localeCompare(b.participante.nombre, 'es'),
    );

  if (puntuados.length === 0) {
    return {
      tipo: 'silencio',
      motivo:
        'Ningún agente de la sala tiene este tema en su ficha: el moderador no da la palabra.',
    };
  }

  const elegidos = puntuados.slice(0, acotar(opciones.limite));
  return {
    tipo: 'intervenir',
    turnos: elegidos.map(({ participante, temas }) => ({
      puestoId: participante.puestoId,
      nombre: participante.nombre,
      motivo: `Su ficha cubre ${temas.map((t) => `«${t}»`).join(', ')}.`,
      porMencion: false,
      coincidencias: temas.length,
    })),
    motivo:
      `Da la palabra a ${elegidos.map((e) => e.participante.nombre).join(' y ')} ` +
      `(${puntuados.length} con el tema, límite ${acotar(opciones.limite)}).`,
  };
}
