import { describe, expect, it } from 'vitest';

import { proponerContratacion } from '../src/director.js';
import {
  CASO_DIRECTOR,
  CASO_DIRECTOR_MODELO,
  FRASE_DEL_CASO,
  FRASE_PARAFRASEADA_DEL_CASO,
  ejecutarCasoDirectorConModelo,
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

/** Caso dorado del paso de modelo del Director, con sus contraejemplos. */
describe('evals de humo · Director de IA con paso de modelo', () => {
  it('la frase parafraseada produce la misma propuesta gobernada y lo que no encaja se aclara', async () => {
    expect(proponerContratacion(FRASE_PARAFRASEADA_DEL_CASO, ORGANIZACION_DEL_CASO).tipo).toBe(
      'aclaracion',
    );
    const resultado = await ejecutarCasoDirectorConModelo();
    expect(resultado.diagnostico).toBe(`${CASO_DIRECTOR_MODELO}: superado`);
  });

  it('falla si el modelo no está disponible y la frase no se entiende', async () => {
    const resultado = await ejecutarCasoDirectorConModelo((() =>
      Promise.reject(new Error('proveedor caído'))) as never);
    expect(resultado.superado).toBe(false);
    expect(resultado.diagnostico).toContain('no hay propuesta');
  });
});
