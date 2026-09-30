/**
 * @aiw/learning
 *
 * Señales, lecciones candidatas, evaluación en sombra, promoción por nivel y versiones de puesto.
 * Zona crítica: promociones del aprendizaje.
 *
 * Aprendizaje v0 (docs/specs/aprendizaje-v0.md): una edición del borrador antes de
 * aprobar se convierte en señal, la señal en una lección de memoria, y una persona
 * la promociona a una versión inmutable del puesto que se puede revertir. El
 * aprendizaje nunca cambia el modelo base ni entrena con datos personales (ADR-005).
 */
export const PAQUETE = {
  nombre: '@aiw/learning',
  tipo: 'paquete',
  responsabilidad:
    'Señales, lecciones candidatas, evaluación en sombra, promoción por nivel y versiones de puesto.',
} as const;

export type Paquete = typeof PAQUETE;

export * from './diferencia.js';
export * from './datos-personales.js';
export * from './leccion.js';
export * from './operaciones.js';

// Habilidades en el bucle del agente
export * from './habilidades.js';
