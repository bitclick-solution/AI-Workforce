/**
 * Detector mínimo de datos personales para lo que aprende un agente.
 *
 * La regla del ADR-005 es que el aprendizaje nunca entrena con datos personales. La
 * lección se escribe en la memoria del puesto y de ahí pasa al prompt de todas sus
 * tareas siguientes: si se colara el correo o el IBAN de un cliente, lo vería cada
 * tarea de cualquier otro cliente. Por eso se sanea antes de escribir, no después.
 *
 * Es deliberadamente conservador y pequeño: sustituye lo que tiene forma de correo,
 * teléfono, IBAN, DNI/NIE/CIF o tarjeta. El servicio `services/pii` lo sustituirá con
 * detección por entidades; esta regla no espera a él.
 */

export const MARCA_DATO_PERSONAL = '[dato personal]';

export type ClaseDatoPersonal = 'correo' | 'iban' | 'tarjeta' | 'documento' | 'telefono';

/** El orden importa: el IBAN y la tarjeta contienen secuencias que parecen teléfonos. */
const PATRONES: readonly { clase: ClaseDatoPersonal; patron: RegExp }[] = [
  { clase: 'correo', patron: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu },
  { clase: 'iban', patron: /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]{4}){3,7}(?:[ -]?[A-Z0-9]{1,4})?\b/gi },
  { clase: 'tarjeta', patron: /\b(?:\d{4}[ -]?){3}\d{4}\b/g },
  // DNI (8 cifras y letra), NIE (X/Y/Z, 7 cifras y letra) y CIF (letra, 7 cifras y control).
  {
    clase: 'documento',
    patron: /\b(?:\d{8}[A-Z]|[XYZ]\d{7}[A-Z]|[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J])\b/gi,
  },
  // Teléfonos españoles con o sin prefijo: 9 cifras que empiezan por 6, 7, 8 o 9.
  { clase: 'telefono', patron: /(?:\+34[ -]?)?\b[6789]\d{2}[ -]?\d{3}[ -]?\d{3}\b/g },
];

export interface TextoSaneado {
  texto: string;
  /** Clases encontradas, sin el valor: saber que había un IBAN no es un dato personal. */
  hallados: ClaseDatoPersonal[];
}

export function sanearTexto(texto: string): TextoSaneado {
  const hallados = new Set<ClaseDatoPersonal>();
  let resultado = texto;
  for (const { clase, patron } of PATRONES) {
    resultado = resultado.replace(patron, () => {
      hallados.add(clase);
      return MARCA_DATO_PERSONAL;
    });
  }
  return { texto: resultado, hallados: [...hallados] };
}

/** Sanea cada cadena de un valor JSON y devuelve la copia saneada. */
export function sanearValor(valor: unknown): { valor: unknown; hallados: ClaseDatoPersonal[] } {
  const hallados = new Set<ClaseDatoPersonal>();
  const recorrer = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const saneado = sanearTexto(v);
      saneado.hallados.forEach((clase) => hallados.add(clase));
      return saneado.texto;
    }
    if (Array.isArray(v)) return v.map(recorrer);
    if (typeof v === 'object' && v !== null) {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, recorrer(x)]));
    }
    return v;
  };
  return { valor: recorrer(valor), hallados: [...hallados] };
}

/** Verdadero si el texto conserva algo con forma de dato personal. */
export function contieneDatosPersonales(texto: string): boolean {
  return sanearTexto(texto).hallados.length > 0;
}
