/**
 * Reconocedor de frases del prototipo.
 *
 * No es el Director de IA: es una lista fija de ejemplos. La clasificación real
 * vive en `apps/platform-agents` y llega en su rebanada. Aquí solo hace falta
 * que las tres respuestas posibles —propuesta, no la entiendo y necesita a una
 * persona— sean alcanzables desde la pantalla para poder probarlas con gerentes.
 */

export type Veredicto = 'propuesta' | 'no-reconocida' | 'necesita-persona';

export interface Respuesta {
  veredicto: Veredicto;
  /** Por qué el Director responde eso. Se enseña en pantalla. */
  motivo: string;
}

function normalizar(frase: string): string {
  // Rango de marcas diacríticas combinantes. Escrito con escapes a propósito:
  // con los caracteres literales, cualquier reformateo o recodificación del
  // fichero puede romperlos sin que se vea en el diff.
  // prettier-ignore
  return frase.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

/** Ejemplos que el prototipo reconoce como una contratación posible. */
const CONTRATACION = ['conciliacion', 'conciliar', 'concilie'];

/**
 * Ejemplos que piden una clase de acción crítica. El Director no los rechaza en
 * silencio: dice por qué y qué sí puede hacer.
 */
const CRITICO = ['pague', 'pagar', 'pagos', 'transferencia', 'remesa', 'borrar', 'anular'];

export function interpretarFrase(frase: string): Respuesta {
  const texto = normalizar(frase);

  if (texto === '') {
    return { veredicto: 'no-reconocida', motivo: 'No has escrito nada todavía.' };
  }

  if (CRITICO.some((palabra) => texto.includes(palabra))) {
    return {
      veredicto: 'necesita-persona',
      motivo:
        'Mover dinero, anular o borrar son acciones de riesgo crítico: ningún agente las ejecuta. Puedo preparar la propuesta y la ejecutas tú con tus credenciales.',
    };
  }

  if (CONTRATACION.some((palabra) => texto.includes(palabra))) {
    return {
      veredicto: 'propuesta',
      motivo: 'Es el puesto de Conciliación bancaria del departamento de finanzas.',
    };
  }

  return {
    veredicto: 'no-reconocida',
    motivo:
      'No tengo ningún puesto que encaje con eso. En esta versión existen Finanzas, Ventas y atención, y Administración.',
  };
}

/** Frases de ejemplo que la pantalla ofrece para probar cada camino. */
export const FRASES_DE_EJEMPLO = [
  'Contrata un agente de conciliación en Finanzas',
  'Contrata un agente de marketing para las redes',
  'Contrata un agente que pague las facturas de proveedor',
] as const;
