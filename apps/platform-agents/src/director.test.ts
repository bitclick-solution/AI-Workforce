import {
  INTENTOS_DE_CLASIFICACION,
  type PeticionDeClasificacion,
  type PuertoDeClasificacion,
  type RespuestaDeClasificacion,
} from '@aiw/rooms';
import { describe, expect, it, vi } from 'vitest';

import {
  CATALOGO,
  POLITICA_OPERACIONES,
  PROMPT_DEL_DIRECTOR,
  elegirPlantilla,
  proponerContratacion,
  proponerContratacionConModelo,
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

describe('Director de IA · paso de modelo en la sala de un departamento', () => {
  const PARAFRASIS = 'queremos que alguien pase los movimientos del banco contra las facturas';

  function puerto(salida: unknown, costeEuros = 0.004) {
    return vi.fn((_peticion: PeticionDeClasificacion<unknown>): Promise<RespuestaDeClasificacion> =>
      Promise.resolve({ salida, costeEuros, modelo: 'prueba' }),
    ) as unknown as PuertoDeClasificacion & ReturnType<typeof vi.fn>;
  }

  it('la frase parafraseada produce la misma propuesta que la fija: misma plantilla y departamento', async () => {
    const fija = proponerContratacion(FRASE, CONTEXTO);
    const clasificador = puerto({
      plantillaId: 'finanzas.conciliacion-bancaria',
      departamentoId: null,
      motivo: 'Pide conciliar.',
    });
    expect(elegirPlantilla(PARAFRASIS)).toBeUndefined();
    const { respuesta, pasoDeModelo } = await proponerContratacionConModelo(PARAFRASIS, CONTEXTO, {
      ambito: 'departamento',
      clasificador,
    });
    expect(respuesta.tipo).toBe('propuesta');
    if (respuesta.tipo !== 'propuesta' || fija.tipo !== 'propuesta') return;
    expect(respuesta.propuesta.plantilla).toEqual(fija.propuesta.plantilla);
    expect(respuesta.propuesta.departamento).toEqual(fija.propuesta.departamento);
    // Pasa por el mismo `decidirPaso`: el mismo nivel y el mismo motivo.
    expect(respuesta.propuesta.nivelExigido).toBe(fija.propuesta.nivelExigido);
    expect(respuesta.propuesta.motivoNivel).toBe(fija.propuesta.motivoNivel);
    expect(pasoDeModelo).toMatchObject({
      usado: true,
      resultado: 'plantilla',
      costeEuros: 0.004,
      version: PROMPT_DEL_DIRECTOR.version,
    });
  });

  it('el departamento que elige el modelo manda sobre el habitual de la plantilla', async () => {
    const { respuesta } = await proponerContratacionConModelo(PARAFRASIS, CONTEXTO, {
      ambito: 'departamento',
      clasificador: puerto({
        plantillaId: 'finanzas.conciliacion-bancaria',
        departamentoId: 'd-ven',
        motivo: 'Lo pide para Ventas.',
      }),
    });
    expect(respuesta.tipo === 'propuesta' && respuesta.propuesta.departamento.id).toBe('d-ven');
  });

  it('una frase que no encaja con nada es una aclaración, no una propuesta inventada', async () => {
    const { respuesta, pasoDeModelo } = await proponerContratacionConModelo(
      '¿cómo cambio de plan?',
      CONTEXTO,
      {
        ambito: 'departamento',
        clasificador: puerto({
          plantillaId: 'ninguno',
          departamentoId: null,
          motivo: 'Es soporte.',
        }),
      },
    );
    expect(respuesta.tipo).toBe('aclaracion');
    expect(respuesta.tipo === 'aclaracion' && respuesta.mensaje).toContain('No encuentro');
    expect(pasoDeModelo).toMatchObject({ usado: true, resultado: 'ninguna' });
  });

  it.each([
    ['una plantilla inventada', { plantillaId: 'finanzas.inventada', departamentoId: null }],
    [
      'un departamento inventado',
      { plantillaId: 'finanzas.conciliacion-bancaria', departamentoId: 'd-inventado' },
    ],
  ])(
    '%s es un fallo de esquema: ni propuesta ni aclaración con datos inventados',
    async (_n, parte) => {
      const clasificador = puerto({ ...parte, motivo: 'Eso.' });
      const { respuesta, pasoDeModelo } = await proponerContratacionConModelo(
        PARAFRASIS,
        CONTEXTO,
        {
          ambito: 'departamento',
          clasificador,
        },
      );
      expect(respuesta.tipo).toBe('aclaracion');
      expect(pasoDeModelo).toMatchObject({ usado: true, resultado: 'no_disponible' });
      expect(clasificador).toHaveBeenCalledTimes(INTENTOS_DE_CLASIFICACION);
    },
  );

  it('un fallo del modelo deja la misma aclaración que sin modelo', async () => {
    const sinModelo = proponerContratacion(PARAFRASIS, CONTEXTO);
    const roto = vi.fn(() => Promise.reject(new Error('503'))) as unknown as PuertoDeClasificacion;
    const { respuesta, pasoDeModelo } = await proponerContratacionConModelo(PARAFRASIS, CONTEXTO, {
      ambito: 'departamento',
      clasificador: roto,
    });
    expect(respuesta).toEqual(sinModelo);
    expect(pasoDeModelo).toMatchObject({ usado: true, resultado: 'no_disponible', costeEuros: 0 });
  });

  it('la sala general y las reglas que ya aciertan no llaman al modelo', async () => {
    const clasificador = puerto({ plantillaId: 'ninguno', departamentoId: null, motivo: 'x' });
    const general = await proponerContratacionConModelo(PARAFRASIS, CONTEXTO, {
      ambito: 'organizacion',
      clasificador,
    });
    expect(general.pasoDeModelo).toEqual({ usado: false, razon: 'sala_general' });
    expect(general.respuesta.tipo).toBe('aclaracion');
    const fija = await proponerContratacionConModelo(FRASE, CONTEXTO, {
      ambito: 'departamento',
      clasificador,
    });
    expect(fija.pasoDeModelo).toEqual({ usado: false, razon: 'reglas_decidieron' });
    expect(fija.respuesta.tipo).toBe('propuesta');
    expect(clasificador).not.toHaveBeenCalled();
  });

  it('el prompt es dato versionado: solo clasifica entre lo dado y no lleva credenciales', () => {
    expect(PROMPT_DEL_DIRECTOR.version).toBeGreaterThan(0);
    expect(PROMPT_DEL_DIRECTOR.sistema).toContain('Nunca inventes una plantilla');
    expect(PROMPT_DEL_DIRECTOR.sistema).not.toMatch(/sk-|AKIA|token|secret|password/i);
  });
});
