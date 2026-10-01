import { describe, expect, it } from 'vitest';

import type { VersionCandidata } from '@aiw/learning';

import { certificarPromocion } from '../src/plataforma/aprendizaje.js';
import {
  CASO_HABILIDAD_CARGA,
  HABILIDADES_DE_PRUEBA,
  elegirHabilidad,
  ejecutarCasoCargaDeHabilidad,
  evaluarEleccionDeHabilidad,
} from '../src/plataforma/habilidades.js';

/**
 * Caso dorado del mecanismo: el agente pide la habilidad que corresponde a la
 * tarea y no otra (docs/specs/habilidades-en-el-bucle-y-catalogo-finanzas.md).
 *
 * Como en los demás casos de humo, se comprueba también que el evaluador sabe
 * fallar: con el contraejemplo de pedir la habilidad que no toca.
 */
describe('evals de humo · habilidades en el bucle', () => {
  it('con un encargo de antigüedad de cobros, pide esa habilidad y no la de Norma 43', () => {
    const resultado = ejecutarCasoCargaDeHabilidad();
    expect(resultado.diagnostico).toBe(`${CASO_HABILIDAD_CARGA}: superado`);
    expect(resultado.superado).toBe(true);
  });

  it('con un encargo de conciliar un extracto, pide la habilidad de Norma 43', () => {
    const encargo = 'Lee el extracto bancario de hoy en formato Norma 43 antes de conciliar.';
    const obtenida = elegirHabilidad(encargo, HABILIDADES_DE_PRUEBA);
    expect(obtenida).toBe('prueba.leer-norma-43');
  });

  it('sin ningún caso que aplique, no pide ninguna habilidad', () => {
    const encargo = 'Redacta el informe semanal de Bitclick.';
    expect(elegirHabilidad(encargo, HABILIDADES_DE_PRUEBA)).toBeNull();
  });

  it('el evaluador falla si se pide la habilidad que no toca', () => {
    const resultado = evaluarEleccionDeHabilidad({
      encargo: 'Agrupa las facturas vencidas por tramo de antigüedad.',
      esperada: 'prueba.antiguedad-de-cobros',
      obtenida: 'prueba.leer-norma-43',
    });
    expect(resultado.superado).toBe(false);
    expect(resultado.diagnostico).toContain('se pidió');
  });

  it('la puerta certifica una habilidad limpia y bloquea una con herramienta fuera de la lista blanca', () => {
    const base: VersionCandidata = {
      tenantId: 't',
      puestoId: 'p',
      leccionId: 'l1',
      parametros: {
        clase: 'habilidad',
        destino: 'prueba.antiguedad-de-cobros',
        valor: {
          habilidadId: 'h1',
          nombre: 'prueba.antiguedad-de-cobros',
          version: 1,
          casosQueAplican: HABILIDADES_DE_PRUEBA[0]?.casosQueAplican ?? [],
          pasos: HABILIDADES_DE_PRUEBA[0]?.pasos ?? [],
          comprobaciones: HABILIDADES_DE_PRUEBA[0]?.comprobaciones ?? [],
        },
      },
      memoria: { lineas: [] },
      habilidadesCongeladas: [
        {
          habilidadId: 'h1',
          nombre: 'prueba.antiguedad-de-cobros',
          version: 1,
          casosQueAplican: HABILIDADES_DE_PRUEBA[0]?.casosQueAplican ?? [],
          pasos: HABILIDADES_DE_PRUEBA[0]?.pasos ?? [],
          comprobaciones: HABILIDADES_DE_PRUEBA[0]?.comprobaciones ?? [],
          herramientas: ['listar_facturas_vencidas'],
        },
      ],
      listaBlancaHerramientas: ['listar_facturas_vencidas', 'crear_nota_seguimiento'],
    };
    expect(certificarPromocion(base)).toMatchObject({ certificada: true });

    const primeraHabilidad = base.habilidadesCongeladas?.[0];
    if (!primeraHabilidad) throw new Error('la candidata base necesita una habilidad congelada');
    const fueraDeLista: VersionCandidata = {
      ...base,
      habilidadesCongeladas: [{ ...primeraHabilidad, herramientas: ['herramienta_no_autorizada'] }],
    };
    expect(certificarPromocion(fueraDeLista)).toMatchObject({ certificada: false });
  });
});
