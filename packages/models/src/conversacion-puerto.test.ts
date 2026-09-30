import { describe, expect, it } from 'vitest';

import { mensajesParaElPuerto } from './conversacion.js';

const llamada = (id: string, herramienta: string) => ({ id, herramienta, argumentos: { a: 1 } });

describe('mensajesParaElPuerto', () => {
  it('junta los resultados de un turno en un solo mensaje del usuario, tras el turno del asistente', () => {
    const mensajes = mensajesParaElPuerto([
      { papel: 'usuario', texto: 'Empieza' },
      { papel: 'agente', texto: 'Voy', llamadas: [llamada('a', 'leer'), llamada('b', 'escribir')] },
      { papel: 'herramienta', llamadaId: 'a', herramienta: 'leer', texto: 'ra' },
      { papel: 'herramienta', llamadaId: 'b', herramienta: 'escribir', texto: 'rb' },
    ]);
    expect(mensajes).toHaveLength(3);
    expect(mensajes[1]).toMatchObject({ rol: 'assistant', llamadas: [{ id: 'a' }, { id: 'b' }] });
    expect(mensajes[2]).toEqual({
      rol: 'user',
      contenido: '',
      resultados: [
        { llamadaId: 'a', contenido: 'ra' },
        { llamadaId: 'b', contenido: 'rb' },
      ],
    });
  });

  it('un resultado que no contesta a ninguna llamada del asistente se entrega como texto y no rompe la petición', () => {
    const mensajes = mensajesParaElPuerto([
      { papel: 'usuario', texto: 'Empieza' },
      { papel: 'agente', texto: 'Voy' },
      { papel: 'herramienta', llamadaId: 'x', herramienta: 'leer', texto: 'ra' },
    ]);
    expect(mensajes[2]).toEqual({ rol: 'user', contenido: 'Resultado de leer: ra' });
  });

  it('omite un turno del agente vacío y conserva los bloques originales', () => {
    const bloques = [{ type: 'thinking', thinking: 'x', signature: 's' }];
    const mensajes = mensajesParaElPuerto([
      { papel: 'usuario', texto: 'a' },
      { papel: 'agente', texto: '' },
      { papel: 'agente', texto: 'b', bloques },
    ]);
    expect(mensajes).toHaveLength(2);
    expect(mensajes[1]).toMatchObject({ rol: 'assistant', bloques });
  });
});
