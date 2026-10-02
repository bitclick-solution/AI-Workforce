/**
 * Guiones del proveedor de prueba y el catálogo que los elige por modelo.
 *
 * Qué guion contesta a un puesto lo decide su `enrutado_modelo`, que es dato de la
 * organización: Cobros va a `deterministico` y Conciliación a
 * `deterministico-conciliacion`. Así cada puesto de la demostración y de la
 * integración continua hace su trabajo, y el día que un puesto pase a un proveedor
 * de verdad se cambia su fila, no este catálogo.
 */
import { Enrutador } from '../enrutado.js';
import {
  MODELO_PRUEBA,
  PROVEEDOR_PRUEBA,
  crearProveedorDePrueba,
  type Guion,
} from '../proveedor-prueba.js';
import { guionCobros } from './cobros.js';
import {
  MODELO_PRUEBA_DIRECTOR,
  MODELO_PRUEBA_MODERADOR,
  guionDirector,
  guionModerador,
} from './sala.js';
import { MODELO_PRUEBA_CONCILIACION, guionConciliacion } from './conciliacion.js';

export * from './cobros.js';
export * from './conciliacion.js';
export * from './sala.js';

/** Guion de cada modelo del proveedor de prueba. */
export const GUIONES_DE_PRUEBA: Readonly<Record<string, Guion>> = {
  [MODELO_PRUEBA]: guionCobros,
  [MODELO_PRUEBA_CONCILIACION]: guionConciliacion,
  [MODELO_PRUEBA_MODERADOR]: guionModerador,
  [MODELO_PRUEBA_DIRECTOR]: guionDirector,
};

export class GuionNoRegistrado extends Error {
  constructor(modeloId: string) {
    super(
      `El proveedor de prueba no tiene guion para el modelo «${modeloId}». ` +
        `Modelos con guion: ${Object.keys(GUIONES_DE_PRUEBA).join(', ')}.`,
    );
    this.name = 'GuionNoRegistrado';
  }
}

/**
 * Guion de un modelo del proveedor de prueba.
 *
 * Un modelo sin guion falla en vez de caer en otro: un puesto que contesta con el
 * guion de otro puesto hace el trabajo equivocado y lo entrega como si fuera suyo.
 */
export function guionDelModelo(modeloId: string): Guion {
  const guion = GUIONES_DE_PRUEBA[modeloId];
  if (!guion) throw new GuionNoRegistrado(modeloId);
  return guion;
}

/** Enrutador con el proveedor de prueba, que contesta a cada modelo con su guion. */
export function enrutadorDeGuiones(): Enrutador {
  return new Enrutador()
    .registrar(PROVEEDOR_PRUEBA, (modeloId) =>
      crearProveedorDePrueba({ guion: guionDelModelo(modeloId), modeloId }),
    )
    .elegir({ principal: PROVEEDOR_PRUEBA });
}
