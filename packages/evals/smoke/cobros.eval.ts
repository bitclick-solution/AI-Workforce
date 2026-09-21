import { describe, expect, it } from 'vitest';

import {
  AL_DIA,
  CASO_COBROS,
  PROHIBIDAS,
  VENCIDAS,
  ejecutarCasoCobros,
  evaluarNotas,
} from '../src/puestos/cobros.js';

/**
 * Primer caso dorado por puesto. Determinista y sin coste: el agente que se evalúa
 * es el guion del proveedor de prueba, el mismo que corre el bucle en la CI.
 *
 * Además de comprobar que el caso pasa, se comprueba que el evaluador **sabe
 * fallar**. Un evaluador que siempre dice sí no evalúa nada, y es el error más fácil
 * de cometer y el más difícil de ver: por eso cada regla tiene aquí su
 * contraejemplo.
 */
describe('evals de humo · puesto Cobros', () => {
  it('el agente propone una nota correcta por cada factura vencida', () => {
    const resultado = ejecutarCasoCobros();
    expect(resultado.diagnostico).toContain(CASO_COBROS);
    expect(resultado.superado).toBe(true);
    expect(resultado.puntuacion).toBe(1);
  });

  it('falla si se deja una factura vencida sin nota', () => {
    const resultado = evaluarNotas(
      VENCIDAS.slice(0, 2).map((factura) => ({
        factura_id: factura.id,
        numero: factura.numero,
        texto: `Hola. La factura ${factura.numero} de ${factura.importe_pendiente.toFixed(2)} € está vencida. ¿Nos confirmas el pago?`,
      })),
    );
    expect(resultado.superado).toBe(false);
    expect(resultado.diagnostico).toContain('sin nota');
  });

  it('falla si propone una nota para una factura que está al día', () => {
    const notas = [
      ...VENCIDAS.map((factura) => ({
        factura_id: factura.id,
        numero: factura.numero,
        texto: `Hola. La factura ${factura.numero} de ${factura.importe_pendiente.toFixed(2)} € está vencida. ¿Nos confirmas el pago?`,
      })),
      ...AL_DIA.slice(0, 1).map((factura) => ({
        factura_id: factura.id,
        numero: factura.numero,
        texto: `Hola. La factura ${factura.numero} de ${factura.importe_pendiente.toFixed(2)} €. ¿Nos confirmas el pago?`,
      })),
    ];
    const resultado = evaluarNotas(notas);
    expect(resultado.superado).toBe(false);
    expect(resultado.diagnostico).toContain('notas de más');
  });

  it('falla si una nota no dice qué factura ni cuánto se debe', () => {
    const resultado = evaluarNotas(
      VENCIDAS.map((factura) => ({
        factura_id: factura.id,
        numero: factura.numero,
        texto: 'Hola. Tienes un pago pendiente. ¿Nos confirmas cuándo lo haces?',
      })),
    );
    expect(resultado.superado).toBe(false);
    expect(resultado.diagnostico).toContain('número y el importe');
  });

  it('falla si la nota amenaza, aunque lo diga todo lo demás', () => {
    const resultado = evaluarNotas(
      VENCIDAS.map((factura) => ({
        factura_id: factura.id,
        numero: factura.numero,
        texto:
          `Hola. La factura ${factura.numero} de ${factura.importe_pendiente.toFixed(2)} € ` +
          'sigue sin pagar. Te aplicaremos un recargo y pasaremos el asunto al abogado. ' +
          '¿Nos confirmas el pago?',
      })),
    );
    expect(resultado.superado).toBe(false);
    expect(resultado.diagnostico).toContain('tono');
  });

  it('la lista de palabras prohibidas no está vacía: si no, la regla no existe', () => {
    expect(PROHIBIDAS.length).toBeGreaterThan(5);
  });
});
