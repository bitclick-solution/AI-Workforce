/**
 * Guardias de entrada y de salida del bucle.
 *
 * La especificación de esta rebanada es explícita: interfaces con implementación
 * nula salvo una regla, «ningún secreto en la salida». La detección de datos
 * personales vive en `services/pii` y llega en otra rebanada, así que aquí hay un
 * hueco con forma, no un hueco vacío: el bucle ya llama a los ganchos, y añadir un
 * guardia de verdad será registrar una implementación más.
 *
 * El guardia de secretos no recibe el valor de ningún secreto. No podría: el
 * gateway los guarda en objetos que no saben imprimirse y solo los revela al
 * construir el transporte. Lo que hace es reconocer la **forma** de una credencial
 * —un `sk-`, un `Bearer`, una cadena de conexión con contraseña, un bloque de clave
 * privada— en lo que sale hacia el modelo o hacia un sistema externo. Reconocer la
 * forma es lo único que se puede hacer sin tener el valor, y es lo que atrapa el
 * caso real: un modelo que repite en su respuesta algo que vio en un resultado.
 */

export interface Hallazgo {
  guardia: string;
  motivo: string;
}

export interface ResultadoGuardia {
  /** Cierto cuando el texto pasa sin cambios. */
  pasa: boolean;
  /** Texto saneado. Igual al original cuando pasa. */
  texto: string;
  hallazgos: Hallazgo[];
}

export interface Guardia {
  nombre: string;
  revisar(texto: string): ResultadoGuardia;
}

/** Lo que se escribe donde había algo que parecía una credencial. */
export const REDACTADO = '«redactado por el guardia de salida»';

/** Formas de credencial que se reconocen sin conocer ningún valor. */
const PATRONES: readonly { motivo: string; patron: RegExp }[] = [
  {
    motivo: 'cadena de conexión con contraseña',
    patron: /(postgres(?:ql)?|mysql|mongodb|redis|amqp):\/\/[^\s'"`]*:[^\s'"`@]+@/gi,
  },
  { motivo: 'cabecera de autorización', patron: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi },
  { motivo: 'clave de proveedor de modelos', patron: /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/gi },
  { motivo: 'clave privada en PEM', patron: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  {
    motivo: 'token con prefijo conocido',
    patron: /\b(?:ghp|gho|github_pat|xox[abprs])[-_][A-Za-z0-9_]{16,}/gi,
  },
];

/**
 * Guardia que no hace nada. Es la implementación nula de la interfaz.
 *
 * Existe para que el bucle tenga siempre a quién llamar y para que un puesto sin
 * guardias configuradas siga pasando por el gancho. Un `if` alrededor del gancho se
 * olvida de poner; un guardia nulo registrado no.
 */
export const guardiaNulo: Guardia = {
  nombre: 'nulo',
  revisar: (texto) => ({ pasa: true, texto, hallazgos: [] }),
};

/**
 * Guardia de salida que tapa lo que tiene forma de credencial.
 *
 * Acepta además una lista de valores exactos. La usan la demostración y las
 * pruebas, que sí conocen el secreto del conector de demostración y quieren
 * comprobar que, si alguna vez apareciera, este guardia lo taparía. En producción
 * la lista va vacía: nadie le pasa secretos a un guardia.
 */
export function guardiaSinSecretos(valoresExactos: readonly string[] = []): Guardia {
  const valores = valoresExactos.filter((valor) => valor.length >= 8);

  return {
    nombre: 'sin_secretos',
    revisar(texto) {
      const hallazgos: Hallazgo[] = [];
      let saneado = texto;

      for (const valor of valores) {
        if (saneado.includes(valor)) {
          hallazgos.push({ guardia: 'sin_secretos', motivo: 'valor de secreto conocido' });
          saneado = saneado.split(valor).join(REDACTADO);
        }
      }
      for (const { motivo, patron } of PATRONES) {
        // Los patrones llevan la bandera global: se rehace el regex en cada uso
        // para no arrastrar `lastIndex` entre llamadas.
        const busqueda = new RegExp(patron.source, patron.flags);
        if (busqueda.test(saneado)) {
          hallazgos.push({ guardia: 'sin_secretos', motivo });
          saneado = saneado.replace(new RegExp(patron.source, patron.flags), REDACTADO);
        }
      }

      return { pasa: hallazgos.length === 0, texto: saneado, hallazgos };
    },
  };
}

export interface OpcionesDeGuardias {
  /** Valores exactos que el guardia de secretos debe tapar. Vacío en producción. */
  valoresSecretos?: readonly string[] | undefined;
}

/**
 * Construye los guardias que nombra la política del puesto.
 *
 * Un nombre que no se conoce no se ignora en silencio: se sustituye por el guardia
 * nulo y se deja constancia en su nombre, así que el libro registra que la política
 * pedía algo que este proceso no sabe aplicar.
 */
export function crearGuardias(
  nombres: readonly string[],
  opciones: OpcionesDeGuardias = {},
): Guardia[] {
  return nombres.map((nombre) => {
    if (nombre === 'sin_secretos') return guardiaSinSecretos(opciones.valoresSecretos ?? []);
    return { ...guardiaNulo, nombre: `nulo:${nombre}` };
  });
}

/** Pasa el texto por todos los guardias en orden y acumula lo que encuentren. */
export function revisarTodo(guardias: readonly Guardia[], texto: string): ResultadoGuardia {
  let actual = texto;
  const hallazgos: Hallazgo[] = [];
  for (const guardia of guardias) {
    const resultado = guardia.revisar(actual);
    actual = resultado.texto;
    hallazgos.push(...resultado.hallazgos);
  }
  return { pasa: hallazgos.length === 0, texto: actual, hallazgos };
}
