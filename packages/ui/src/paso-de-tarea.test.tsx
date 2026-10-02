import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ProveedorDeIdioma } from './i18n';
import { ListaDePasos, PasoDeTarea } from './paso-de-tarea';

function paso(parcial: Partial<Parameters<typeof PasoDeTarea>[0]> = {}) {
  return (
    <PasoDeTarea
      id="p1"
      titulo="Consultó las facturas vencidas"
      resultado="exito"
      coste="0,0023 €"
      {...parcial}
    />
  );
}

describe('PasoDeTarea', () => {
  it('muestra qué hizo, su coste y su resultado con palabras', () => {
    const html = renderToStaticMarkup(paso({ cuando: 'hace 2 min', nivel: 'N0 · manual' }));
    expect(html).toContain('Consultó las facturas vencidas');
    expect(html).toContain('0,0023 €');
    expect(html).toContain('Hecho');
    expect(html).toContain('N0 · manual');
    expect(html).toContain('hace 2 min');
  });

  it('con motivo, lo ofrece plegado en «Por qué lo hice»', () => {
    const html = renderToStaticMarkup(paso({ porque: 'La clase está prohibida para este puesto.' }));
    expect(html).toContain('Por qué lo hice');
    expect(html).toContain('La clase está prohibida para este puesto.');
    expect(html).toContain('hidden');
  });

  it('sin motivo, lo dice en vez de callarlo', () => {
    const html = renderToStaticMarkup(paso({ porque: null }));
    expect(html).toContain('no anota el motivo de este paso');
    expect(html).not.toContain('aria-expanded');
  });

  it.each([
    ['error', 'Con error'],
    ['rechazado', 'No se hizo'],
    ['parcial', 'A medias'],
  ] as const)('el resultado %s se lee como «%s»', (resultado, texto) => {
    const html = renderToStaticMarkup(paso({ resultado }));
    expect(html).toContain(texto);
    expect(html).toContain(`data-resultado="${resultado}"`);
  });

  it('se traduce con el proveedor de idioma', () => {
    const html = renderToStaticMarkup(
      <ProveedorDeIdioma idioma="en">{paso({ porque: null })}</ProveedorDeIdioma>,
    );
    expect(html).toContain('Cost');
  });
});

describe('ListaDePasos', () => {
  it('es una lista ordenada con nombre accesible', () => {
    const html = renderToStaticMarkup(<ListaDePasos>{paso()}</ListaDePasos>);
    expect(html).toContain('<ol');
    expect(html).toContain('aria-label="Pasos del agente"');
  });
});
