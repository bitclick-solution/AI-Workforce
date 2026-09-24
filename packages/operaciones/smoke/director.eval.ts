import { describe, expect, it } from 'vitest';

import { proponerContratacion } from '../src/director.js';
import {
  CASO_DIRECTOR,
  FRASE_DEL_CASO,
  ORGANIZACION_DEL_CASO,
  ejecutarCasoDirector,
  evaluarPropuesta,
} from '../src/evals.js';

/** Caso dorado del Director de IA, con sus contraejemplos: el evaluador sabe fallar. */
describe('evals de humo · Director de IA', () => {
  it('de la frase sale una propuesta completa y gobernada', () => {
    expect(ejecutarCasoDirector().diagnostico).toBe(`${CASO_DIRECTOR}: superado`);
  });

  it('falla si concede una herramienta que la organización no autorizó', () => {
    const respuesta = proponerContratacion(FRASE_DEL_CASO, ORGANIZACION_DEL_CASO);
    if (respuesta.tipo !== 'propuesta') throw new Error('sin propuesta');
    const inflada = {
      ...respuesta,
      propuesta: {
        ...respuesta.propuesta,
        herramientas: {
          ...respuesta.propuesta.herramientas,
          disponibles: [
            ...respuesta.propuesta.herramientas.disponibles,
            {
              nombre: 'transferir_dinero',
              tipo: 'escritura' as const,
              descripcion: 'x',
              conectorId: 'erp',
              conectorNombre: 'demo',
            },
          ],
        },
      },
    };
    expect(evaluarPropuesta(inflada).diagnostico).toContain('no autorizó');
  });

  it('falla si no hay propuesta o si no arranca en prueba', () => {
    expect(evaluarPropuesta({ tipo: 'aclaracion', mensaje: 'no sé' }).superado).toBe(false);
    const respuesta = proponerContratacion(FRASE_DEL_CASO, ORGANIZACION_DEL_CASO);
    if (respuesta.tipo !== 'propuesta') throw new Error('sin propuesta');
    const sinPrueba = {
      ...respuesta,
      propuesta: {
        ...respuesta.propuesta,
        nivelExigido: 'n3' as const,
        puesto: {
          ...respuesta.propuesta.puesto,
          estadoInicial: 'activo' as unknown as 'en_prueba',
        },
      },
    };
    const resultado = evaluarPropuesta(sinPrueba);
    expect(resultado.diagnostico).toContain('no arranca en prueba');
    expect(resultado.diagnostico).toContain('nivel n3');
  });
});
