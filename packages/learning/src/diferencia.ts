/**
 * Diferencia entre el borrador que propuso el agente y el que aprobó la persona.
 *
 * El borrador es una carga opaca para el plano de control (ADR-001): esta función
 * no sabe qué significa ningún campo, solo compara dos valores JSON y devuelve las
 * rutas donde difieren. Así la señal sirve igual para una nota de cobro que para un
 * asiento contable, y nadie tiene que enseñar al aprendizaje la forma de cada
 * herramienta.
 */

/** Un cambio en una ruta del borrador. `antes` o `despues` faltan si la clave no existía. */
export interface Cambio {
  /** Ruta con puntos e índices: `argumentos.texto`, `lineas[2].importe`. */
  ruta: string;
  antes?: unknown;
  despues?: unknown;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function unir(base: string, clave: string): string {
  return base === '' ? clave : `${base}.${clave}`;
}

/**
 * Compara dos valores y devuelve los cambios hoja a hoja, en orden estable.
 *
 * Los objetos se recorren por clave ordenada, así que dos ejecuciones sobre el
 * mismo par producen la misma lista: la lección que sale de ella es reproducible, y
 * eso es lo que permite que un reintento del flujo no proponga dos lecciones
 * distintas para la misma edición.
 */
export function diferenciaDeBorradores(antes: unknown, despues: unknown, ruta = ''): Cambio[] {
  if (esObjeto(antes) && esObjeto(despues)) {
    const claves = [...new Set([...Object.keys(antes), ...Object.keys(despues)])].sort();
    return claves.flatMap((clave) => {
      const siguiente = unir(ruta, clave);
      if (!(clave in despues)) return [{ ruta: siguiente, antes: antes[clave] }];
      if (!(clave in antes)) return [{ ruta: siguiente, despues: despues[clave] }];
      return diferenciaDeBorradores(antes[clave], despues[clave], siguiente);
    });
  }
  if (Array.isArray(antes) && Array.isArray(despues)) {
    const largo = Math.max(antes.length, despues.length);
    const cambios: Cambio[] = [];
    for (let i = 0; i < largo; i += 1) {
      const siguiente = `${ruta}[${i}]`;
      if (i >= despues.length) cambios.push({ ruta: siguiente, antes: antes[i] });
      else if (i >= antes.length) cambios.push({ ruta: siguiente, despues: despues[i] });
      else cambios.push(...diferenciaDeBorradores(antes[i], despues[i], siguiente));
    }
    return cambios;
  }
  if (Object.is(antes, despues)) return [];
  return [{ ruta: ruta === '' ? '(raíz)' : ruta, antes, despues }];
}
