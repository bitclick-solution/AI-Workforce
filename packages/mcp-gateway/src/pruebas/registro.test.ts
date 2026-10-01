/** Registro y transporte: la credencial de confirmación no se mezcla con la del agente. */
import { describe, expect, it } from 'vitest';

import {
  RegistroDeServidores,
  Secreto,
  conexionPorProcesoHijo,
  type ConexionMcp,
} from '../index.js';

const CONEXION = {} as ConexionMcp;

describe('RegistroDeServidores · credencial de confirmación', () => {
  it('guarda la referencia por conector y la quita al volver a registrar sin ella', () => {
    const registro = new RegistroDeServidores().registrar('erp', () => Promise.resolve(CONEXION), {
      referenciaConfirmacion: 'env:CONFIRMAR',
    });
    expect(registro.referenciaConfirmacion('erp')).toBe('env:CONFIRMAR');
    registro.registrar('erp', () => Promise.resolve(CONEXION));
    expect(registro.referenciaConfirmacion('erp')).toBeUndefined();
  });

  it('abrir sin confirmación no pasa un segundo argumento a la fábrica', async () => {
    const recibido: unknown[][] = [];
    const registro = new RegistroDeServidores().registrar('erp', (...args) => {
      recibido.push(args);
      return Promise.resolve(CONEXION);
    });
    await registro.abrir('erp', null);
    await registro.abrir('erp', null, new Secreto('env:CONFIRMAR', 'valor-de-confirmacion'));
    expect(recibido[0]).toHaveLength(1);
    expect(recibido[1]).toHaveLength(2);
  });
});

describe('conexionPorProcesoHijo · dos credenciales, dos nombres', () => {
  const confirmacion = new Secreto('env:CONFIRMAR', 'valor-de-confirmacion');

  it('rechaza una confirmación sin variable propia', async () => {
    await expect(
      conexionPorProcesoHijo(
        'erp',
        null,
        { comando: 'node', variableDelSecreto: 'TOKEN' },
        confirmacion,
      ),
    ).rejects.toThrow(/no declara una variable propia/);
  });

  it('rechaza que la variable de confirmación sea la del agente', async () => {
    await expect(
      conexionPorProcesoHijo(
        'erp',
        null,
        { comando: 'node', variableDelSecreto: 'TOKEN', variableDeConfirmacion: 'TOKEN' },
        confirmacion,
      ),
    ).rejects.toThrow(/no declara una variable propia/);
  });
});
