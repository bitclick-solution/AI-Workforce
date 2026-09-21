/**
 * Caché del prompt de la versión de puesto.
 *
 * Dos cachés distintas con el mismo nombre, y conviene no confundirlas:
 *
 * - La del proveedor, que se pide con `providerOptions` en el paso de modelo y
 *   ahorra dinero porque el proveedor no vuelve a procesar el bloque de sistema.
 * - Esta, que ahorra trabajo en el proceso: el prompt de una versión de puesto es
 *   inmutable, así que componerlo —prompt, brand voice, memoria congelada— se hace
 *   una vez por versión y no una vez por paso.
 *
 * La clave es el identificador de la versión de puesto, y eso basta porque
 * `version_puesto` es una fila inmutable: si el prompt cambia, hay otra versión y
 * otra clave. No hay invalidación que programar ni fecha de caducidad que acertar.
 */

export interface PromptCompuesto {
  versionPuestoId: string;
  sistema: string;
}

export interface CacheDePrompts {
  /** Devuelve el prompt compuesto, componiéndolo la primera vez. */
  obtener(versionPuestoId: string, componer: () => string): string;
  readonly aciertos: number;
  readonly fallos: number;
  vaciar(): void;
}

export interface OpcionesCache {
  /** Cuántas versiones se guardan. Al llenarse, sale la más antigua. */
  maximo?: number | undefined;
}

/**
 * Caché con expulsión de la entrada más antigua.
 *
 * El límite existe porque un trabajador de un tenant grande puede ver cientos de
 * versiones de puesto en un día, y un mapa que solo crece es una fuga de memoria
 * con buena intención.
 */
export function crearCacheDePrompts(opciones: OpcionesCache = {}): CacheDePrompts {
  const maximo = opciones.maximo ?? 64;
  const guardados = new Map<string, string>();
  let aciertos = 0;
  let fallos = 0;

  return {
    obtener(versionPuestoId, componer) {
      const ya = guardados.get(versionPuestoId);
      if (ya !== undefined) {
        aciertos += 1;
        // Renovar la posición: la entrada usada pasa a ser la más reciente.
        guardados.delete(versionPuestoId);
        guardados.set(versionPuestoId, ya);
        return ya;
      }
      fallos += 1;
      const compuesto = componer();
      guardados.set(versionPuestoId, compuesto);
      if (guardados.size > maximo) {
        const masAntigua = guardados.keys().next();
        if (!masAntigua.done) guardados.delete(masAntigua.value);
      }
      return compuesto;
    },
    get aciertos() {
      return aciertos;
    },
    get fallos() {
      return fallos;
    },
    vaciar() {
      guardados.clear();
      aciertos = 0;
      fallos = 0;
    },
  };
}

export interface PiezasDelPrompt {
  /** Prompt de la versión de puesto, tal como está en `version_puesto.prompt`. */
  prompt: string;
  /** Tono y prohibiciones de la organización o del departamento. */
  brandVoice?: { tono?: string | undefined; tratamiento?: 'tu' | 'usted' | undefined; prohibiciones?: readonly string[] | undefined } | undefined;
  /** Memoria congelada de la versión, ya resumida. No entra nada personal. */
  memoria?: readonly string[] | undefined;
}

/**
 * Compone el prompt de sistema. Orden fijo: quién eres, cómo hablas, qué recuerdas.
 *
 * El orden es fijo a propósito. Con la caché del proveedor, dos prompts que solo se
 * diferencian en el orden de sus bloques no comparten nada, y la caché deja de
 * servir para lo único que sirve.
 */
export function componerPrompt(piezas: PiezasDelPrompt): string {
  const bloques = [piezas.prompt.trim()];

  const voz = piezas.brandVoice;
  if (voz) {
    const reglas: string[] = [];
    if (voz.tono) reglas.push(`Tono: ${voz.tono}.`);
    if (voz.tratamiento) {
      reglas.push(voz.tratamiento === 'tu' ? 'Trata de tú.' : 'Trata de usted.');
    }
    if (voz.prohibiciones && voz.prohibiciones.length > 0) {
      reglas.push(`No hagas esto nunca: ${voz.prohibiciones.join('; ')}.`);
    }
    if (reglas.length > 0) bloques.push(`Cómo hablas:\n${reglas.join('\n')}`);
  }

  if (piezas.memoria && piezas.memoria.length > 0) {
    bloques.push(`Lo que ya sabes:\n${piezas.memoria.map((linea) => `- ${linea}`).join('\n')}`);
  }

  return bloques.join('\n\n');
}
