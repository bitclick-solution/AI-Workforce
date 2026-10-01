/**
 * El paso interno `cargar_habilidad`, sin base de datos: el bucle es código puro
 * sobre las operaciones que recibe, así que se puede probar con un doble que
 * registra lo que se llamó. La integración contra la base y el libro está en
 * `../pruebas/bucle.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  NOMBRE_HERRAMIENTA_CARGAR_HABILIDAD,
  ejecutarBucle,
  type OperacionesDelBucle,
} from './bucle.js';
import type {
  ContextoDeEjecucion,
  EntradaTareaAgente,
  HerramientaDelCatalogo,
  SalidaPasoModelo,
} from './tipos.js';

const IDENTIDAD = { tenantId: 't', puestoId: 'p', versionPuestoId: 'v', tareaId: 'x' };

const HERRAMIENTA_CARGAR_HABILIDAD: HerramientaDelCatalogo = {
  nombre: NOMBRE_HERRAMIENTA_CARGAR_HABILIDAD,
  descripcion: 'Carga una habilidad por su nombre.',
  tipo: 'lectura',
  claseAccion: 'lectura',
  esquemaEntrada: { type: 'object', properties: { nombre: { type: 'string' } } },
  conector: 'interno',
};

function contexto(herramientas: HerramientaDelCatalogo[]): ContextoDeEjecucion {
  return {
    estadoPuesto: 'activo',
    sistema: 'Eres el agente.',
    herramientas,
    nivelesPorClase: { lectura: 'n3', escritura: 'n1' },
    clasesProhibidas: [],
    guardiasEntrada: [],
    guardiasSalida: [],
    presupuestoEuros: 10,
    gastadoEuros: 0,
  };
}

/** Un paso de modelo que pide `cargar_habilidad` una vez y luego para. */
function pasoModeloQuePide(nombre: string) {
  let llamado = false;
  return async (): Promise<SalidaPasoModelo> => {
    if (llamado) {
      return { texto: 'Hecho.', llamadas: [], costeEuros: 0, gastadoEuros: 0, motivoFin: 'fin' };
    }
    llamado = true;
    return {
      texto: '',
      llamadas: [
        { id: 'l1', herramienta: NOMBRE_HERRAMIENTA_CARGAR_HABILIDAD, argumentos: { nombre } },
      ],
      costeEuros: 0,
      gastadoEuros: 0,
      motivoFin: 'tool_use',
    };
  };
}

const ENTRADA: EntradaTareaAgente = { ...IDENTIDAD, encargo: 'Agrupa las facturas vencidas.' };

describe('paso interno cargar_habilidad', () => {
  it('llama a operaciones.cargarHabilidad y nunca a pasoHerramienta', async () => {
    const cargarHabilidad = vi.fn().mockResolvedValue({
      encontrada: true,
      pasos: ['Paso uno.'],
      comprobaciones: ['Comprobación uno.'],
      motivo: 'Habilidad cargada.',
    });
    const pasoHerramienta = vi.fn();
    const operaciones: OperacionesDelBucle = {
      leerContexto: async () => contexto([HERRAMIENTA_CARGAR_HABILIDAD]),
      pasoModelo: pasoModeloQuePide('cobros.antiguedad-de-cobros'),
      pasoHerramienta,
      pedirAprobacion: vi.fn(),
      esperarDecision: vi.fn(),
      anotarPaso: vi.fn().mockResolvedValue(undefined),
      senalDeAprendizaje: vi.fn().mockResolvedValue(undefined),
      cargarHabilidad,
    };

    const resultado = await ejecutarBucle(operaciones, ENTRADA);

    expect(cargarHabilidad).toHaveBeenCalledWith(
      expect.objectContaining({ ...IDENTIDAD, nombre: 'cobros.antiguedad-de-cobros' }),
    );
    expect(pasoHerramienta).not.toHaveBeenCalled();
    expect(resultado.estado).toBe('completada');
    // No es una escritura: no suma a lo ejecutado ni a lo saltado.
    expect(resultado.escriturasEjecutadas).toBe(0);
    expect(resultado.escriturasSaltadas).toBe(0);
  });

  it('con un nombre que no está en la versión, no carga nada y el modelo lo sabe', async () => {
    const cargarHabilidad = vi.fn().mockResolvedValue({
      encontrada: false,
      pasos: [],
      comprobaciones: [],
      motivo: 'La habilidad «inventada» no está en esta versión del puesto.',
    });
    let textoDeHerramienta = '';
    const pasoModelo = vi.fn();
    let llamado = false;
    pasoModelo.mockImplementation(async (): Promise<SalidaPasoModelo> => {
      if (llamado) {
        return { texto: 'Hecho.', llamadas: [], costeEuros: 0, gastadoEuros: 0, motivoFin: 'fin' };
      }
      llamado = true;
      return {
        texto: '',
        llamadas: [
          {
            id: 'l1',
            herramienta: NOMBRE_HERRAMIENTA_CARGAR_HABILIDAD,
            argumentos: { nombre: 'inventada' },
          },
        ],
        costeEuros: 0,
        gastadoEuros: 0,
        motivoFin: 'tool_use',
      };
    });
    const operaciones: OperacionesDelBucle = {
      leerContexto: async () => contexto([HERRAMIENTA_CARGAR_HABILIDAD]),
      pasoModelo,
      pasoHerramienta: vi.fn(),
      pedirAprobacion: vi.fn(),
      esperarDecision: vi.fn(),
      anotarPaso: vi.fn().mockImplementation(async (peticion) => {
        textoDeHerramienta = peticion.motivo;
      }),
      senalDeAprendizaje: vi.fn().mockResolvedValue(undefined),
      cargarHabilidad,
    };

    const resultado = await ejecutarBucle(operaciones, ENTRADA);
    expect(resultado.estado).toBe('completada');
    expect(cargarHabilidad).toHaveBeenCalledOnce();
    expect(textoDeHerramienta).toBe('');
  });

  it('sin habilidades congeladas, cargar_habilidad no está en el catálogo', async () => {
    const operaciones: OperacionesDelBucle = {
      leerContexto: async () => contexto([]),
      pasoModelo: async () => ({
        texto: 'Nada que hacer.',
        llamadas: [],
        costeEuros: 0,
        gastadoEuros: 0,
        motivoFin: 'fin',
      }),
      pasoHerramienta: vi.fn(),
      pedirAprobacion: vi.fn(),
      esperarDecision: vi.fn(),
      anotarPaso: vi.fn(),
      senalDeAprendizaje: vi.fn(),
    };
    const resultado = await ejecutarBucle(operaciones, ENTRADA);
    expect(resultado.estado).toBe('completada');
  });
});
