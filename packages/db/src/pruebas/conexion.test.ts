/**
 * La conexión de la aplicación sabe mandar fechas.
 *
 * Parece una obviedad y no lo es: `drizzle()` sustituye los serializadores de fecha
 * del cliente de postgres.js que recibe por la identidad, porque su capa trabaja con
 * cadenas. Cuando el cliente crudo y el de Drizzle eran el mismo, cualquier consulta
 * de la plataforma que pasara un `Date` —el `vence_en` de una aprobación, la hora de
 * una entrada de auditoría— fallaba con «Received an instance of Date» en cuanto se
 * usaba `crearConexion` en vez del cliente de las pruebas. Lo encontró la rebanada de
 * aprobación por correo, que fue la primera en escribir desde una aplicación.
 */
import { describe, expect, it } from 'vitest';

import { crearConexion } from '../cliente.js';

import { HAY_BASE_DE_DATOS, MOTIVO_SALTO, URL_BASE_DE_DATOS } from './entorno.js';

const TITULO = HAY_BASE_DE_DATOS ? 'conexión' : `conexión — SALTADO. ${MOTIVO_SALTO}`;

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  it('el cliente crudo manda y recibe fechas', async () => {
    const conexion = crearConexion({ url: URL_BASE_DE_DATOS ?? '', maxConexiones: 2 });
    try {
      const momento = new Date(Date.UTC(2026, 8, 20, 10, 30, 0));
      const [fila] = await conexion.cliente<{ ida: Date }[]>`select ${momento}::timestamptz as ida`;
      expect(fila?.ida).toBeInstanceOf(Date);
      expect(fila?.ida.toISOString()).toBe(momento.toISOString());
    } finally {
      await conexion.cerrar();
    }
  });

  it('pedir el constructor de consultas no rompe el cliente crudo', async () => {
    const conexion = crearConexion({ url: URL_BASE_DE_DATOS ?? '', maxConexiones: 2 });
    try {
      // Antes de la corrección, esta línea dejaba el cliente crudo sin serializador
      // de fechas y la consulta siguiente fallaba.
      expect(conexion.crearDb()).toBeDefined();
      const momento = new Date(Date.UTC(2026, 8, 21, 8));
      const [fila] = await conexion.cliente<{ ida: Date }[]>`select ${momento}::timestamptz as ida`;
      expect(fila?.ida.toISOString()).toBe(momento.toISOString());
    } finally {
      await conexion.cerrar();
    }
  });

  it('cerrar dos veces no lanza', async () => {
    const conexion = crearConexion({ url: URL_BASE_DE_DATOS ?? '' });
    await conexion.cerrar();
    await expect(conexion.cerrar()).resolves.toBeUndefined();
  });
});
