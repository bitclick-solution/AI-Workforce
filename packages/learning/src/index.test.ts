import { describe, expect, it } from 'vitest';

import {
  MARCA_DATO_PERSONAL,
  PAQUETE,
  contieneDatosPersonales,
  diferenciaDeBorradores,
  redactarLeccion,
  sanearTexto,
  sanearValor,
  validarParametros,
} from './index';

describe('@aiw/learning', () => {
  it('declara su nombre y su responsabilidad', () => {
    expect(PAQUETE.nombre).toBe('@aiw/learning');
    expect(PAQUETE.responsabilidad.length).toBeGreaterThan(10);
  });
});

describe('diferencia de borradores', () => {
  it('devuelve las rutas cambiadas en orden estable', () => {
    const antes = { conector: 'demo', argumentos: { texto: 'Le recordamos', dias: 7 } };
    const despues = { conector: 'demo', argumentos: { dias: 10, texto: 'Te escribo' } };
    expect(diferenciaDeBorradores(antes, despues)).toEqual([
      { ruta: 'argumentos.dias', antes: 7, despues: 10 },
      { ruta: 'argumentos.texto', antes: 'Le recordamos', despues: 'Te escribo' },
    ]);
  });

  it('distingue claves añadidas, quitadas, listas y cambios de tipo', () => {
    const cambios = diferenciaDeBorradores(
      { a: 1, b: [1, 2], c: { d: 'x' } },
      { b: [1, 3, 4], c: 'x', e: true },
    );
    expect(cambios).toEqual([
      { ruta: 'a', antes: 1 },
      { ruta: 'b[1]', antes: 2, despues: 3 },
      { ruta: 'b[2]', despues: 4 },
      { ruta: 'c', antes: { d: 'x' }, despues: 'x' },
      { ruta: 'e', despues: true },
    ]);
  });

  it('no devuelve nada si no hay cambios y marca la raíz si el valor es plano', () => {
    expect(diferenciaDeBorradores({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toEqual([]);
    expect(diferenciaDeBorradores('hola', 'adiós')).toEqual([
      { ruta: '(raíz)', antes: 'hola', despues: 'adiós' },
    ]);
  });
});

describe('datos personales', () => {
  it.each([
    ['correo', 'escribe a marta.garcia@cliente.es hoy'],
    ['iban', 'cuenta ES91 2100 0418 4502 0005 1332'],
    ['tarjeta', 'tarjeta 4111 1111 1111 1111'],
    ['documento', 'DNI 12345678Z'],
    ['documento', 'NIE X1234567L'],
    ['documento', 'CIF B12345674'],
    ['telefono', 'llama al +34 612 345 678'],
    ['telefono', 'o al 912345678'],
  ])('sustituye %s', (clase, texto) => {
    const saneado = sanearTexto(texto);
    expect(saneado.texto).toContain(MARCA_DATO_PERSONAL);
    expect(saneado.hallados).toContain(clase);
    expect(contieneDatosPersonales(saneado.texto)).toBe(false);
  });

  it('no toca importes, fechas ni números de factura', () => {
    const texto = 'Factura F-2026-0001 de 1.250,00 € vencida el 2026-09-01, 30 días.';
    expect(sanearTexto(texto)).toEqual({ texto, hallados: [] });
  });

  it('sanea en profundidad sin cambiar la forma', () => {
    const { valor, hallados } = sanearValor({ a: ['x@y.es', 3], b: { c: 'ok' } });
    expect(valor).toEqual({ a: [MARCA_DATO_PERSONAL, 3], b: { c: 'ok' } });
    expect(hallados).toEqual(['correo']);
  });
});

describe('redacción de la lección', () => {
  const contexto = { tipoBorrador: 'herramienta.redactar_nota', claseAccion: 'comunicar' };

  it('produce una lección de memoria acotada a partir de la diferencia', () => {
    const leccion = redactarLeccion(
      [{ ruta: 'argumentos.texto', antes: 'Le recordamos', despues: 'Te escribo' }],
      contexto,
    );
    expect(leccion.parametros).toEqual({
      clase: 'memoria',
      destino: 'puesto',
      valor: leccion.linea,
    });
    expect(leccion.linea).toContain('«Le recordamos» a «Te escribo»');
    expect(leccion.titulo).toContain('herramienta.redactar_nota');
  });

  it('quita los datos personales y lo dice sin el valor', () => {
    const leccion = redactarLeccion(
      [{ ruta: 'argumentos.para', antes: 'info@empresa.es', despues: 'marta@cliente.es' }],
      contexto,
    );
    expect(leccion.linea).not.toContain('@');
    expect(leccion.datosPersonalesQuitados).toEqual(['correo']);
  });

  it('cita tres cambios como mucho, recorta las citas largas y cuenta el resto', () => {
    const largo = 'a'.repeat(500);
    const cambios = [1, 2, 3, 4, 5].map((i) => ({ ruta: `r${i}`, antes: largo, despues: 'b' }));
    const leccion = redactarLeccion(cambios, contexto);
    expect(leccion.linea).toContain('(y 2 cambios más)');
    expect(leccion.linea.length).toBeLessThan(700);
  });

  it('se niega a proponer una lección sin cambios', () => {
    expect(() => redactarLeccion([], contexto)).toThrow(/no cambió nada/);
  });

  it('rechaza cualquier clase fuera del ADR-005, empezando por el modelo base', () => {
    expect(() => validarParametros({ clase: 'modelo_base', destino: 'puesto', valor: 'x' })).toThrow(
      /leccion.parametros/,
    );
    expect(() => validarParametros({ clase: 'ajuste_fino', destino: 'puesto', valor: 'x' })).toThrow();
  });
});
