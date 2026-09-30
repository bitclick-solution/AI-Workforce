import { describe, expect, it } from 'vitest';

import { clienteGrabado } from './cliente.js';
import {
  MODELOS_COMPARTIBLES,
  principal,
  registrosCompartidosDe,
} from './comprobar-registros-compartidos.js';
import { leerConfiguracion } from './entorno.js';

const CLAVE = 'clave-de-prueba-0d1a9f7c3b5e';

describe('registrosCompartidosDe', () => {
  it('lee los registros sin empresa asignada de un modelo', async () => {
    const cliente = clienteGrabado({
      search_records: [
        {
          argumentos: { model: 'res.partner' },
          carga: { records: [{ id: 7, name: 'Contacto compartido', email: 'a@ejemplo.com' }] },
        },
      ],
    });

    const resultado = await registrosCompartidosDe(cliente, MODELOS_COMPARTIBLES[0]);

    expect(resultado.modelo).toBe('res.partner');
    expect(resultado.registros).toEqual([
      { id: 7, nombre: 'Contacto compartido', detalle: 'a@ejemplo.com' },
    ]);
  });

  it('no encuentra ninguno cuando la grabación no trae registros', async () => {
    const cliente = clienteGrabado({
      search_records: [{ argumentos: { model: 'product.template' }, carga: { records: [] } }],
    });

    const resultado = await registrosCompartidosDe(cliente, MODELOS_COMPARTIBLES[1]);

    expect(resultado.registros).toEqual([]);
  });

  it('traduce un fallo del MCP dinámico a un error del contrato, sin la clave dentro', async () => {
    const cliente = clienteGrabado({
      search_records: [
        { argumentos: { model: 'res.partner' }, error: `Authentication failed api_key=${CLAVE}` },
      ],
    });

    await expect(registrosCompartidosDe(cliente, MODELOS_COMPARTIBLES[0])).rejects.toThrow(
      /No se pudieron leer los registros compartidos/,
    );
  });
});

describe('principal', () => {
  it('el mensaje de lo que falta nombra las variables y no imprime sus valores', async () => {
    const mensajes: string[] = [];
    const original = console.error;
    console.error = (...partes: unknown[]) => {
      mensajes.push(partes.map(String).join(' '));
    };
    try {
      await principal({ ODOO_URL: 'https://odoo.local', ODOO_CLAVE_API: CLAVE });
    } finally {
      console.error = original;
    }
    expect(mensajes.join('\n')).toContain('ODOO_BASE');
    expect(mensajes.join('\n')).not.toContain(CLAVE);
  });

  it('con las cuatro variables, leerConfiguracion no lanza y el guion sigue adelante', () => {
    expect(() =>
      leerConfiguracion({
        ODOO_URL: 'https://odoo.local',
        ODOO_BASE: 'pruebas',
        ODOO_USUARIO: 'agente',
        ODOO_CLAVE_API: CLAVE,
      }),
    ).not.toThrow();
  });
});
