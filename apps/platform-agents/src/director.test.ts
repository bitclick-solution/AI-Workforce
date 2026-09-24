import { describe, expect, it } from 'vitest';

import {
  CATALOGO,
  POLITICA_OPERACIONES,
  elegirPlantilla,
  proponerContratacion,
  type ContextoDelDirector,
} from './director';

const FINANZAS = { id: 'd-fin', nombre: 'Finanzas', estado: 'activo' };
const CONTEXTO: ContextoDelDirector = {
  departamentos: [FINANZAS, { id: 'd-ven', nombre: 'Ventas', estado: 'activo' }],
  puestos: [{ id: 'p-cob', nombre: 'Cobros', departamentoId: 'd-fin', estado: 'activo' }],
  conectores: [
    {
      id: 'c-demo',
      nombre: 'demo-cobros',
      herramientasAutorizadas: ['listar_facturas_vencidas', 'crear_nota_seguimiento'],
    },
  ],
};
const FRASE = 'contrata un agente de conciliación en Finanzas';

describe('Director de IA v0 · contratar desde una frase', () => {
  it('el catálogo es dato válido: cada plantilla con ficha, herramientas, guardrails y coste', () => {
    expect(CATALOGO.plantillas.length).toBeGreaterThan(0);
    for (const plantilla of CATALOGO.plantillas) {
      expect(plantilla.ficha.mision.length).toBeGreaterThan(10);
      expect(plantilla.herramientas.length).toBeGreaterThan(0);
      expect(plantilla.guardrails.some((g) => g.clase === 'critico')).toBe(true);
      expect(plantilla.coste.eurosMesCliente).toBeGreaterThan(0);
      expect(plantilla.temas.length).toBeGreaterThan(0);
    }
  });

  it('de la frase sale la propuesta completa de Conciliación bancaria en Finanzas', () => {
    const respuesta = proponerContratacion(FRASE, CONTEXTO);
    expect(respuesta.tipo).toBe('propuesta');
    if (respuesta.tipo !== 'propuesta') return;
    const { propuesta } = respuesta;
    expect(propuesta.tipo).toBe('contratar');
    expect(propuesta.plantilla.id).toBe('finanzas.conciliacion-bancaria');
    expect(propuesta.departamento).toEqual({ id: 'd-fin', nombre: 'Finanzas' });
    expect(propuesta.puesto.estadoInicial).toBe('en_prueba');
    expect(propuesta.puesto.ficha.plantilla.id).toBe('finanzas.conciliacion-bancaria');
    expect(propuesta.puesto.ficha.temas).toContain('concili');
    expect(propuesta.herramientas.disponibles.map((h) => h.nombre)).toEqual([
      'listar_facturas_vencidas',
      'crear_nota_seguimiento',
    ]);
    expect(propuesta.herramientas.disponibles[0]?.conectorId).toBe('c-demo');
    expect(propuesta.herramientas.porConectar.map((h) => h.nombre)).toEqual([
      'leer_extracto_bancario',
      'proponer_asiento_diferencia',
    ]);
    expect(propuesta.guardrails.length).toBeGreaterThanOrEqual(3);
    expect(propuesta.coste).toMatchObject({ tareasMes: 110, eurosMesCliente: 50 });
    expect(propuesta.nivelExigido).toBe('n1');
    expect(propuesta.caducidadDias).toBe(POLITICA_OPERACIONES.caducidadDias);
    expect(propuesta.reversion.operacion).toBe('dar_de_baja');
    expect(propuesta.entidadesTocadas).toEqual([{ tipo: 'departamento', id: 'd-fin' }]);
    expect(respuesta.mensaje).toContain('Conciliación bancaria');
    expect(respuesta.mensaje).toContain('2 por conectar');
    expect(respuesta.mensaje).toContain('N1');
  });

  it('sin departamento en la frase usa el de la plantilla', () => {
    const respuesta = proponerContratacion('contrata alguien que concilie el banco', CONTEXTO);
    expect(respuesta.tipo === 'propuesta' && respuesta.propuesta.departamento.id).toBe('d-fin');
  });

  it('aclara, sin proponer, si la plantilla no existe', () => {
    const respuesta = proponerContratacion('contrata un agente de marketing', CONTEXTO);
    expect(respuesta.tipo).toBe('aclaracion');
    expect(respuesta.mensaje).toContain('Conciliación bancaria');
    expect(elegirPlantilla('contrata un jardinero')).toBeUndefined();
  });

  it('aclara si el departamento no existe o no está activo', () => {
    const sinFinanzas = { ...CONTEXTO, departamentos: [{ ...FINANZAS, estado: 'disuelto' }] };
    expect(proponerContratacion(FRASE, sinFinanzas).tipo).toBe('aclaracion');
  });

  it('aclara si el puesto ya existe, también dado de baja', () => {
    const conConciliacion: ContextoDelDirector = {
      ...CONTEXTO,
      puestos: [
        ...CONTEXTO.puestos,
        {
          id: 'p-con',
          nombre: 'Conciliación bancaria',
          departamentoId: 'd-fin',
          estado: 'en_prueba',
          plantillaId: 'finanzas.conciliacion-bancaria',
        },
      ],
    };
    const respuesta = proponerContratacion(FRASE, conConciliacion);
    expect(respuesta).toMatchObject({ tipo: 'aclaracion' });
    expect(respuesta.mensaje).toContain('ya tiene');
    const deBaja = {
      ...conConciliacion,
      puestos: conConciliacion.puestos.map((p) => ({ ...p, estado: 'dado_de_baja' })),
    };
    const respuestaDeBaja = proponerContratacion(FRASE, deBaja);
    expect(respuestaDeBaja.tipo).toBe('aclaracion');
    expect(respuestaDeBaja.mensaje).toContain('dado de baja');
  });

  it('sin conectores, todas las herramientas quedan por conectar', () => {
    const respuesta = proponerContratacion(FRASE, { ...CONTEXTO, conectores: [] });
    expect(respuesta.tipo === 'propuesta' && respuesta.propuesta.herramientas.disponibles).toEqual(
      [],
    );
  });

  it('la política de operaciones manda: una clase prohibida no se propone', () => {
    const prohibida = {
      ...POLITICA_OPERACIONES,
      clasesProhibidas: ['organizacion.contratar'],
    };
    const respuesta = proponerContratacion(FRASE, CONTEXTO, CATALOGO, prohibida);
    expect(respuesta.tipo).toBe('aclaracion');
    expect(respuesta.mensaje).toContain('política');
  });
});
