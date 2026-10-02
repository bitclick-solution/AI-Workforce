import { describe, expect, it } from 'vitest';

import { entornoDelHijoDeOdoo, registroDeOdooPorProceso } from './contexto.js';

describe('entornoDelHijoDeOdoo', () => {
  it('enciende la bandera y copia la URL, la base y el usuario, nunca la clave', () => {
    const entorno = entornoDelHijoDeOdoo({
      ODOO_URL: 'https://odoo.ejemplo.local',
      ODOO_BASE: 'pruebas',
      ODOO_USUARIO: 'agente-mcp@ejemplo.local',
      ODOO_CLAVE_API: 'no-debe-viajar-por-aqui',
    });
    expect(entorno).toEqual({
      AIW_CONECTOR_ODOO: '1',
      ODOO_URL: 'https://odoo.ejemplo.local',
      ODOO_BASE: 'pruebas',
      ODOO_USUARIO: 'agente-mcp@ejemplo.local',
    });
    expect(Object.values(entorno)).not.toContain('no-debe-viajar-por-aqui');
  });

  it('sin ODOO_MCP_URL en el entorno, no la incluye: el conector usa su valor por defecto', () => {
    const entorno = entornoDelHijoDeOdoo({});
    expect(entorno['ODOO_MCP_URL']).toBeUndefined();
  });

  it('con ODOO_MCP_URL, la incluye tal cual', () => {
    const entorno = entornoDelHijoDeOdoo({ ODOO_MCP_URL: 'http://odoo-mcp:8000/mcp' });
    expect(entorno['ODOO_MCP_URL']).toBe('http://odoo-mcp:8000/mcp');
  });
});

describe('registroDeOdooPorProceso', () => {
  it('registra el conector con el nombre pedido', () => {
    const registro = registroDeOdooPorProceso({
      nombreConector: 'Odoo',
      comando: 'pnpm',
      argumentos: ['--filter', '@aiw/connector-odoo', 'iniciar'],
      entorno: {},
    });
    expect(registro.tiene('Odoo')).toBe(true);
    expect(registro.nombres).toEqual(['Odoo']);
  });
});
