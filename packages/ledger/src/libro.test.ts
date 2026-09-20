/**
 * Validación de las cargas `jsonb` del libro, sin base de datos.
 *
 * El principio de `@aiw/domain/esquemas` es que nada escribe en una columna `jsonb`
 * sin pasar antes por su esquema. Aquí se comprueba el camino de error que promete
 * la especificación —«carga que no valida contra Zod»— y que el rechazo ocurre antes
 * de tocar la base: la transacción que se le pasa a `anotar` falla si alguien la usa.
 */
import type postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { anotar, type EntradaNueva } from './libro.js';

const TENANT = '01920000-0000-7000-8000-0000000000aa';

const TOCO_LA_BASE = 'anotar tocó la base antes de validar la carga';

function noUsar(): never {
  throw new Error(TOCO_LA_BASE);
}

/** Transacción que no se puede usar: si `anotar` la toca, la prueba lo dice. */
const txProhibida = new Proxy(noUsar as unknown as postgres.TransactionSql, {
  apply: noUsar,
  get: noUsar,
});

const MINIMA: EntradaNueva = {
  actorTipo: 'agente',
  accion: 'prueba.validacion',
  resultado: 'exito',
};

describe('anotar valida las cargas jsonb antes de escribir', () => {
  it('rechaza un dato referenciado sin identificador y dice en qué columna', async () => {
    await expect(
      anotar(txProhibida, TENANT, {
        ...MINIMA,
        datosReferenciados: [{ tipo: 'factura' } as never],
      }),
    ).rejects.toThrow(/entrada_auditoria\.datos_referenciados/);
  });

  it('rechaza un identificador vacío: una referencia así no reconstruye nada', async () => {
    await expect(
      anotar(txProhibida, TENANT, {
        ...MINIMA,
        datosReferenciados: [{ tipo: 'factura', id: '' }],
      }),
    ).rejects.toThrow(/datos_referenciados.*0\.id|0\.id/s);
  });

  it('rechaza un cambio de nivel con un nivel que no existe', async () => {
    await expect(
      anotar(txProhibida, TENANT, {
        ...MINIMA,
        cambioDeNivel: { claseAccion: 'pago.emitir', de: 'n1', a: 'n9' } as never,
      }),
    ).rejects.toThrow(/entrada_auditoria\.cambio_de_nivel/);
  });

  it('rechaza un cambio de nivel sin clase de acción', async () => {
    await expect(
      anotar(txProhibida, TENANT, {
        ...MINIMA,
        cambioDeNivel: { de: null, a: 'n2' } as never,
      }),
    ).rejects.toThrow(/claseAccion/);
  });

  it('sigue rechazando lo que ya rechazaba: tenant que no es UUID y acción vacía', async () => {
    await expect(anotar(txProhibida, 'no-es-uuid', MINIMA)).rejects.toThrow(/no es un UUID/);
    await expect(anotar(txProhibida, TENANT, { ...MINIMA, accion: '   ' })).rejects.toThrow(
      /indica la acción/,
    );
  });
});
