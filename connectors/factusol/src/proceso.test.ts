import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { esProcesoPrincipal } from './proceso.js';

describe('esProcesoPrincipal', () => {
  it('reconoce el módulo que Node ejecuta en rutas de Linux y de macOS', () => {
    const ruta = '/home/usuario/AI-Workforce/connectors/factusol/src/demo-factusol.ts';
    expect(esProcesoPrincipal(pathToFileURL(ruta).href, ['node', ruta])).toBe(true);
  });

  it('reconoce el módulo cuando la ruta necesita codificarse', () => {
    // Aquí falla componer la URL a mano: `file://` + la ruta deja el espacio y
    // la almohadilla sin codificar y no coincide con `import.meta.url`. Es el
    // mismo fallo que en Windows, donde la ruta es `D:\\…` y la URL `file:///D:/…`.
    const ruta = '/home/usuario/mis proyectos/c#/demo-factusol.ts';
    const url = pathToFileURL(ruta).href;
    expect(url).not.toBe(`file://${ruta}`);
    expect(esProcesoPrincipal(url, ['node', ruta])).toBe(true);
  });

  it('no confunde dos módulos distintos', () => {
    const ruta = '/home/usuario/demo-factusol.ts';
    expect(
      esProcesoPrincipal(pathToFileURL('/home/usuario/servidor.ts').href, ['node', ruta]),
    ).toBe(false);
  });

  it('devuelve falso cuando no hay punto de entrada', () => {
    expect(esProcesoPrincipal('file:///x.ts', ['node'])).toBe(false);
  });
});
